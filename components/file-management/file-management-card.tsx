'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import type { ManagedFile } from '@/lib/types/file-management';
import { Smartphone, Calendar, HardDrive, X, Settings } from 'lucide-react';
import { useState } from 'react';

interface FileManagementCardProps {
  managedFile: ManagedFile;
  onDataTypeToggle: (fileId: string, dataTypeId: string, enabled: boolean) => void;
  onRemoveFile: (fileId: string) => void;
  className?: string;
}

export function FileManagementCard({
  managedFile,
  onDataTypeToggle,
  onRemoveFile,
  className,
}: FileManagementCardProps) {
  const [showDataTypes, setShowDataTypes] = useState(false);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return 'Unknown';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const enabledDataTypes = managedFile.dataTypes.filter(dt => dt.enabled);
  const totalDataTypes = managedFile.dataTypes.length;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="flex items-center space-x-2 text-base">
            <Smartphone className="h-4 w-4" />
            <span className="truncate">
              {managedFile.metadata.deviceName || 'Unknown Device'}
            </span>
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemoveFile(managedFile.id)}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* File Metadata */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center space-x-1 text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>Created:</span>
            </span>
            <span className="font-medium">
              {formatDate(managedFile.metadata.creationDate)}
            </span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="flex items-center space-x-1 text-muted-foreground">
              <HardDrive className="h-3 w-3" />
              <span>Size:</span>
            </span>
            <span className="font-medium">
              {formatFileSize(managedFile.metadata.fileSize)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">File:</span>
            <span className="font-medium truncate max-w-[150px]" title={managedFile.file.name}>
              {managedFile.file.name}
            </span>
          </div>
        </div>

        {/* Data Types Configuration */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Data Types</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDataTypes(!showDataTypes)}
              className="h-8 px-2 text-xs"
            >
              <Settings className="h-3 w-3 mr-1" />
              {showDataTypes ? 'Hide' : 'Configure'}
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            {enabledDataTypes.length} of {totalDataTypes} data types selected
          </div>

          {showDataTypes && (
            <div className="space-y-2 border-t pt-3">
              {managedFile.dataTypes.map((dataType) => (
                <div key={dataType.id} className="flex items-start space-x-3">
                  <Checkbox
                    id={`${managedFile.id}-${dataType.id}`}
                    checked={dataType.enabled}
                    onCheckedChange={(checked) => {
                      onDataTypeToggle(
                        managedFile.id,
                        dataType.id,
                        checked as boolean
                      );
                    }}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <label
                      htmlFor={`${managedFile.id}-${dataType.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {dataType.name}
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {dataType.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!showDataTypes && enabledDataTypes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {enabledDataTypes.slice(0, 3).map((dataType) => (
                <span
                  key={dataType.id}
                  className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                >
                  {dataType.name}
                </span>
              ))}
              {enabledDataTypes.length > 3 && (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  +{enabledDataTypes.length - 3} more
                </span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}