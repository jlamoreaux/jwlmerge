'use client';

import { FileManagementCard } from './file-management-card';

import type { ManagedFile } from '@/lib/types/file-management';

import { cn } from '@/lib/utils';

interface FileManagementGridProps {
  managedFiles: ManagedFile[];
  onDataTypeToggle: (fileId: string, dataTypeId: string, enabled: boolean) => void;
  onRemoveFile: (fileId: string) => void;
  className?: string;
}

export function FileManagementGrid({
  managedFiles,
  onDataTypeToggle,
  onRemoveFile,
  className,
}: FileManagementGridProps) {
  if (managedFiles.length === 0) {
    return null;
  }

  return (
    <section className={cn('space-y-6', className)}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">File Management</h2>
          <p className="text-sm text-muted-foreground">
            Configure which data types to include from each JWL file
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {managedFiles.length} file{managedFiles.length !== 1 ? 's' : ''} ready
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {managedFiles.map((managedFile) => (
          <FileManagementCard
            key={managedFile.id}
            managedFile={managedFile}
            onDataTypeToggle={onDataTypeToggle}
            onRemoveFile={onRemoveFile}
          />
        ))}
      </div>

      {/* Summary Section */}
      <div className="rounded-lg bg-muted/50 p-4">
        <h3 className="mb-2 text-sm font-medium">Selection Summary</h3>
        <div className="grid gap-2 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <span>Total files:</span>
            <span>{managedFiles.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Total data types enabled:</span>
            <span>
              {managedFiles.reduce(
                (total, file) => total + file.dataTypes.filter(dt => dt.enabled).length,
                0
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Total file size:</span>
            <span>
              {(() => {
                const totalBytes = managedFiles.reduce(
                  (total, file) => total + file.metadata.fileSize,
                  0
                );
                const k = 1024;
                const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(totalBytes) / Math.log(k));
                return `${parseFloat((totalBytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
              })()}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}