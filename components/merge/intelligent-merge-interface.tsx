'use client';

import { useState, useCallback } from 'react';

import { MergeActionButton } from './merge-action-button';
import {
  MergeProgressIndicator,
  type MergeProgressState,
} from './merge-progress-indicator';

import type { ManagedFile } from '@/lib/types/file-management';

import { JWLMerger } from '@/lib/merge/merge-logic';
import { MergeOrchestrator } from '@/lib/merge/merge-orchestrator';
import { detectDeviceCapabilities } from '@/lib/utils/device-capabilities';
import { calculateFileSizes } from '@/lib/utils/file-size-tracker';

interface IntelligentMergeInterfaceProps {
  managedFiles: ManagedFile[];
  onMergeComplete?: (result: unknown) => void;
  onError?: (error: string) => void;
  className?: string;
}

export function IntelligentMergeInterface({
  managedFiles,
  onMergeComplete,
  onError,
  className,
}: IntelligentMergeInterfaceProps) {
  const [progressState, setProgressState] = useState<MergeProgressState>({
    status: 'idle',
    message: '',
    progress: 0,
  });

  const handleStartMerge = useCallback(async () => {
    if (managedFiles.length === 0) {
      return;
    }

    // Always use client-side processing

    // Initialize progress state
    setProgressState({
      status: 'preparing',
      message: 'Initializing secure client-side merge...',
      progress: 0,
      processingMode: 'client',
    });

    try {
      // Use MergeOrchestrator for intelligent merge handling
      const result = await MergeOrchestrator.orchestrateMerge(managedFiles, {
        preferredMode: 'client',
        allowFallback: false, // No fallback to server
        onProgress: (message, progress) => {
          setProgressState(prev => ({
            ...prev,
            status: progress && progress >= 100 ? 'complete' : 'processing',
            message,
            progress: progress || prev.progress,
          }));
        },
        onModeChange: (newMode, reason) => {
          setProgressState(prev => ({
            ...prev,
            processingMode: newMode,
            message: `Switched to ${newMode}-side processing: ${reason}`,
          }));
        },
      });

      if (result.success && result.blob && result.fileName) {
        // Update progress to complete state
        setProgressState({
          status: 'complete',
          message: 'Merge completed successfully!',
          progress: 100,
          processingMode: result.processingMode,
          result: {
            blob: result.blob,
            fileName: result.fileName,
            stats: {
              filesProcessed: managedFiles.filter(f => f.isSelected).length,
              tablesProcessed: 0, // This would come from the actual merge result
              finalSize: result.blob.size,
            },
          },
        });

        onMergeComplete?.(result);
      } else {
        // Handle merge failure
        setProgressState({
          status: 'error',
          message: 'Merge failed',
          progress: 0,
          processingMode: result.processingMode,
          error: result.error || 'Unknown error occurred',
        });

        onError?.(result.error || 'Merge failed');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      setProgressState({
        status: 'error',
        message: 'Merge failed',
        progress: 0,
        processingMode: 'client',
        error: errorMessage,
      });

      onError?.(errorMessage);
    }
  }, [managedFiles, onMergeComplete, onError]);

  const handleDownload = useCallback(() => {
    if (progressState.result?.blob && progressState.result?.fileName) {
      JWLMerger.downloadFile(
        progressState.result.blob,
        progressState.result.fileName
      );
    }
  }, [progressState.result]);

  const handleReset = useCallback(() => {
    setProgressState({
      status: 'idle',
      message: '',
      progress: 0,
    });
  }, []);

  const handleRetry = useCallback(() => {
    void handleStartMerge();
  }, [handleStartMerge]);

  return (
    <div className={className}>
      {/* Merge Action Button */}
      <MergeActionButton
        managedFiles={managedFiles}
        onStartMerge={() => { void handleStartMerge(); }}
        disabled={
          progressState.status === 'preparing' ||
          progressState.status === 'processing'
        }
      />

      {/* Progress Indicator */}
      <MergeProgressIndicator
        state={progressState}
        onDownload={handleDownload}
        onReset={handleReset}
        onRetry={handleRetry}
        className="mt-4"
      />
    </div>
  );
}

// Export utility function for testing the system
export function testIntelligentMergeSystem(managedFiles: ManagedFile[]) {
  const deviceCapabilities = detectDeviceCapabilities();
  const fileSizeInfo = calculateFileSizes(managedFiles);
  const orchestratorRecommendation =
    MergeOrchestrator.getRecommendation(managedFiles);
  const clientFeasibility =
    MergeOrchestrator.canProcessClientSide(managedFiles);
  const clientTimeEstimate = MergeOrchestrator.estimateProcessingTime(
    managedFiles,
    'client'
  );

  return {
    deviceCapabilities,
    fileSizeInfo,
    orchestratorRecommendation,
    clientFeasibility,
    timeEstimates: {
      client: clientTimeEstimate,
    },
    summary: {
      recommendedMode: orchestratorRecommendation.recommendation.mode,
      confidence: orchestratorRecommendation.recommendation.confidence,
      reason: orchestratorRecommendation.recommendation.reason,
      canHandleClient: clientFeasibility.feasible,
      totalFileSize: fileSizeInfo.selectedMB,
      deviceScore: deviceCapabilities.score,
    },
  };
}
