import type { ManagedFile } from '@/lib/types/file-management';

export interface FileSizeInfo {
  totalBytes: number;
  totalMB: number;
  selectedBytes: number;
  selectedMB: number;
  fileCount: number;
  selectedCount: number;
  largestFile: {
    name: string;
    size: number;
    sizeMB: number;
  } | null;
}

/**
 * Calculate total file sizes and statistics
 */
export function calculateFileSizes(managedFiles: ManagedFile[]): FileSizeInfo {
  let totalBytes = 0;
  let selectedBytes = 0;
  let fileCount = 0;
  let selectedCount = 0;
  let largestFile: { name: string; size: number; sizeMB: number } | null = null;

  for (const file of managedFiles) {
    const fileSize = file.file.size;
    totalBytes += fileSize;
    fileCount++;

    // Track largest file
    if (!largestFile || fileSize > largestFile.size) {
      largestFile = {
        name: file.file.name,
        size: fileSize,
        sizeMB: fileSize / (1024 * 1024),
      };
    }

    // Count selected files
    if (file.isSelected) {
      selectedBytes += fileSize;
      selectedCount++;
    }
  }

  return {
    totalBytes,
    totalMB: totalBytes / (1024 * 1024),
    selectedBytes,
    selectedMB: selectedBytes / (1024 * 1024),
    fileCount,
    selectedCount,
    largestFile,
  };
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) {return '0 Bytes';}

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Get size category for UI styling
 */
export function getSizeCategory(sizeBytes: number): 'small' | 'medium' | 'large' | 'huge' {
  const sizeMB = sizeBytes / (1024 * 1024);

  if (sizeMB < 10) {return 'small';}
  if (sizeMB < 25) {return 'medium';}
  if (sizeMB < 50) {return 'large';}
  return 'huge';
}

/**
 * Get estimated processing time based on file size and processing mode
 */
export function getEstimatedProcessingTime(
  sizeBytes: number,
  mode: 'client' | 'server'
): {
  estimate: string;
  confidence: 'low' | 'medium' | 'high';
} {
  const sizeMB = sizeBytes / (1024 * 1024);

  if (mode === 'server') {
    // Server processing is generally faster and more predictable
    if (sizeMB < 10) {
      return { estimate: '5-15 seconds', confidence: 'high' };
    } else if (sizeMB < 25) {
      return { estimate: '15-30 seconds', confidence: 'high' };
    } else if (sizeMB < 50) {
      return { estimate: '30-60 seconds', confidence: 'medium' };
    } else {
      return { estimate: '1-3 minutes', confidence: 'medium' };
    }
  } else {
    // Client processing varies significantly by device
    if (sizeMB < 5) {
      return { estimate: '10-30 seconds', confidence: 'medium' };
    } else if (sizeMB < 15) {
      return { estimate: '30-90 seconds', confidence: 'medium' };
    } else if (sizeMB < 30) {
      return { estimate: '1-5 minutes', confidence: 'low' };
    } else {
      return { estimate: '2-10+ minutes', confidence: 'low' };
    }
  }
}

/**
 * Check if files exceed recommended limits for different processing modes
 */
export function checkSizeLimits(sizeBytes: number): {
  clientSide: {
    safe: boolean;
    warning: boolean;
    critical: boolean;
  };
  serverSide: {
    safe: boolean;
    warning: boolean;
    critical: boolean;
  };
} {
  const sizeMB = sizeBytes / (1024 * 1024);

  return {
    clientSide: {
      safe: sizeMB <= 15,
      warning: sizeMB > 15 && sizeMB <= 35,
      critical: sizeMB > 35,
    },
    serverSide: {
      safe: sizeMB <= 75,
      warning: sizeMB > 75 && sizeMB <= 150,
      critical: sizeMB > 150,
    },
  };
}