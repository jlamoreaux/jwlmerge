'use client';

import { useState, useCallback } from 'react';

import type { ManagedFile, JWLDataType } from '@/lib/types/file-management';
import type { JWLMetadata } from '@/lib/validation/jwl-validator';

import { FileManagementGrid } from '@/components/file-management/file-management-grid';
import { PrivacyStatement } from '@/components/privacy-statement';
import { FileUploadZone } from '@/components/upload/file-upload-zone';
import { DEFAULT_JWL_DATA_TYPES } from '@/lib/types/file-management';
import { generateUUID } from '@/lib/utils/uuid';

export default function Home() {
  const [managedFiles, setManagedFiles] = useState<ManagedFile[]>([]);

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
            <FileManagementGrid
              managedFiles={managedFiles}
              onDataTypeToggle={handleDataTypeToggle}
              onRemoveFile={handleRemoveFile}
            />
          </div>
        </section>
      )}

      {/* Privacy Section - Below the fold */}
      <section className="px-6 pb-20">
        <PrivacyStatement />
      </section>
    </main>
  );
}