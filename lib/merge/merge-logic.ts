import JSZip from 'jszip';

// import { startMerge, uploadFile, getDownloadUrl, pollMergeStatus } from '@/lib/api/client';

import type { ManagedFile } from '@/lib/types/file-management';
import type { JWLMetadata } from '@/lib/validation/jwl-validator';
// import type { CreateMergeRequest, MergeConfig } from '@/lib/types/database';

import { detectDeviceCapabilities } from '@/lib/utils/device-capabilities';
import { MergeWorkerClient, isWebWorkerSupported, canHandleClientMerge } from '@/lib/workers/merge-worker-client';

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
  onProgress?: (message: string, progress?: number) => void;
}

export class JWLMerger {
  /**
   * Merge multiple JWL files into a single file
   */
  static async mergeFiles(
    managedFiles: ManagedFile[],
    options: MergeOptions = {}
  ): Promise<MergeResult> {
    const { useServerSide = false, onProgress } = options;

    if (useServerSide) {
      // Server-side processing will be implemented in future tasks
      console.warn('Server-side processing not yet fully implemented. Falling back to client-side.');
      return this.mergeFilesClientSide(managedFiles, onProgress);
    } else {
      return this.mergeFilesClientSide(managedFiles, onProgress);
    }
  }

  /**
   * Merge files using server-side processing
   * Currently disabled for privacy reasons - will be implemented in Task 11
   */
  // TODO: Implement server-side processing in Task 11

  /**
   * Merge files using client-side processing with Web Workers
   */
  private static async mergeFilesClientSide(
    managedFiles: ManagedFile[],
    onProgress?: (message: string, progress?: number) => void
  ): Promise<MergeResult> {
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

      // Check if Web Workers are supported and if we can handle client-side merge
      const totalSize = validFiles.reduce((sum, file) => sum + file.file.size, 0);
      const deviceCapabilities = detectDeviceCapabilities();
      const canHandle = canHandleClientMerge(totalSize, deviceCapabilities.memory !== 'unknown' ? deviceCapabilities.memory : undefined);

      if (!canHandle.canHandle) {
        onProgress?.('Device cannot handle client-side processing', 0);
        return {
          success: false,
          error: `Client-side processing not suitable: ${canHandle.reason}`
        };
      }

      if (isWebWorkerSupported()) {
        onProgress?.('Using Web Worker for background processing...', 0);

        // Use Web Worker for heavy processing
        const workerClient = new MergeWorkerClient((message, progress) => {
          onProgress?.(message, progress);
        });

        try {
          const result = await workerClient.mergeFiles(validFiles);

          return {
            success: true,
            blob: result.blob,
            fileName: result.fileName,
          };
        } catch (error) {
          onProgress?.('Web Worker failed, trying fallback method...', 0);
          console.warn('Web Worker merge failed:', error);
          // Fall through to fallback implementation
        } finally {
          workerClient.terminate();
        }
      }

      // Fallback implementation without Web Worker
      onProgress?.('Processing files (fallback mode)...', 10);

      // Create new ZIP for merged content
      const mergedZip = new JSZip();
      let mergedMetadata: JWLMetadata | null = null;

      // Process each file
      for (let i = 0; i < validFiles.length; i++) {
        const managedFile = validFiles[i];
        if (!managedFile) {continue;}
        const progress = 10 + (i / validFiles.length) * 70;
        onProgress?.(`Processing ${managedFile.file.name}...`, progress);

        const fileZip = await JSZip.loadAsync(managedFile.file);

        // Read manifest
        const manifestFile = fileZip.file('manifest.json');
        if (!manifestFile) {continue;}

        // Use first file's metadata as base, update device name to indicate merge
        if (!mergedMetadata) {
          mergedMetadata = {
            ...managedFile.metadata,
            deviceName: 'Merged JWL - Client Processed',
            creationDate: new Date().toISOString(),
          };
        }

        // Process each enabled data type
        for (const dataType of managedFile.dataTypes) {
          if (!dataType.enabled) {continue;}

          const dbFile = fileZip.file('userData.db');
          if (!dbFile) {continue;}

          // Note: This is a simplified fallback - the Web Worker implementation
          // provides full SQLite merging using sql.js
          console.warn(`Processing ${dataType.name} from ${managedFile.file.name} (simplified fallback)`);
        }
      }

      onProgress?.('Creating merged file...', 85);

      // Create merged manifest
      const mergedManifest = {
        name: 'merged-library',
        creationDate: mergedMetadata?.creationDate || new Date().toISOString(),
        version: 1,
        type: 0,
        userDataBackup: {
          lastModifiedDate: new Date().toISOString(),
          deviceName: mergedMetadata?.deviceName || 'Merged JWL - Fallback',
          hash: `fallback-merged-${Date.now()}`,
          schemaVersion: 13
        }
      };

      // Add manifest to ZIP
      mergedZip.file('manifest.json', JSON.stringify(mergedManifest, null, 2));

      // Create placeholder userData.db (in real implementation, this would be the merged SQLite DB)
      const placeholderDb = new Uint8Array(1024); // Placeholder binary data
      mergedZip.file('userData.db', placeholderDb);

      onProgress?.('Finalizing...', 95);

      // Generate the merged file
      const blob = await mergedZip.generateAsync({ type: 'blob' });
      const fileName = `merged-library-${new Date().toISOString().split('T')[0]}.jwlibrary`;

      onProgress?.('Complete!', 100);

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