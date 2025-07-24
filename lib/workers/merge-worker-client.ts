import type { ManagedFile } from '@/lib/types/file-management';

export interface WorkerMergeResult {
  blob: Blob;
  fileName: string;
  stats: {
    filesProcessed: number;
    tablesProcessed: number;
    finalSize: number;
  };
}

export interface WorkerMessage {
  type: 'progress' | 'success' | 'error';
  message?: string;
  progress?: number;
  result?: WorkerMergeResult;
  error?: string;
}

export interface MergeWorkerConfig {
  files: Array<{
    name: string;
    data: ArrayBuffer;
    dataTypes: Record<string, boolean>;
  }>;
  globalDataTypes: Record<string, boolean>;
}

/**
 * Client-side merge using Web Worker for better performance
 */
export class MergeWorkerClient {
  private worker: Worker | null = null;
  private onProgress?: (message: string, progress: number) => void;

  constructor(onProgress?: (message: string, progress: number) => void) {
    if (onProgress) {
      this.onProgress = onProgress;
    }
  }

  /**
   * Start merge operation using Web Worker
   */
  async mergeFiles(managedFiles: ManagedFile[]): Promise<WorkerMergeResult> {
    return new Promise((resolve, reject) => {
      try {
        // Create Web Worker with cache-busting timestamp
        this.worker = new Worker(`/workers/merge-worker.js?v=${Date.now()}`);

        // Set up message handling
        this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
          const { type, message, progress, result, error } = e.data;

          switch (type) {
            case 'progress':
              if (message && progress !== undefined) {
                this.onProgress?.(message, progress);
              }
              break;

            case 'success':
              if (result) {
                this.cleanup();
                resolve(result);
              } else {
                this.cleanup();
                reject(new Error('No result returned from worker'));
              }
              break;

            case 'error':
              this.cleanup();
              reject(new Error(error || 'Worker error'));
              break;
          }
        };

        this.worker.onerror = error => {
          this.cleanup();
          reject(new Error(`Worker error: ${error.message}`));
        };

        // Prepare files for worker
        void this.prepareAndSendFiles(managedFiles);
      } catch (error) {
        this.cleanup();
        reject(error);
      }
    });
  }

  /**
   * Prepare files and send to worker
   */
  private async prepareAndSendFiles(managedFiles: ManagedFile[]) {
    try {
      this.onProgress?.('Preparing files...', 0);

      // Convert files to ArrayBuffers
      const workerFiles = await Promise.all(
        managedFiles.map(async (file, index) => {
          this.onProgress?.(
            `Reading ${file.file.name}...`,
            (index / managedFiles.length) * 5
          );

          const arrayBuffer = await file.file.arrayBuffer();

          return {
            name: file.file.name,
            data: arrayBuffer,
            dataTypes: file.dataTypes.reduce(
              (acc, dt) => {
                acc[dt.id] = dt.enabled;
                return acc;
              },
              {} as Record<string, boolean>
            ),
          };
        })
      );

      // Create global data types config
      // If no files have explicit data type configurations, enable all data types by default
      const firstFileDataTypes = managedFiles[0]?.dataTypes;
      let globalDataTypes: Record<string, boolean> = {};

      if (firstFileDataTypes && firstFileDataTypes.length > 0) {
        // Files have data type configurations, use them
        globalDataTypes = firstFileDataTypes.reduce(
          (acc, dt) => {
            // Check if this data type is enabled in any file
            const isEnabled = managedFiles.some(
              file => file.dataTypes.find(fdt => fdt.id === dt.id)?.enabled
            );
            acc[dt.id] = isEnabled;
            return acc;
          },
          {} as Record<string, boolean>
        );
      } else {
        // No explicit data type configurations, enable all data types by default
        globalDataTypes = {
          notes: true,
          bookmarks: true,
          highlights: true,
          tags: true,
          inputfields: true,
          playlists: true,
        };
      }

      const config: MergeWorkerConfig = {
        files: workerFiles,
        globalDataTypes,
      };

      // Send to worker
      this.worker?.postMessage({
        type: 'merge',
        files: config.files,
        mergeConfig: { globalDataTypes: config.globalDataTypes },
      });
    } catch (error) {
      this.cleanup();
      throw new Error(
        `Failed to prepare files: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Terminate worker and cleanup
   */
  terminate() {
    this.cleanup();
  }

  private cleanup() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

/**
 * Check if Web Workers are supported
 */
export function isWebWorkerSupported(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Estimate if client can handle the merge based on file size and device
 */
export function canHandleClientMerge(
  totalSizeBytes: number,
  deviceMemoryGB?: number
): { canHandle: boolean; reason: string } {
  const sizeMB = totalSizeBytes / (1024 * 1024);

  // Hard limits
  if (sizeMB > 200) {
    return {
      canHandle: false,
      reason: 'Files too large for browser processing (>200MB)',
    };
  }

  // Memory-based limits
  if (deviceMemoryGB && deviceMemoryGB < 2 && sizeMB > 30) {
    return {
      canHandle: false,
      reason: 'Insufficient device memory for large files',
    };
  }

  if (deviceMemoryGB && deviceMemoryGB < 4 && sizeMB > 75) {
    return {
      canHandle: false,
      reason: 'Device memory may be insufficient',
    };
  }

  // Safe to proceed
  return {
    canHandle: true,
    reason: 'Suitable for client-side processing',
  };
}
