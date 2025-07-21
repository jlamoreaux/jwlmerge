'use client';

import { useState, useCallback } from 'react';

import { MergeActionButton } from './merge-action-button';
import { MergeProgressIndicator, type MergeProgressState } from './merge-progress-indicator';
import { ProcessingRecommendationModal } from './processing-recommendation-modal';

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
  const [showRecommendationModal, setShowRecommendationModal] = useState(false);
  const [progressState, setProgressState] = useState<MergeProgressState>({
    status: 'idle',
    message: '',
    progress: 0,
  });
  const [selectedMode, setSelectedMode] = useState<'client' | 'server' | null>(null);

  // Get recommendation data
  const getRecommendationData = useCallback(() => {
    if (managedFiles.length === 0) {return null;}

    const deviceCapabilities = detectDeviceCapabilities();
    const fileSizeInfo = calculateFileSizes(managedFiles);
    const recommendation = MergeOrchestrator.getRecommendation(managedFiles);

    return {
      deviceCapabilities,
      fileSizeInfo,
      recommendation: recommendation.recommendation,
    };
  }, [managedFiles]);

  const handleStartMerge = useCallback(() => {
    const recommendationData = getRecommendationData();
    if (!recommendationData) {return;}

    // Show recommendation modal for user to choose processing mode
    setShowRecommendationModal(true);
  }, [getRecommendationData]);

  const handleConfirmProcessingMode = useCallback(async (mode: 'client' | 'server') => {
    setSelectedMode(mode);
    setShowRecommendationModal(false);

    // Initialize progress state
    setProgressState({
      status: 'preparing',
      message: 'Initializing merge process...',
      progress: 0,
      processingMode: mode,
    });

    try {
      // Use MergeOrchestrator for intelligent merge handling
      const result = await MergeOrchestrator.orchestrateMerge(managedFiles, {
        preferredMode: mode,
        allowFallback: true,
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      setProgressState({
        status: 'error',
        message: 'Merge failed',
        progress: 0,
        processingMode: mode,
        error: errorMessage,
      });

      onError?.(errorMessage);
    }
  }, [managedFiles, onMergeComplete, onError]);

  const handleDownload = useCallback(() => {
    if (progressState.result?.blob && progressState.result?.fileName) {
      JWLMerger.downloadFile(progressState.result.blob, progressState.result.fileName);
    }
  }, [progressState.result]);

  const handleReset = useCallback(() => {
    setProgressState({
      status: 'idle',
      message: '',
      progress: 0,
    });
    setSelectedMode(null);
  }, []);

  const handleRetry = useCallback(() => {
    if (selectedMode) {
      handleConfirmProcessingMode(selectedMode);
    }
  }, [selectedMode, handleConfirmProcessingMode]);

  const recommendationData = getRecommendationData();

  return (
    <div className={className}>
      {/* Merge Action Button */}
      <MergeActionButton
        managedFiles={managedFiles}
        onStartMerge={handleStartMerge}
        disabled={progressState.status === 'preparing' || progressState.status === 'processing'}
      />

      {/* Progress Indicator */}
      <MergeProgressIndicator
        state={progressState}
        onDownload={handleDownload}
        onReset={handleReset}
        onRetry={() => void handleRetry()}
        className="mt-4"
      />

      {/* Processing Recommendation Modal */}
      {showRecommendationModal && recommendationData && (
        <ProcessingRecommendationModal
          isOpen={showRecommendationModal}
          onClose={() => setShowRecommendationModal(false)}
          onConfirm={handleConfirmProcessingMode}
          recommendation={recommendationData.recommendation}
          fileSizeInfo={recommendationData.fileSizeInfo}
          deviceCapabilities={recommendationData.deviceCapabilities}
        />
      )}
    </div>
  );
}

// Export utility function for testing the system
export function testIntelligentMergeSystem(managedFiles: ManagedFile[]) {
  const deviceCapabilities = detectDeviceCapabilities();
  const fileSizeInfo = calculateFileSizes(managedFiles);
  const orchestratorRecommendation = MergeOrchestrator.getRecommendation(managedFiles);
  const clientFeasibility = MergeOrchestrator.canProcessClientSide(managedFiles);
  const clientTimeEstimate = MergeOrchestrator.estimateProcessingTime(managedFiles, 'client');
  const serverTimeEstimate = MergeOrchestrator.estimateProcessingTime(managedFiles, 'server');

  return {
    deviceCapabilities,
    fileSizeInfo,
    orchestratorRecommendation,
    clientFeasibility,
    timeEstimates: {
      client: clientTimeEstimate,
      server: serverTimeEstimate,
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