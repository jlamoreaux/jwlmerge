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
 * Rough time estimate for merging this much data in the browser.
 */
export function getEstimatedProcessingTime(sizeBytes: number): {
  estimate: string;
  confidence: 'low' | 'medium' | 'high';
} {
  const sizeMB = sizeBytes / (1024 * 1024);

  if (sizeMB < 5) {return { estimate: '10-30 seconds', confidence: 'medium' };}
  if (sizeMB < 15) {return { estimate: '30-90 seconds', confidence: 'medium' };}
  if (sizeMB < 30) {return { estimate: '1-5 minutes', confidence: 'low' };}

  return { estimate: '2-10+ minutes', confidence: 'low' };
}

/**
 * Where this much data sits against the limits of browser-based merging.
 */
export function checkSizeLimits(sizeBytes: number): {
  safe: boolean;
  warning: boolean;
  critical: boolean;
} {
  const sizeMB = sizeBytes / (1024 * 1024);

  return {
    safe: sizeMB <= 15,
    warning: sizeMB > 15 && sizeMB <= 35,
    critical: sizeMB > 35,
  };
}