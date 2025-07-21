'use client';

import { CheckCircle, XCircle, Clock, Loader2, Download, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export interface MergeProgressState {
  status: 'idle' | 'preparing' | 'processing' | 'complete' | 'error';
  message: string;
  progress: number;
  processingMode?: 'client' | 'server';
  error?: string;
  result?: {
    blob: Blob;
    fileName: string;
    stats?: {
      filesProcessed: number;
      tablesProcessed: number;
      finalSize: number;
    };
  };
}

interface MergeProgressIndicatorProps {
  state: MergeProgressState;
  onDownload?: () => void;
  onReset?: () => void;
  onRetry?: () => void;
  className?: string;
}

export function MergeProgressIndicator({
  state,
  onDownload,
  onReset,
  onRetry,
  className,
}: MergeProgressIndicatorProps) {
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  // Track processing time
  useEffect(() => {
    if (state.status === 'preparing' || state.status === 'processing') {
      if (!startTime) {
        setStartTime(Date.now());
      }

      const interval = setInterval(() => {
        if (startTime) {
          setTimeElapsed(Math.floor((Date.now() - startTime) / 1000));
        }
      }, 1000);

      return () => clearInterval(interval);
    } else if (state.status === 'complete' || state.status === 'error') {
      // Keep final time when done
      if (startTime && timeElapsed === 0) {
        setTimeElapsed(Math.floor((Date.now() - startTime) / 1000));
      }
    } else if (state.status === 'idle') {
      setStartTime(null);
      setTimeElapsed(0);
    }

    // Return empty cleanup function for other cases
    return () => {};
  }, [state.status, startTime, timeElapsed]);

  const formatTime = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) {return '0 Bytes';}
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getStatusIcon = () => {
    switch (state.status) {
      case 'idle':
        return <Clock className="h-5 w-5 text-muted-foreground" />;
      case 'preparing':
      case 'processing':
        return <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />;
      case 'complete':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusColor = (): string => {
    switch (state.status) {
      case 'preparing':
      case 'processing':
        return 'border-blue-200 bg-blue-50';
      case 'complete':
        return 'border-green-200 bg-green-50';
      case 'error':
        return 'border-red-200 bg-red-50';
      case 'idle':
      default:
        return 'border-gray-200 bg-gray-50';
    }
  };

  if (state.status === 'idle') {
    return null;
  }

  return (
    <Card className={cn('w-full', getStatusColor(), className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {getStatusIcon()}
            <span className="text-lg">
              {state.status === 'preparing' && 'Preparing Files'}
              {state.status === 'processing' && 'Processing Merge'}
              {state.status === 'complete' && 'Merge Complete'}
              {state.status === 'error' && 'Merge Failed'}
            </span>
          </div>
          {(state.status === 'preparing' || state.status === 'processing') && (
            <div className="text-sm text-muted-foreground">
              {formatTime(timeElapsed)}
            </div>
          )}
        </CardTitle>

        {state.processingMode && (
          <div className="text-sm text-muted-foreground">
            Processing mode: {state.processingMode === 'client' ? 'Client-side (Private)' : 'Server-side (Fast)'}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress Bar */}
        {(state.status === 'preparing' || state.status === 'processing') && (
          <div className="space-y-2">
            <Progress value={state.progress} className="h-2" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{state.message}</span>
              <span>{Math.round(state.progress)}%</span>
            </div>
          </div>
        )}

        {/* Error State */}
        {state.status === 'error' && (
          <div className="space-y-3">
            <div className="flex items-start space-x-2 text-red-700 bg-red-100 p-3 rounded-lg">
              <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Processing failed</p>
                <p className="text-sm">{state.error || state.message}</p>
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              {onRetry && (
                <Button variant="outline" onClick={onRetry}>
                  Try Again
                </Button>
              )}
              {onReset && (
                <Button variant="outline" onClick={onReset}>
                  Start Over
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Success State */}
        {state.status === 'complete' && state.result && (
          <div className="space-y-3">
            <div className="text-green-700 bg-green-100 p-3 rounded-lg">
              <p className="font-medium">Merge completed successfully!</p>
              <p className="text-sm">
                Processing took {formatTime(timeElapsed)} • Final size: {formatFileSize(state.result.blob.size)}
              </p>
            </div>

            {/* Statistics */}
            {state.result.stats && (
              <div className="grid grid-cols-3 gap-4 text-center text-sm bg-muted/30 rounded-lg p-3">
                <div>
                  <div className="font-medium">{state.result.stats.filesProcessed}</div>
                  <div className="text-muted-foreground">Files Processed</div>
                </div>
                <div>
                  <div className="font-medium">{state.result.stats.tablesProcessed}</div>
                  <div className="text-muted-foreground">Tables Merged</div>
                </div>
                <div>
                  <div className="font-medium">{formatFileSize(state.result.stats.finalSize)}</div>
                  <div className="text-muted-foreground">Final Size</div>
                </div>
              </div>
            )}

            {/* Download Actions */}
            <div className="flex justify-between items-center">
              <div className="text-sm text-muted-foreground">
                Ready to download: {state.result.fileName}
              </div>
              <div className="flex space-x-2">
                {onReset && (
                  <Button variant="outline" onClick={onReset}>
                    Merge More Files
                  </Button>
                )}
                {onDownload && (
                  <Button onClick={onDownload} className="flex items-center space-x-2">
                    <Download className="h-4 w-4" />
                    <span>Download</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Processing State Details */}
        {(state.status === 'preparing' || state.status === 'processing') && (
          <div className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-3">
            <div className="space-y-1">
              <div>Time elapsed: {formatTime(timeElapsed)}</div>
              <div>Status: {state.message}</div>
              {state.processingMode === 'client' && (
                <div className="text-green-700">✓ Your files remain completely private</div>
              )}
              {state.processingMode === 'server' && (
                <div className="text-blue-700">⚡ Processing on optimized servers</div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}