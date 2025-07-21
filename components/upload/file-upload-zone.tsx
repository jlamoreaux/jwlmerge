'use client';

import { Upload, FileIcon, X, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';

import { FileMetadataDisplay } from './file-metadata-display';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { generateUUID } from '@/lib/utils/uuid';
import { JWLValidator, validateJWLFileBasic, type ValidationResult, type JWLMetadata } from '@/lib/validation/jwl-validator';

interface UploadedFile {
  file: File;
  id: string;
  status: 'pending' | 'validating' | 'valid' | 'error';
  error?: string | undefined;
  errorType?: string | undefined;
  metadata?: JWLMetadata | undefined;
}

interface FileUploadZoneProps {
  onFilesSelected?: (_files: File[]) => void;
  onValidatedFiles?: (_files: Array<{ file: File; metadata: JWLMetadata }>) => void;
  maxFiles?: number;
  className?: string;
}

export function FileUploadZone({
  onFilesSelected,
  onValidatedFiles,
  maxFiles = 10,
  className,
}: FileUploadZoneProps) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  const validateFileAsync = async (uploadedFile: UploadedFile): Promise<void> => {
    // Update status to validating
    setUploadedFiles((prev) =>
      prev.map((f) =>
        f.id === uploadedFile.id ? { ...f, status: 'validating' } : f
      )
    );

    try {
      const result: ValidationResult = await JWLValidator.validateFile(uploadedFile.file);

      setUploadedFiles((prev) =>
        prev.map((f) =>
          f.id === uploadedFile.id
            ? {
                ...f,
                status: result.isValid ? 'valid' : 'error',
                error: result.error,
                errorType: result.errorType,
                metadata: result.metadata,
              }
            : f
        )
      );

      // Notify parent of valid files with metadata
      if (result.isValid && result.metadata) {
        if (onValidatedFiles) {
          // Get all currently valid files including this one
          const allValidFiles = uploadedFiles
            .filter((f) => f.status === 'valid' && f.metadata)
            .map((f) => ({ file: f.file, metadata: f.metadata as JWLMetadata }));

          allValidFiles.push({ file: uploadedFile.file, metadata: result.metadata });
          onValidatedFiles(allValidFiles);
        }

        if (onFilesSelected) {
          const validFiles = uploadedFiles
            .filter((f) => f.status === 'valid')
            .map((f) => f.file);
          validFiles.push(uploadedFile.file);
          onFilesSelected(validFiles);
        }
      }
    } catch (error) {
      setUploadedFiles((prev) =>
        prev.map((f) =>
          f.id === uploadedFile.id
            ? {
                ...f,
                status: 'error',
                error: error instanceof Error ? error.message : 'Validation failed',
                errorType: 'corrupted',
              }
            : f
        )
      );
    }
  };

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      const newFiles: UploadedFile[] = [];

      // Handle accepted files
      acceptedFiles.forEach((file) => {
        const basicError = validateJWLFileBasic(file);
        const uploadedFile: UploadedFile = {
          file,
          id: generateUUID(),
          status: basicError ? 'error' : 'pending',
          error: basicError || undefined,
          errorType: basicError ? 'extension' : undefined,
        };
        newFiles.push(uploadedFile);
      });

      // Handle rejected files
      rejectedFiles.forEach((rejection) => {
        newFiles.push({
          file: rejection.file,
          id: generateUUID(),
          status: 'error',
          error: rejection.errors[0]?.message || 'File rejected',
          errorType: 'extension',
        });
      });

      setUploadedFiles((prev) => [...prev, ...newFiles]);

      // Start async validation for files that passed basic validation
      newFiles
        .filter((f) => f.status === 'pending')
        .forEach((uploadedFile) => {
          void validateFileAsync(uploadedFile);
        });
    },
    [onFilesSelected, uploadedFiles]
  );

  const removeFile = (id: string) => {
    setUploadedFiles((prev) => {
      const newFiles = prev.filter((f) => f.id !== id);

      // Update callbacks with remaining valid files
      const validFiles = newFiles.filter((f) => f.status === 'valid');

      if (onValidatedFiles) {
        const validFilesWithMetadata = validFiles
          .filter((f) => f.metadata)
          .map((f) => ({ file: f.file, metadata: f.metadata as JWLMetadata }));
        onValidatedFiles(validFilesWithMetadata);
      }

      if (onFilesSelected) {
        onFilesSelected(validFiles.map((f) => f.file));
      }

      return newFiles;
    });
  };

  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      onDrop,
      accept: {
        'application/octet-stream': ['.jwlibrary'],
      },
      maxFiles,
      multiple: true,
    });

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) {return '0 Bytes';}
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <div className={cn('w-full space-y-6', className)}>
      {/* Upload Zone */}
      <div
        {...getRootProps()}
        className={cn(
          'relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-all duration-200',
          'hover:border-primary/50 hover:bg-primary/5',
          isDragActive && !isDragReject && 'border-primary bg-primary/10',
          isDragReject && 'border-destructive bg-destructive/10',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
        )}
      >
        <input {...getInputProps()} />

        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Upload className="h-6 w-6 text-primary" />
        </div>

        <div className="space-y-2">
          <h3 className="text-lg font-semibold">
            {(() => {
              if (isDragActive && isDragReject) {return 'Invalid file type';}
              if (isDragActive) {return 'Drop your files here';}
              return 'Upload JWL Library Files';
            })()}
          </h3>

          <p className="text-sm text-muted-foreground">
            {(() => {
              if (isDragActive && isDragReject) {return 'Only .jwlibrary files are supported';}
              if (isDragActive) {return 'Release to upload files';}
              return 'Drag and drop your .jwlibrary files here, or click to browse';
            })()}
          </p>
        </div>

        <div className="mt-6">
          <Button variant="outline" size="sm" className="pointer-events-none">
            Browse Files
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Supports .jwlibrary files up to 100MB each
        </p>
      </div>

      {/* File List */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Selected Files</h4>
          <div className="space-y-2">
            {uploadedFiles.map((uploadedFile) => (
              <div
                key={uploadedFile.id}
                className={cn(
                  'flex items-center justify-between rounded-lg border p-3',
                  uploadedFile.status === 'error' &&
                    'border-destructive/20 bg-destructive/5',
                  uploadedFile.status === 'valid' &&
                    'border-green-200 bg-green-50',
                  uploadedFile.status === 'validating' &&
                    'border-blue-200 bg-blue-50'
                )}
              >
                <div className="flex items-center space-x-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                    {(() => {
                      if (uploadedFile.status === 'error') {
                        return <AlertCircle className="h-4 w-4 text-destructive" />;
                      }
                      if (uploadedFile.status === 'validating') {
                        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
                      }
                      if (uploadedFile.status === 'valid') {
                        return <CheckCircle className="h-4 w-4 text-green-600" />;
                      }
                      return <FileIcon className="h-4 w-4" />;
                    })()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {uploadedFile.file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(uploadedFile.file.size)}
                      {uploadedFile.status === 'validating' && ' • Validating...'}
                      {uploadedFile.status === 'valid' && ' • Valid JWL file'}
                    </p>
                    {uploadedFile.error && (
                      <p className="text-xs text-destructive">
                        {uploadedFile.error}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFile(uploadedFile.id)}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* Metadata Display for Valid Files */}
          {uploadedFiles.some((f) => f.status === 'valid' && f.metadata) && (
            <div className="mt-6 space-y-4">
              <h4 className="text-sm font-medium">File Details</h4>
              <div className="grid gap-4 md:grid-cols-2">
                {uploadedFiles
                  .filter((f) => f.status === 'valid' && f.metadata)
                  .map((uploadedFile) => (
                    <FileMetadataDisplay
                      key={uploadedFile.id}
                      metadata={uploadedFile.metadata as JWLMetadata}
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}