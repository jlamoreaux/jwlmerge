import type { CreateMergeRequest, MergeResponse, UploadResponse } from '@/lib/types/database';

/**
 * Upload a file to Vercel Blob Storage
 */
export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  return response.json();
}

/**
 * Start a merge operation
 */
export async function startMerge(request: CreateMergeRequest): Promise<MergeResponse> {
  const response = await fetch('/api/merge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  return response.json();
}

/**
 * Get download URL for a completed merge
 */
export function getDownloadUrl(mergeId: string): string {
  return `/api/download/${mergeId}`;
}

/**
 * Check API health status
 */
export async function checkHealth(): Promise<{ success: boolean; database?: boolean; storage?: boolean; error?: string }> {
  const response = await fetch('/api/health');
  return response.json();
}

/**
 * Poll merge status until completion
 */
export async function pollMergeStatus(
  mergeId: string,
  onUpdate?: (status: string) => void,
  maxAttempts: number = 30,
  intervalMs: number = 2000
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(getDownloadUrl(mergeId), {
        method: 'HEAD' // Use HEAD to check status without downloading
      });

      if (response.ok) {
        onUpdate?.('completed');
        return 'completed';
      } else if (response.status === 400) {
        const data = await response.json();
        if (data.status) {
          onUpdate?.(data.status);
          if (data.status === 'failed') {
            throw new Error(data.message || 'Merge failed');
          }
        }
      } else if (response.status === 410) {
        throw new Error('Merge has expired');
      }
    } catch (error) {
      if (attempt === maxAttempts - 1) {
        throw error;
      }
    }

    // Wait before next attempt
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error('Merge operation timed out');
}