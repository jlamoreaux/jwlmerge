'use client';

import { X, Download, Settings2, Lock, Server } from 'lucide-react';
import { useState, useEffect } from 'react';

import { GlobalDataTypeControls } from './global-data-type-controls';
import { MergeActionButton } from './merge-action-button';

import type { ManagedFile } from '@/lib/types/file-management';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface MergeConfigurationPanelProps {
  managedFiles: ManagedFile[];
  isOpen: boolean;
  onClose: () => void;
  onGlobalDataTypeToggle: (dataTypeId: string, enabled: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onStartMerge: (useServerSide: boolean) => void;
  className?: string;
}

export function MergeConfigurationPanel({
  managedFiles,
  isOpen,
  onClose,
  onGlobalDataTypeToggle,
  onSelectAll,
  onDeselectAll,
  onStartMerge,
  className,
}: MergeConfigurationPanelProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [useServerSide, setUseServerSide] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const selectedFiles = managedFiles.filter(file => file.isSelected);
  const hasValidFiles = selectedFiles.length > 0;

  // Calculate global data type states
  const getGlobalDataTypeState = (dataTypeId: string) => {
    if (selectedFiles.length === 0) {return 'disabled';}

    const enabledCount = selectedFiles.filter(file =>
      file.dataTypes.find(dt => dt.id === dataTypeId)?.enabled
    ).length;

    if (enabledCount === 0) {return 'none';}
    if (enabledCount === selectedFiles.length) {return 'all';}
    return 'partial';
  };

  const getDataTypeStats = (dataTypeId: string) => {
    const enabledCount = selectedFiles.filter(file =>
      file.dataTypes.find(dt => dt.id === dataTypeId)?.enabled
    ).length;
    return { enabled: enabledCount, total: selectedFiles.length };
  };

  if (!isOpen) {return null;}

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          'fixed z-50 bg-background border shadow-lg transition-transform duration-300',
          isMobile
            ? 'inset-x-0 bottom-0 rounded-t-lg max-h-[80vh] overflow-y-auto'
            : 'top-0 right-0 h-full w-96 border-l',
          className
        )}
      >
        <Card className="h-full border-0 rounded-none">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center space-x-2">
                <Settings2 className="h-5 w-5" />
                <span>Merge Configuration</span>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">
              {selectedFiles.length} of {managedFiles.length} files selected
            </div>
          </CardHeader>

          <CardContent className="flex-1 space-y-6 p-6">
            {hasValidFiles ? (
              <>
                {/* Global Data Type Controls */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Data Types</h3>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onSelectAll}
                        className="h-8 px-2 text-xs"
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onDeselectAll}
                        className="h-8 px-2 text-xs"
                      >
                        Deselect All
                      </Button>
                    </div>
                  </div>

                  <GlobalDataTypeControls
                    onGlobalDataTypeToggle={onGlobalDataTypeToggle}
                    getGlobalDataTypeState={getGlobalDataTypeState}
                    getDataTypeStats={getDataTypeStats}
                  />
                </div>

                {/* Processing Mode */}
                <div className="space-y-4 border-t pt-6">
                  <h3 className="text-sm font-medium">Processing Mode</h3>

                  <div className="space-y-3">
                    <div
                      className={cn(
                        'rounded-lg border p-3 cursor-pointer transition-all',
                        !useServerSide && 'border-green-200 bg-green-50'
                      )}
                      onClick={() => setUseServerSide(false)}
                    >
                      <div className="flex items-center space-x-3">
                        <div className={cn(
                          'h-4 w-4 rounded-full border-2 flex items-center justify-center',
                          !useServerSide ? 'border-green-600 bg-green-600' : 'border-gray-300'
                        )}>
                          {!useServerSide && <div className="h-2 w-2 rounded-full bg-white" />}
                        </div>
                        <Lock className="h-4 w-4 text-green-600" />
                        <div className="flex-1">
                          <div className="font-medium text-sm">Client-Side (Recommended)</div>
                          <div className="text-xs text-muted-foreground">Maximum privacy - files never leave your browser</div>
                        </div>
                      </div>
                    </div>

                    <div
                      className={cn(
                        'rounded-lg border p-3 cursor-pointer transition-all',
                        useServerSide && 'border-blue-200 bg-blue-50'
                      )}
                      onClick={() => setUseServerSide(true)}
                    >
                      <div className="flex items-center space-x-3">
                        <div className={cn(
                          'h-4 w-4 rounded-full border-2 flex items-center justify-center',
                          useServerSide ? 'border-blue-600 bg-blue-600' : 'border-gray-300'
                        )}>
                          {useServerSide && <div className="h-2 w-2 rounded-full bg-white" />}
                        </div>
                        <Server className="h-4 w-4 text-blue-600" />
                        <div className="flex-1">
                          <div className="font-medium text-sm">Server-Side (Faster)</div>
                          <div className="text-xs text-muted-foreground">Faster processing - files temporarily uploaded</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div className="space-y-3 border-t pt-6">
                  <h3 className="text-sm font-medium">Merge Summary</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Files to merge:</span>
                      <span className="font-medium">{selectedFiles.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total size:</span>
                      <span className="font-medium">
                        {formatFileSize(selectedFiles.reduce((sum, file) => sum + file.file.size, 0))}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Download className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Files Selected</h3>
                <p className="text-sm text-muted-foreground">
                  Upload and select files to configure merge options
                </p>
              </div>
            )}
          </CardContent>

          {/* Sticky Action Button */}
          {hasValidFiles && (
            <div className="border-t p-4">
              <MergeActionButton
                managedFiles={selectedFiles}
                onStartMerge={() => onStartMerge(useServerSide)}
                disabled={!hasValidFiles}
              />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) {return '0 Bytes';}
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}