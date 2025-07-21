'use client';

import { Check, Minus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DEFAULT_JWL_DATA_TYPES } from '@/lib/types/file-management';
import { cn } from '@/lib/utils';

interface GlobalDataTypeControlsProps {
  onGlobalDataTypeToggle: (dataTypeId: string, enabled: boolean) => void;
  getGlobalDataTypeState: (dataTypeId: string) => 'all' | 'partial' | 'none' | 'disabled';
  getDataTypeStats: (dataTypeId: string) => { enabled: number; total: number };
}

export function GlobalDataTypeControls({
  onGlobalDataTypeToggle,
  getGlobalDataTypeState,
  getDataTypeStats,
}: GlobalDataTypeControlsProps) {
  const handleDataTypeToggle = (dataTypeId: string) => {
    const state = getGlobalDataTypeState(dataTypeId);

    // If all files have this data type enabled, disable it
    // If none or partial have it enabled, enable it for all
    const shouldEnable = state !== 'all';
    onGlobalDataTypeToggle(dataTypeId, shouldEnable);
  };

  return (
    <div className="space-y-3">
      {DEFAULT_JWL_DATA_TYPES.map((dataType) => {
        const state = getGlobalDataTypeState(dataType.id);
        const stats = getDataTypeStats(dataType.id);
        const isDisabled = state === 'disabled';

        return (
          <div
            key={dataType.id}
            className={cn(
              'flex items-start space-x-3 p-3 rounded-lg border transition-colors',
              isDisabled && 'opacity-50',
              state === 'all' && 'bg-green-50 border-green-200',
              state === 'partial' && 'bg-yellow-50 border-yellow-200',
              state === 'none' && 'bg-muted/50'
            )}
          >
            {/* Toggle Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDataTypeToggle(dataType.id)}
              disabled={isDisabled}
              className={cn(
                'h-8 w-8 p-0 border-2 transition-all',
                state === 'all' && 'bg-green-600 border-green-600 text-white hover:bg-green-700',
                state === 'partial' && 'bg-yellow-500 border-yellow-500 text-white hover:bg-yellow-600',
                state === 'none' && 'border-muted-foreground/30 hover:border-muted-foreground/50'
              )}
            >
              {state === 'all' && <Check className="h-4 w-4" />}
              {state === 'partial' && <Minus className="h-4 w-4" />}
            </Button>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-medium">
                  {dataType.name}
                </h4>
                <span className="text-xs text-muted-foreground font-mono">
                  {stats.enabled}/{stats.total}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {dataType.description}
              </p>

              {/* State indicator */}
              <div className="mt-2">
                <span className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  state === 'all' && 'bg-green-100 text-green-800',
                  state === 'partial' && 'bg-yellow-100 text-yellow-800',
                  state === 'none' && 'bg-gray-100 text-gray-600',
                  state === 'disabled' && 'bg-gray-100 text-gray-400'
                )}>
                  {state === 'all' && 'All files'}
                  {state === 'partial' && `${stats.enabled} of ${stats.total} files`}
                  {state === 'none' && 'No files'}
                  {state === 'disabled' && 'No files selected'}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}