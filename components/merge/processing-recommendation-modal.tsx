'use client';

import { AlertTriangle, Lock, Server, Clock, Shield, Zap } from 'lucide-react';
import { useState } from 'react';

import type { DeviceCapabilities } from '@/lib/utils/device-capabilities';
import type { FileSizeInfo } from '@/lib/utils/file-size-tracker';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatFileSize, getEstimatedProcessingTime } from '@/lib/utils/file-size-tracker';

interface ProcessingRecommendationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: 'client' | 'server') => void;
  recommendation: {
    mode: 'client' | 'server';
    confidence: 'low' | 'medium' | 'high';
    reason: string;
    warning?: string;
  };
  fileSizeInfo: FileSizeInfo;
  deviceCapabilities: DeviceCapabilities;
  className?: string;
}

export function ProcessingRecommendationModal({
  isOpen,
  onClose,
  onConfirm,
  recommendation,
  fileSizeInfo,
  deviceCapabilities,
  className,
}: ProcessingRecommendationModalProps) {
  const [selectedMode, setSelectedMode] = useState<'client' | 'server'>(recommendation.mode);

  if (!isOpen) {return null;}

  const clientTime = getEstimatedProcessingTime(fileSizeInfo.selectedBytes, 'client');
  const serverTime = getEstimatedProcessingTime(fileSizeInfo.selectedBytes, 'server');

  const handleConfirm = () => {
    onConfirm(selectedMode);
    onClose();
  };

  const isOverriding = selectedMode !== recommendation.mode;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        className
      )}>
        <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center space-x-2">
              <Zap className="h-5 w-5" />
              <span>Choose Processing Mode</span>
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              {fileSizeInfo.selectedCount} files • {formatFileSize(fileSizeInfo.selectedBytes)} total
            </div>
          </CardHeader>

          <CardContent className="space-y-6 pt-6">
            {/* Recommendation Banner */}
            <div className={cn(
              'rounded-lg border p-4',
              recommendation.mode === 'client' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'
            )}>
              <div className="flex items-start space-x-3">
                <div className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  recommendation.mode === 'client' ? 'bg-green-100' : 'bg-blue-100'
                )}>
                  {recommendation.mode === 'client' ? (
                    <Lock className="h-4 w-4 text-green-600" />
                  ) : (
                    <Server className="h-4 w-4 text-blue-600" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-medium">
                    Recommended: {recommendation.mode === 'client' ? 'Client-Side' : 'Server-Side'} Processing
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {recommendation.reason}
                  </p>
                  {recommendation.warning && (
                    <div className="mt-2 flex items-start space-x-2">
                      <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-yellow-700">
                        {recommendation.warning}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Processing Mode Options */}
            <div className="space-y-4">
              <h3 className="font-medium">Select Processing Mode:</h3>

              {/* Client-Side Option */}
              <div
                className={cn(
                  'rounded-lg border p-4 cursor-pointer transition-all',
                  selectedMode === 'client' && 'border-green-200 bg-green-50',
                  selectedMode !== 'client' && 'hover:bg-muted/50'
                )}
                onClick={() => setSelectedMode('client')}
              >
                <div className="flex items-start space-x-3">
                  <div className={cn(
                    'h-5 w-5 rounded-full border-2 flex items-center justify-center mt-0.5',
                    selectedMode === 'client' ? 'border-green-600 bg-green-600' : 'border-gray-300'
                  )}>
                    {selectedMode === 'client' && <div className="h-2 w-2 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <Lock className="h-4 w-4 text-green-600" />
                      <span className="font-medium">Client-Side Processing</span>
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                        Maximum Privacy
                      </span>
                    </div>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Files never leave your browser</li>
                      <li>• No data uploaded to servers</li>
                      <li>• Works completely offline</li>
                      <li className="flex items-center space-x-1">
                        <Clock className="h-3 w-3" />
                        <span>Estimated time: {clientTime.estimate}</span>
                      </li>
                    </ul>
                    {deviceCapabilities.score === 'low' && fileSizeInfo.selectedMB > 15 && (
                      <div className="mt-2 flex items-start space-x-2">
                        <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-orange-700">
                          Your device may struggle with {formatFileSize(fileSizeInfo.selectedBytes)} of files
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Server-Side Option */}
              <div
                className={cn(
                  'rounded-lg border p-4 cursor-pointer transition-all',
                  selectedMode === 'server' && 'border-blue-200 bg-blue-50',
                  selectedMode !== 'server' && 'hover:bg-muted/50'
                )}
                onClick={() => setSelectedMode('server')}
              >
                <div className="flex items-start space-x-3">
                  <div className={cn(
                    'h-5 w-5 rounded-full border-2 flex items-center justify-center mt-0.5',
                    selectedMode === 'server' ? 'border-blue-600 bg-blue-600' : 'border-gray-300'
                  )}>
                    {selectedMode === 'server' && <div className="h-2 w-2 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <Server className="h-4 w-4 text-blue-600" />
                      <span className="font-medium">Server-Side Processing</span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        Faster Performance
                      </span>
                    </div>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Much faster processing</li>
                      <li>• Handles large files efficiently</li>
                      <li>• Files auto-deleted after 24 hours</li>
                      <li className="flex items-center space-x-1">
                        <Clock className="h-3 w-3" />
                        <span>Estimated time: {serverTime.estimate}</span>
                      </li>
                    </ul>
                    <div className="mt-2 flex items-start space-x-2">
                      <Shield className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-blue-700">
                        Files temporarily uploaded - encrypted in transit and at rest
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Override Warning */}
            {isOverriding && (
              <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4">
                <div className="flex items-start space-x-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-yellow-800">
                      You're overriding our recommendation
                    </h4>
                    <p className="text-sm text-yellow-700 mt-1">
                      We recommended {recommendation.mode}-side processing because {recommendation.reason.toLowerCase()}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Device Info */}
            <div className="text-xs text-muted-foreground bg-muted/30 rounded p-3">
              <div className="font-medium mb-1">Device Information:</div>
              <div className="grid grid-cols-2 gap-2">
                <div>Capability: {deviceCapabilities.score}-end</div>
                <div>
                  Memory: {deviceCapabilities.memory !== 'unknown' ? `${deviceCapabilities.memory}GB` : 'Unknown'}
                </div>
                <div>CPU Cores: {deviceCapabilities.cpuCores || 'Unknown'}</div>
                <div>Platform: {deviceCapabilities.isMobile ? 'Mobile' : 'Desktop'}</div>
              </div>
            </div>
          </CardContent>

          {/* Actions */}
          <div className="border-t p-6 flex justify-end space-x-3">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              className={cn(
                selectedMode === 'client' && 'bg-green-600 hover:bg-green-700',
                selectedMode === 'server' && 'bg-blue-600 hover:bg-blue-700'
              )}
            >
              Start {selectedMode === 'client' ? 'Client-Side' : 'Server-Side'} Processing
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}