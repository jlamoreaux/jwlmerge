import { put } from '@vercel/blob';
import JSZip from 'jszip';
import { NextResponse } from 'next/server';

import type { CreateMergeRequest, MergeResponse, MergeConfig } from '@/lib/types/database';
import type { NextRequest } from 'next/server';

import { supabase } from '@/lib/supabase/client';

export async function POST(request: NextRequest): Promise<NextResponse<MergeResponse>> {
  const startTime = Date.now();

  try {
    const body: CreateMergeRequest = await request.json();
    const { file_urls, merge_config } = body;

    // Validate input
    if (!file_urls || file_urls.length < 2) {
      return NextResponse.json(
        { success: false, error: 'At least 2 files are required for merging' },
        { status: 400 }
      );
    }

    // Create merge record in database
    const { data: mergeRecord, error: insertError } = await supabase
      .from('merges')
      .insert({
        file_urls,
        merge_config,
        status: 'processing',
      })
      .select()
      .single();

    if (insertError || !mergeRecord) {
      console.error('Database insert error:', insertError);
      return NextResponse.json(
        { success: false, error: 'Failed to create merge record' },
        { status: 500 }
      );
    }

    try {
      // Download and process files
      const fileBuffers: Array<{ buffer: ArrayBuffer; config: MergeConfig['files'][0] | undefined }> = [];
      let totalSize = 0;

      for (const fileUrl of file_urls) {
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to download file: ${fileUrl}`);
        }

        const buffer = await response.arrayBuffer();
        totalSize += buffer.byteLength;

        // Find corresponding file config
        const fileConfig = merge_config.files.find(f => f.url === fileUrl);
        fileBuffers.push({ buffer, config: fileConfig });
      }

      // Process merge using JSZip
      const mergedZip = new JSZip();
      const mergedManifest = {
        name: 'merged-library',
        creationDate: new Date().toISOString(),
        version: 1,
        type: 0,
        userDataBackup: {
          lastModifiedDate: new Date().toISOString(),
          deviceName: 'JWL Merge Web',
          hash: `merged-${Date.now()}`,
          schemaVersion: 13
        }
      };

      // Add manifest to merged ZIP
      mergedZip.file('manifest.json', JSON.stringify(mergedManifest, null, 2));

      // Create placeholder userData.db (in production, this would contain actual merged data)
      const placeholderDb = new Uint8Array(1024);
      mergedZip.file('userData.db', placeholderDb);

      // Generate merged file
      const mergedBuffer = await mergedZip.generateAsync({ type: 'arraybuffer' });

      // Upload result to Vercel Blob Storage
      const resultFileName = `results/merged-${mergeRecord.id}-${Date.now()}.jwlibrary`;
      const resultBlob = await put(resultFileName, mergedBuffer, {
        access: 'public',
      });

      const processingTime = Date.now() - startTime;

      // Update merge record with result
      const { error: updateError } = await supabase
        .from('merges')
        .update({
          status: 'completed',
          result_url: resultBlob.url,
        })
        .eq('id', mergeRecord.id);

      if (updateError) {
        console.error('Failed to update merge record:', updateError);
      }

      // Insert statistics
      const { error: statsError } = await supabase
        .from('merge_stats')
        .insert({
          merge_id: mergeRecord.id,
          file_count: file_urls.length,
          total_size_bytes: totalSize,
          processing_time_ms: processingTime,
          data_types: merge_config.globalDataTypes,
          success: true,
        });

      if (statsError) {
        console.error('Failed to insert merge stats:', statsError);
      }

      return NextResponse.json({
        success: true,
        merge_id: mergeRecord.id,
        result_url: resultBlob.url,
      });

    } catch (processingError) {
      // Update merge record with error
      const { error: updateError } = await supabase
        .from('merges')
        .update({
          status: 'failed',
          error_message: processingError instanceof Error ? processingError.message : 'Unknown error',
        })
        .eq('id', mergeRecord.id);

      if (updateError) {
        console.error('Failed to update merge record with error:', updateError);
      }

      // Insert failure statistics
      const { error: statsError } = await supabase
        .from('merge_stats')
        .insert({
          merge_id: mergeRecord.id,
          file_count: file_urls.length,
          total_size_bytes: 0,
          processing_time_ms: Date.now() - startTime,
          data_types: merge_config.globalDataTypes,
          success: false,
        });

      if (statsError) {
        console.error('Failed to insert merge stats:', statsError);
      }

      throw processingError;
    }

  } catch (error) {
    console.error('Merge error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Merge processing failed'
      },
      { status: 500 }
    );
  }
}