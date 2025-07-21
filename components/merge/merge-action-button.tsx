'use client';

import { Download, Loader2, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

import type { ManagedFile } from '@/lib/types/file-management';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MergeActionButtonProps {
  managedFiles: ManagedFile[];
  onStartMerge: () => void;
  disabled?: boolean;
  className?: string;
}

export function MergeActionButton({
  managedFiles,
  onStartMerge,
  disabled = false,
  className,
}: MergeActionButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleMerge = async () => {
    if (disabled || isLoading) {return;}

    setIsLoading(true);
    try {
      onStartMerge();
    } finally {
      setIsLoading(false);
    }
  };

  // Validate merge readiness
  const getMergeValidation = () => {
    if (managedFiles.length === 0) {
      return { canMerge: false, message: 'No files selected' };
    }

    if (managedFiles.length === 1) {
      return { canMerge: false, message: 'Need at least 2 files to merge' };
    }

    const filesWithEnabledDataTypes = managedFiles.filter(file =>
      file.dataTypes.some(dt => dt.enabled)
    );

    if (filesWithEnabledDataTypes.length === 0) {
      return { canMerge: false, message: 'No data types selected' };
    }

    if (filesWithEnabledDataTypes.length < managedFiles.length) {
      const skippedCount = managedFiles.length - filesWithEnabledDataTypes.length;
      return {
        canMerge: true,
        message: `${skippedCount} file(s) will be skipped (no data types selected)`
      };
    }

    return { canMerge: true, message: `Ready to merge ${managedFiles.length} files` };
  };

  const validation = getMergeValidation();
  const isDisabled = disabled || !validation.canMerge || isLoading;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Validation Message */}
      <div className="flex items-start space-x-2 text-sm">
        {!validation.canMerge ? (
          <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
        ) : (
          <Download className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
        )}
        <span className={cn(
          'text-xs leading-relaxed',
          !validation.canMerge ? 'text-yellow-700' : 'text-green-700'
        )}>
          {validation.message}
        </span>
      </div>

      {/* Action Button */}
      <Button
        onClick={() => { void handleMerge(); }}
        disabled={isDisabled}
        className={cn(
          'w-full h-12 text-base font-medium transition-all',
          validation.canMerge && !isLoading && 'bg-green-600 hover:bg-green-700'
        )}
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Merging Files...
          </>
        ) : (
          <>
            <Download className="mr-2 h-4 w-4" />
            Start Merge
          </>
        )}
      </Button>

      {/* Additional Info */}
      {validation.canMerge && managedFiles.length > 0 && (
        <div className="text-xs text-muted-foreground text-center space-y-1">
          <p>The merged file will be downloaded automatically</p>
          <p>Processing time depends on file sizes and selected data types</p>
        </div>
      )}
    </div>
  );
}