import JSZip from 'jszip';

// import { startMerge, uploadFile, getDownloadUrl, pollMergeStatus } from '@/lib/api/client';

import type { ManagedFile } from '@/lib/types/file-management';
import type { JWLMetadata } from '@/lib/validation/jwl-validator';
// import type { CreateMergeRequest, MergeConfig } from '@/lib/types/database';

export interface MergeResult {
  success: boolean;
  blob?: Blob;
  fileName?: string;
  downloadUrl?: string;
  mergeId?: string;
  error?: string;
}

export interface MergeOptions {
  useServerSide?: boolean;
  onProgress?: (status: string) => void;
}

export class JWLMerger {
  /**
   * Merge multiple JWL files into a single file
   */
  static async mergeFiles(
    managedFiles: ManagedFile[],
    options: MergeOptions = {}
  ): Promise<MergeResult> {
    const { useServerSide = true } = options;

    if (useServerSide) {
      // Server-side processing temporarily disabled due to privacy concerns
      // return this.mergeFilesServerSide(managedFiles, onProgress);
      console.warn('Server-side processing not yet fully implemented. Falling back to client-side.');
      return this.mergeFilesClientSide(managedFiles);
    } else {
      return this.mergeFilesClientSide(managedFiles);
    }
  }

  /**
   * Merge files using server-side processing
   * Currently disabled for privacy reasons - will be implemented in Task 11
   */
  // TODO: Implement server-side processing in Task 11

  /**
   * Merge files using client-side processing (fallback)
   */
  private static async mergeFilesClientSide(managedFiles: ManagedFile[]): Promise<MergeResult> {
    try {
      // Validate input
      if (managedFiles.length < 2) {
        return {
          success: false,
          error: 'At least 2 files are required for merging'
        };
      }

      // Filter files that have at least one enabled data type
      const validFiles = managedFiles.filter(file =>
        file.dataTypes.some(dt => dt.enabled)
      );

      if (validFiles.length === 0) {
        return {
          success: false,
          error: 'No files have enabled data types'
        };
      }

      // Create new ZIP for merged content
      const mergedZip = new JSZip();

      // Track merged data (placeholder for actual merge implementation)
      // const mergedData = {
      //   notes: [] as any[],
      //   bookmarks: [] as any[],
      //   highlights: [] as any[],
      //   tags: [] as any[],
      //   usermarks: [] as any[],
      //   inputfields: [] as any[],
      //   playlists: [] as any[],
      // };

      let mergedMetadata: JWLMetadata | null = null;

      // Process each file
      for (const managedFile of validFiles) {
        const fileZip = await JSZip.loadAsync(managedFile.file);

        // Read manifest
        const manifestFile = fileZip.file('manifest.json');
        if (!manifestFile) {continue;}

        // const manifestContent = await manifestFile.async('string');
        // const manifest = JSON.parse(manifestContent); // Placeholder for actual use

        // Use first file's metadata as base, update device name to indicate merge
        if (!mergedMetadata) {
          mergedMetadata = {
            ...managedFile.metadata,
            deviceName: 'Merged JWL',
            creationDate: new Date().toISOString(),
          };
        }

        // Process each enabled data type
        for (const dataType of managedFile.dataTypes) {
          if (!dataType.enabled) {continue;}

          const dbFile = fileZip.file('userData.db');
          if (!dbFile) {continue;}

          // In a real implementation, you would:
          // 1. Load the SQLite database from userData.db
          // 2. Extract data for the specific data type
          // 3. Merge with accumulated data
          // 4. Handle ID conflicts and duplicates

          // For now, we'll create a placeholder implementation
          console.warn(`Processing ${dataType.name} from ${managedFile.file.name}`);
        }
      }

      // Create merged manifest
      const mergedManifest = {
        name: 'merged-library',
        creationDate: mergedMetadata?.creationDate || new Date().toISOString(),
        version: 1,
        type: 0,
        userDataBackup: {
          lastModifiedDate: new Date().toISOString(),
          deviceName: mergedMetadata?.deviceName || 'Merged JWL',
          hash: 'merged-hash',
          schemaVersion: 13
        }
      };

      // Add manifest to ZIP
      mergedZip.file('manifest.json', JSON.stringify(mergedManifest, null, 2));

      // Create placeholder userData.db (in real implementation, this would be the merged SQLite DB)
      const placeholderDb = new Uint8Array(1024); // Placeholder binary data
      mergedZip.file('userData.db', placeholderDb);

      // Generate the merged file
      const blob = await mergedZip.generateAsync({ type: 'blob' });
      const fileName = `merged-library-${new Date().toISOString().split('T')[0]}.jwlibrary`;

      return {
        success: true,
        blob,
        fileName,
      };

    } catch (error) {
      console.error('Merge error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown merge error'
      };
    }
  }

  /**
   * Download a file (blob or URL)
   */
  static downloadFile(source: Blob | string, fileName: string): void {
    if (typeof window === 'undefined') {return;}

    if (typeof source === 'string') {
      // Download from URL
      const a = window.document.createElement('a');
      a.href = source;
      a.download = fileName;
      a.target = '_blank';
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
    } else {
      // Download blob
      const url = URL.createObjectURL(source);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = fileName;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  /**
   * @deprecated Use downloadFile instead
   */
  static downloadBlob(blob: Blob, fileName: string): void {
    this.downloadFile(blob, fileName);
  }
}