// import { startMerge, uploadFile, getDownloadUrl, pollMergeStatus } from '@/lib/api/client';

import type { ManagedFile } from '@/lib/types/file-management';
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

      // Merging is done by the Web Worker: it is the only implementation that
      // actually opens the SQLite databases and reconciles their rows. There
      // is no meaningful merge to fall back to, so a failure here is reported
      // rather than papered over.
      if (!isWebWorkerSupported()) {
        return {
          success: false,
          error:
            'This browser does not support Web Workers, which are required to merge backup files. ' +
            'Please try a current version of Chrome, Firefox, Safari or Edge.',
        };
      }

      onProgress?.('Using Web Worker for background processing...', 0);

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
        console.error('Web Worker merge failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Merge failed in the background worker',
        };
      } finally {
        workerClient.terminate();
      }
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