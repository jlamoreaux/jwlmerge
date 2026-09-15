/**
 * Merge orchestrator.
 *
 * Merging runs entirely in the browser. This wraps JWLMerger with the
 * device-capability checks and timing estimates the UI needs, and reports how
 * long the whole run took.
 */

import type { MergeResult } from '@/lib/merge/merge-logic';
import type { ManagedFile } from '@/lib/types/file-management';

import { JWLMerger } from '@/lib/merge/merge-logic';
import { detectDeviceCapabilities, getProcessingRecommendation } from '@/lib/utils/device-capabilities';
import { calculateFileSizes } from '@/lib/utils/file-size-tracker';
import { canHandleClientMerge } from '@/lib/workers/merge-worker-client';

export interface MergeOrchestrationOptions {
  onProgress?: (message: string, progress?: number) => void;
}

export interface MergeOrchestrationResult extends MergeResult {
  processingTime?: number;
  deviceCapabilities?: ReturnType<typeof detectDeviceCapabilities>;
}

export class MergeOrchestrator {
  /**
   * Run a merge, checking first that this device can handle the files.
   */
  static async orchestrateMerge(
    managedFiles: ManagedFile[],
    options: MergeOrchestrationOptions = {}
  ): Promise<MergeOrchestrationResult> {
    const { onProgress } = options;
    const startTime = Date.now();

    try {
      const deviceCapabilities = detectDeviceCapabilities();

      onProgress?.('Checking device capabilities...', 5);

      const assessment = this.canProcessClientSide(managedFiles);
      if (!assessment.feasible) {
        return {
          success: false,
          error: assessment.reason,
          processingTime: Date.now() - startTime,
          deviceCapabilities,
        };
      }

      const result = await JWLMerger.mergeFiles(managedFiles, {
        ...(onProgress && { onProgress }),
      });

      return {
        ...result,
        processingTime: Date.now() - startTime,
        deviceCapabilities,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown orchestration error',
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Device capabilities, file sizes and a suitability assessment, for the UI
   * to show before a merge starts.
   */
  static getRecommendation(managedFiles: ManagedFile[]) {
    const deviceCapabilities = detectDeviceCapabilities();
    const fileSizeInfo = calculateFileSizes(managedFiles);

    const recommendation = getProcessingRecommendation(
      fileSizeInfo.selectedBytes,
      deviceCapabilities
    );

    return {
      recommendation,
      fileSizeInfo,
      deviceCapabilities,
    };
  }

  /**
   * Check whether this device can handle merging these files in the browser.
   */
  static canProcessClientSide(managedFiles: ManagedFile[]): {
    feasible: boolean;
    reason: string;
    confidence: 'low' | 'medium' | 'high';
  } {
    const totalSize = managedFiles.reduce((sum, file) => sum + file.file.size, 0);
    const deviceCapabilities = detectDeviceCapabilities();

    const clientAssessment = canHandleClientMerge(
      totalSize,
      deviceCapabilities.memory !== 'unknown' ? deviceCapabilities.memory : undefined
    );

    return {
      feasible: clientAssessment.canHandle,
      reason: clientAssessment.reason,
      confidence: 'medium',
    };
  }

  /**
   * Rough time estimate, scaled by how capable the device is. Browser
   * processing varies a lot between devices, hence the wide ranges.
   */
  static estimateProcessingTime(managedFiles: ManagedFile[]): {
    estimate: string;
    confidence: 'low' | 'medium' | 'high';
  } {
    const totalSize = managedFiles.reduce((sum, file) => sum + file.file.size, 0);
    const sizeMB = totalSize / (1024 * 1024);
    const deviceCapabilities = detectDeviceCapabilities();

    let multiplier: number;
    if (deviceCapabilities.score === 'low') {
      multiplier = 3;
    } else if (deviceCapabilities.score === 'medium') {
      multiplier = 2;
    } else {
      multiplier = 1;
    }

    const range = (low: number, high: number, confidence: 'low' | 'medium' | 'high') => ({
      estimate: `${Math.round(low * multiplier)}-${Math.round(high * multiplier)} seconds`,
      confidence,
    });

    if (sizeMB < 5) {return range(10, 30, 'medium');}
    if (sizeMB < 15) {return range(30, 90, 'medium');}
    if (sizeMB < 30) {return range(60, 300, 'low');}

    return {
      estimate: `${Math.round(120 * multiplier)}+ seconds`,
      confidence: 'low',
    };
  }
}
