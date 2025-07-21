import { FileIcon, Smartphone, Calendar, Database, Hash, Globe } from 'lucide-react';

import type { JWLMetadata } from '@/lib/validation/jwl-validator';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface FileMetadataDisplayProps {
  metadata: JWLMetadata;
  className?: string;
}

export function FileMetadataDisplay({ metadata, className }: FileMetadataDisplayProps) {
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) {return '0 Bytes';}
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center space-x-2 text-base">
          <FileIcon className="h-4 w-4" />
          <span>File Information</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* File Name */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">File Name:</span>
          <span className="text-sm font-medium truncate max-w-[200px]" title={metadata.fileName}>
            {metadata.fileName}
          </span>
        </div>

        {/* File Size */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Size:</span>
          <Badge variant="secondary">{formatFileSize(metadata.fileSize)}</Badge>
        </div>

        {/* Device Name */}
        {metadata.deviceName && (
          <div className="flex items-center justify-between">
            <span className="flex items-center space-x-1 text-sm text-muted-foreground">
              <Smartphone className="h-3 w-3" />
              <span>Device:</span>
            </span>
            <span className="text-sm font-medium">{metadata.deviceName}</span>
          </div>
        )}

        {/* Creation Date */}
        {metadata.creationDate && (
          <div className="flex items-center justify-between">
            <span className="flex items-center space-x-1 text-sm text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>Created:</span>
            </span>
            <span className="text-sm font-medium">{metadata.creationDate}</span>
          </div>
        )}

        {/* Version */}
        {metadata.version && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Version:</span>
            <Badge variant="outline">{metadata.version}</Badge>
          </div>
        )}

        {/* Database Version */}
        {metadata.databaseVersion && (
          <div className="flex items-center justify-between">
            <span className="flex items-center space-x-1 text-sm text-muted-foreground">
              <Database className="h-3 w-3" />
              <span>DB Version:</span>
            </span>
            <span className="text-sm font-medium">{metadata.databaseVersion}</span>
          </div>
        )}

        {/* Locale */}
        {metadata.userDataLocale && (
          <div className="flex items-center justify-between">
            <span className="flex items-center space-x-1 text-sm text-muted-foreground">
              <Globe className="h-3 w-3" />
              <span>Locale:</span>
            </span>
            <span className="text-sm font-medium">{metadata.userDataLocale}</span>
          </div>
        )}

        {/* Hash (truncated) */}
        {metadata.hash && (
          <div className="flex items-center justify-between">
            <span className="flex items-center space-x-1 text-sm text-muted-foreground">
              <Hash className="h-3 w-3" />
              <span>Hash:</span>
            </span>
            <span className="text-xs font-mono bg-muted px-2 py-1 rounded max-w-[120px] truncate" title={metadata.hash}>
              {metadata.hash}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}