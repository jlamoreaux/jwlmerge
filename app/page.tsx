'use client';

import { useState, useCallback } from 'react';

import type { ManagedFile, JWLDataType } from '@/lib/types/file-management';
import type { JWLMetadata } from '@/lib/validation/jwl-validator';

import { FileManagementGrid } from '@/components/file-management/file-management-grid';
import { MergeConfigurationPanel } from '@/components/merge/merge-configuration-panel';
import { PrivacyStatement } from '@/components/privacy-statement';
import { Button } from '@/components/ui/button';
import { FileUploadZone } from '@/components/upload/file-upload-zone';
import { JWLMerger } from '@/lib/merge/merge-logic';
import { DEFAULT_JWL_DATA_TYPES } from '@/lib/types/file-management';
import { generateUUID } from '@/lib/utils/uuid';

export default function Home() {
  const [managedFiles, setManagedFiles] = useState<ManagedFile[]>([]);
  const [isMergePanelOpen, setIsMergePanelOpen] = useState(false);

  const handleValidatedFiles = useCallback((files: Array<{ file: File; metadata: JWLMetadata }>) => {
    const newManagedFiles = files.map((validatedFile): ManagedFile => ({
      id: generateUUID(),
      file: validatedFile.file,
      metadata: validatedFile.metadata,
      dataTypes: DEFAULT_JWL_DATA_TYPES.map((dt): JWLDataType => ({
        ...dt,
        enabled: true, // Enable all data types by default
      })),
      isSelected: true,
    }));

    setManagedFiles(prev => {
      // Remove duplicates based on file name and size
      const existing = prev.filter(existing =>
        !newManagedFiles.some(newFile =>
          newFile.file.name === existing.file.name &&
          newFile.file.size === existing.file.size
        )
      );
      return [...existing, ...newManagedFiles];
    });
  }, []);

  const handleDataTypeToggle = useCallback((fileId: string, dataTypeId: string, enabled: boolean) => {
    setManagedFiles(prev =>
      prev.map(file =>
        file.id === fileId
          ? {
              ...file,
              dataTypes: file.dataTypes.map(dt =>
                dt.id === dataTypeId ? { ...dt, enabled } : dt
              ),
            }
          : file
      )
    );
  }, []);

  const handleRemoveFile = useCallback((fileId: string) => {
    setManagedFiles(prev => prev.filter(file => file.id !== fileId));
  }, []);

  const handleGlobalDataTypeToggle = useCallback((dataTypeId: string, enabled: boolean) => {
    setManagedFiles(prev =>
      prev.map(file => ({
        ...file,
        dataTypes: file.dataTypes.map(dt =>
          dt.id === dataTypeId ? { ...dt, enabled } : dt
        ),
      }))
    );
  }, []);

  const handleSelectAllDataTypes = useCallback(() => {
    setManagedFiles(prev =>
      prev.map(file => ({
        ...file,
        dataTypes: file.dataTypes.map(dt => ({ ...dt, enabled: true })),
      }))
    );
  }, []);

  const handleDeselectAllDataTypes = useCallback(() => {
    setManagedFiles(prev =>
      prev.map(file => ({
        ...file,
        dataTypes: file.dataTypes.map(dt => ({ ...dt, enabled: false })),
      }))
    );
  }, []);

  const handleToggleFileSelection = useCallback((fileId: string, selected: boolean) => {
    setManagedFiles(prev =>
      prev.map(file =>
        file.id === fileId ? { ...file, isSelected: selected } : file
      )
    );
  }, []);

  const handleStartMerge = useCallback((useServerSide: boolean) => {
    const selectedFiles = managedFiles.filter(file => file.isSelected);

    if (selectedFiles.length < 2) {
      console.error('Please select at least 2 files to merge');
      return;
    }

    void (async () => {
      try {
        const result = await JWLMerger.mergeFiles(selectedFiles, {
          useServerSide,
          onProgress: (status) => {
            console.warn('Merge progress:', status);
            // TODO: Show progress in UI
          },
        });

        if (result.success) {
          if (result.downloadUrl && result.fileName) {
            JWLMerger.downloadFile(result.downloadUrl, result.fileName);
          } else if (result.blob && result.fileName) {
            JWLMerger.downloadFile(result.blob, result.fileName);
          }
          setIsMergePanelOpen(false);
        } else {
          console.error(`Merge failed: ${result.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('Merge error:', error);
      }
    })();
  }, [managedFiles]);

  return (
    <main className="min-h-screen">
      {/* Hero Section */}
      <section className="px-6 py-12 md:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-6 text-4xl font-bold tracking-tight md:text-6xl">
            JWL Merge Web
          </h1>
          <p className="mb-8 text-lg text-muted-foreground md:text-xl">
            Merge and manage your JWL library files with ease. Process files securely in your browser with complete privacy.
          </p>
        </div>
      </section>

      {/* Upload Section */}
      <section className="px-6 pb-12">
        <div className="mx-auto max-w-4xl">
          <FileUploadZone onValidatedFiles={handleValidatedFiles} />
        </div>
      </section>

      {/* File Management Section */}
      {managedFiles.length > 0 && (
        <section className="px-6 pb-12">
          <div className="mx-auto max-w-6xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">File Management</h2>
              {managedFiles.length >= 2 && (
                <Button
                  onClick={() => { setIsMergePanelOpen(true); }}
                  className="bg-green-600 hover:bg-green-700"
                >
                  Configure Merge
                </Button>
              )}
            </div>

            <FileManagementGrid
              managedFiles={managedFiles}
              onDataTypeToggle={handleDataTypeToggle}
              onRemoveFile={handleRemoveFile}
              onToggleSelection={handleToggleFileSelection}
            />
          </div>
        </section>
      )}

      {/* Privacy Section - Below the fold */}
      <section className="px-6 pb-20">
        <PrivacyStatement />
      </section>

      {/* Merge Configuration Panel */}
      <MergeConfigurationPanel
        managedFiles={managedFiles}
        isOpen={isMergePanelOpen}
        onClose={() => setIsMergePanelOpen(false)}
        onGlobalDataTypeToggle={handleGlobalDataTypeToggle}
        onSelectAll={handleSelectAllDataTypes}
        onDeselectAll={handleDeselectAllDataTypes}
        onStartMerge={handleStartMerge}
      />
    </main>
  );
}