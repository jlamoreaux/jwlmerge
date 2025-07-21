import { NextResponse } from 'next/server';

import { supabase } from '@/lib/supabase/client';

export async function GET(): Promise<NextResponse> {
  try {
    // Test Supabase connection
    const { error } = await supabase
      .from('merges')
      .select('count')
      .limit(1);

    if (error) {
      throw error;
    }

    // Test environment variables
    const hasRequiredEnvVars = !!(
      process.env.BLOB_READ_WRITE_TOKEN &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        supabase: 'connected',
        vercel_blob: hasRequiredEnvVars ? 'configured' : 'missing_config',
      },
      environment: process.env.NODE_ENV || 'development',
    });

  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}