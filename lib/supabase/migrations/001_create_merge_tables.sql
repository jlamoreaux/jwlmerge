-- Create extension for UUID generation if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create merges table to track merge operations
CREATE TABLE IF NOT EXISTS merges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_urls TEXT[] NOT NULL,
  merge_config JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result_url TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours'
);

-- Create merge_stats table for analytics and monitoring
CREATE TABLE IF NOT EXISTS merge_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merge_id UUID REFERENCES merges(id) ON DELETE CASCADE,
  file_count INTEGER NOT NULL,
  total_size_bytes BIGINT NOT NULL,
  processing_time_ms INTEGER,
  data_types JSONB NOT NULL,
  success BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_merges_status ON merges(status);
CREATE INDEX IF NOT EXISTS idx_merges_created_at ON merges(created_at);
CREATE INDEX IF NOT EXISTS idx_merges_expires_at ON merges(expires_at);
CREATE INDEX IF NOT EXISTS idx_merge_stats_merge_id ON merge_stats(merge_id);
CREATE INDEX IF NOT EXISTS idx_merge_stats_created_at ON merge_stats(created_at);

-- Create updated_at trigger for merges table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_merges_updated_at 
    BEFORE UPDATE ON merges 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create a function to clean up expired merges
CREATE OR REPLACE FUNCTION cleanup_expired_merges()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM merges 
    WHERE expires_at < NOW() 
    AND status IN ('completed', 'failed');
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE merges IS 'Stores information about JWL file merge operations';
COMMENT ON TABLE merge_stats IS 'Stores analytics and statistics for merge operations';
COMMENT ON COLUMN merges.file_urls IS 'Array of Vercel Blob Storage URLs for input files';
COMMENT ON COLUMN merges.merge_config IS 'JSON configuration specifying which data types to merge';
COMMENT ON COLUMN merges.result_url IS 'Vercel Blob Storage URL for the merged result file';
COMMENT ON COLUMN merge_stats.data_types IS 'JSON object tracking which data types were processed';