export interface MergeRecord {
  id: string;
  file_urls: string[];
  merge_config: MergeConfig;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result_url?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface MergeStatsRecord {
  id: string;
  merge_id: string;
  file_count: number;
  total_size_bytes: number;
  processing_time_ms?: number;
  data_types: Record<string, boolean>;
  success: boolean;
  created_at: string;
}

export interface MergeConfig {
  files: Array<{
    url: string;
    fileName: string;
    size: number;
    dataTypes: Record<string, boolean>;
  }>;
  globalDataTypes: Record<string, boolean>;
}

export interface CreateMergeRequest {
  file_urls: string[];
  merge_config: MergeConfig;
}

export interface MergeResponse {
  success: boolean;
  merge_id?: string;
  result_url?: string;
  error?: string;
}

export interface UploadResponse {
  success: boolean;
  url?: string;
  error?: string;
}