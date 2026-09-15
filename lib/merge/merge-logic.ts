import type { ManagedFile } from '@/lib/types/file-management';

import { detectDeviceCapabilities } from '@/lib/utils/device-capabilities';
import { MergeWorkerClient, isWebWorkerSupported, canHandleClientMerge } from '@/lib/workers/merge-worker-client';

export interface MergeResult {
  success: boolean;
  blob?: Blob;
  fileName?: string;
  error?: string;
}

export interface MergeOptions {
  onProgress?: (message: string, progress?: number) => void;
}

export class JWLMerger {
  /**
   * Merge multiple JWL files into a single file.
   *
   * Everything happens in the browser: the backups are never uploaded, and
   * there is no server-side path. That is the app's privacy guarantee, not an
   * implementation detail.
   */
  static async mergeFiles(
    managedFiles: ManagedFile[],
    options: MergeOptions = {}
  ): Promise<MergeResult> {
    const { onProgress } = options;

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
   * Save the merged file. It only ever exists as an in-memory Blob - there is
   * no download URL, because nothing was uploaded anywhere.
   */
  static downloadFile(blob: Blob, fileName: string): void {
    if (typeof window === 'undefined') {return;}

    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = fileName;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}