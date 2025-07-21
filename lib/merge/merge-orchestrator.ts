/**
 * Merge orchestrator that handles intelligent processing mode selection
 * and fallback mechanisms for JWL file merging
 */

import type { MergeResult, MergeOptions } from '@/lib/merge/merge-logic';
import type { ManagedFile } from '@/lib/types/file-management';

import { JWLMerger } from '@/lib/merge/merge-logic';
import { detectDeviceCapabilities, getProcessingRecommendation } from '@/lib/utils/device-capabilities';
import { calculateFileSizes } from '@/lib/utils/file-size-tracker';
import { canHandleClientMerge } from '@/lib/workers/merge-worker-client';

export interface MergeOrchestrationOptions {
  preferredMode?: 'client' | 'server' | 'auto';
  allowFallback?: boolean;
  onProgress?: (message: string, progress?: number) => void;
  onModeChange?: (newMode: 'client' | 'server', reason: string) => void;
}

export interface MergeOrchestrationResult extends MergeResult {
  processingMode: 'client' | 'server';
  fallbackOccurred: boolean;
  processingTime?: number;
  deviceCapabilities?: ReturnType<typeof detectDeviceCapabilities>;
}

export class MergeOrchestrator {
  /**
   * Orchestrate the merge process with intelligent mode selection and fallback
   */
  static async orchestrateMerge(
    managedFiles: ManagedFile[],
    options: MergeOrchestrationOptions = {}
  ): Promise<MergeOrchestrationResult> {
    const {
      preferredMode = 'auto',
      allowFallback = true,
      onProgress,
      onModeChange
    } = options;

    const startTime = Date.now();
    let fallbackOccurred = false;
    let finalMode: 'client' | 'server' = 'client';

    try {
      // Get device capabilities and file info
      const deviceCapabilities = detectDeviceCapabilities();
      const fileSizeInfo = calculateFileSizes(managedFiles);

      onProgress?.('Analyzing device capabilities and file sizes...', 5);

      // Determine processing mode
      finalMode = this.determineProcessingMode(
        preferredMode,
        fileSizeInfo.selectedBytes,
        deviceCapabilities
      );

      onProgress?.(`Selected ${finalMode}-side processing`, 10);

      // Attempt primary processing mode
      let result = await this.attemptMerge(managedFiles, finalMode, onProgress);

      // Handle fallback if primary mode failed
      if (!result.success && allowFallback) {
        const fallbackMode = finalMode === 'client' ? 'server' : 'client';

        onProgress?.(`${finalMode}-side processing failed, trying ${fallbackMode}-side...`, 15);
        onModeChange?.(fallbackMode, `${finalMode}-side processing failed`);

        fallbackOccurred = true;
        finalMode = fallbackMode;

        result = await this.attemptMerge(managedFiles, fallbackMode, onProgress);
      }

      const processingTime = Date.now() - startTime;

      return {
        ...result,
        processingMode: finalMode,
        fallbackOccurred,
        processingTime,
        deviceCapabilities,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown orchestration error',
        processingMode: finalMode,
        fallbackOccurred,
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Determine the best processing mode based on preferences and capabilities
   */
  private static determineProcessingMode(
    preferredMode: 'client' | 'server' | 'auto',
    totalSize: number,
    deviceCapabilities: ReturnType<typeof detectDeviceCapabilities>
  ): 'client' | 'server' {
    if (preferredMode !== 'auto') {
      return preferredMode;
    }

    // Get intelligent recommendation
    const recommendation = getProcessingRecommendation(totalSize, deviceCapabilities);
    return recommendation.mode;
  }

  /**
   * Attempt merge with specified processing mode
   */
  private static async attemptMerge(
    managedFiles: ManagedFile[],
    mode: 'client' | 'server',
    onProgress?: (message: string, progress?: number) => void
  ): Promise<MergeResult> {
    const mergeOptions: MergeOptions = {
      useServerSide: mode === 'server',
      ...(onProgress && { onProgress }),
    };

    if (mode === 'client') {
      // Additional client-side validation
      const totalSize = managedFiles.reduce((sum, file) => sum + file.file.size, 0);
      const deviceCapabilities = detectDeviceCapabilities();
      const canHandle = canHandleClientMerge(
        totalSize,
        deviceCapabilities.memory !== 'unknown' ? deviceCapabilities.memory : undefined
      );

      if (!canHandle.canHandle) {
        return {
          success: false,
          error: `Client-side processing not suitable: ${canHandle.reason}`,
        };
      }
    }

    return JWLMerger.mergeFiles(managedFiles, mergeOptions);
  }

  /**
   * Get processing recommendation without starting merge
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
   * Check if client-side processing is feasible
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
      confidence: 'medium', // Could be enhanced with more sophisticated logic
    };
  }

  /**
   * Estimate processing time for given mode
   */
  static estimateProcessingTime(
    managedFiles: ManagedFile[],
    mode: 'client' | 'server'
  ): {
    estimate: string;
    confidence: 'low' | 'medium' | 'high';
  } {
    const totalSize = managedFiles.reduce((sum, file) => sum + file.file.size, 0);
    const sizeMB = totalSize / (1024 * 1024);

    if (mode === 'server') {
      // Server processing estimates
      if (sizeMB < 10) {
        return { estimate: '5-15 seconds', confidence: 'high' };
      } else if (sizeMB < 25) {
        return { estimate: '15-30 seconds', confidence: 'high' };
      } else if (sizeMB < 50) {
        return { estimate: '30-60 seconds', confidence: 'medium' };
      } else {
        return { estimate: '1-3 minutes', confidence: 'medium' };
      }
    } else {
      // Client processing estimates (more variable)
      const deviceCapabilities = detectDeviceCapabilities();
      let baseMultiplier: number;
      if (deviceCapabilities.score === 'low') {
        baseMultiplier = 3;
      } else if (deviceCapabilities.score === 'medium') {
        baseMultiplier = 2;
      } else {
        baseMultiplier = 1;
      }

      if (sizeMB < 5) {
        return {
          estimate: `${Math.round(10 * baseMultiplier)}-${Math.round(30 * baseMultiplier)} seconds`,
          confidence: 'medium'
        };
      } else if (sizeMB < 15) {
        return {
          estimate: `${Math.round(30 * baseMultiplier)}-${Math.round(90 * baseMultiplier)} seconds`,
          confidence: 'medium'
        };
      } else if (sizeMB < 30) {
        return {
          estimate: `${Math.round(60 * baseMultiplier)}-${Math.round(300 * baseMultiplier)} seconds`,
          confidence: 'low'
        };
      } else {
        return {
          estimate: `${Math.round(120 * baseMultiplier)}+ seconds`,
          confidence: 'low'
        };
      }
    }
  }
}