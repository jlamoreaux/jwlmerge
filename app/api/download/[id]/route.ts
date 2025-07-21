import { NextRequest, NextResponse } from 'next/server';

import { supabase } from '@/lib/supabase/client';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Merge ID is required' },
        { status: 400 }
      );
    }

    // Get merge record from database
    const { data: mergeRecord, error } = await supabase
      .from('merges')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !mergeRecord) {
      return NextResponse.json(
        { error: 'Merge not found' },
        { status: 404 }
      );
    }

    // Check if merge is completed
    if (mergeRecord.status !== 'completed' || !mergeRecord.result_url) {
      return NextResponse.json(
        { 
          error: 'Merge not completed', 
          status: mergeRecord.status,
          message: mergeRecord.error_message || 'Merge is still processing'
        },
        { status: 400 }
      );
    }

    // Check if merge has expired
    const expiresAt = new Date(mergeRecord.expires_at);
    if (expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'Merge has expired' },
        { status: 410 }
      );
    }

    // Redirect to the blob storage URL
    return NextResponse.redirect(mergeRecord.result_url);

  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json(
      { error: 'Download failed' },
      { status: 500 }
    );
  }
}