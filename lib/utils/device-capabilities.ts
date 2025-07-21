/**
 * Device capability scoring for intelligent processing mode selection
 */

export interface DeviceCapabilities {
  score: 'low' | 'medium' | 'high';
  memory: number | 'unknown';
  cpuCores: number | 'unknown';
  isLowPower: boolean;
  isMobile: boolean;
  details: {
    memoryGB?: number;
    effectiveCpuCores: number;
    userAgent: string;
  };
}

/**
 * Detect device capabilities using available browser APIs
 */
export function detectDeviceCapabilities(): DeviceCapabilities {
  if (typeof window === 'undefined') {
    // Server-side fallback
    return {
      score: 'medium',
      memory: 'unknown',
      cpuCores: 'unknown',
      isLowPower: false,
      isMobile: false,
      details: {
        effectiveCpuCores: 4,
        userAgent: 'server',
      },
    };
  }

  // Get hardware information
  const memory = (globalThis.navigator as { deviceMemory?: number }).deviceMemory || 'unknown';
  const cpuCores = globalThis.navigator.hardwareConcurrency || 'unknown';
  const userAgent = globalThis.navigator.userAgent;

  // Detect mobile devices
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);

  // Detect low-power devices (based on user agent hints)
  const isLowPower = /iPhone|iPad|iPod|Android.*Mobile/i.test(userAgent) ||
                    (typeof memory === 'number' && memory <= 2) ||
                    (typeof cpuCores === 'number' && cpuCores <= 2);

  // Calculate effective CPU cores (mobile devices often have heterogeneous cores)
  let effectiveCpuCores = cpuCores === 'unknown' ? 4 : cpuCores;
  if (isMobile && effectiveCpuCores > 4) {
    // Mobile devices often have big.LITTLE architecture
    // Assume only half the cores are high-performance
    effectiveCpuCores = Math.ceil(effectiveCpuCores / 2);
  }

  // Calculate capability score
  let score: 'low' | 'medium' | 'high' = 'medium';

  if (memory !== 'unknown' && cpuCores !== 'unknown') {
    // Detailed scoring based on available data
    let memoryScore: number;
    if (memory <= 2) {
      memoryScore = 0;
    } else if (memory <= 4) {
      memoryScore = 1;
    } else if (memory <= 8) {
      memoryScore = 2;
    } else {
      memoryScore = 3;
    }

    let cpuScore: number;
    if (effectiveCpuCores <= 2) {
      cpuScore = 0;
    } else if (effectiveCpuCores <= 4) {
      cpuScore = 1;
    } else if (effectiveCpuCores <= 8) {
      cpuScore = 2;
    } else {
      cpuScore = 3;
    }

    const mobilePenalty = isMobile ? -1 : 0;

    const totalScore = memoryScore + cpuScore + mobilePenalty;

    if (totalScore <= 1) {
      score = 'low';
    } else if (totalScore <= 3) {
      score = 'medium';
    } else {
      score = 'high';
    }
  } else {
    // Fallback scoring based on limited data
    if (isLowPower || isMobile) {
      score = 'low';
    } else if (cpuCores !== 'unknown' && cpuCores >= 8) {
      score = 'high';
    }
  }

  return {
    score,
    memory,
    cpuCores,
    isLowPower,
    isMobile,
    details: {
      ...(memory !== 'unknown' && { memoryGB: memory }),
      effectiveCpuCores,
      userAgent,
    },
  };
}

/**
 * Check if device can handle client-side processing for given file size
 */
export function canHandleClientSideProcessing(
  capabilities: DeviceCapabilities,
  totalFileSizeBytes: number
): {
  canHandle: boolean;
  confidence: 'low' | 'medium' | 'high';
  reason: string;
} {
  const totalSizeMB = totalFileSizeBytes / (1024 * 1024);

  // Size thresholds based on device capability
  const thresholds = {
    low: { safe: 10, risky: 25 },
    medium: { safe: 25, risky: 50 },
    high: { safe: 50, risky: 100 },
  };

  const threshold = thresholds[capabilities.score];

  if (totalSizeMB <= threshold.safe) {
    return {
      canHandle: true,
      confidence: 'high',
      reason: `Small file size (${totalSizeMB.toFixed(1)}MB) is safe for ${capabilities.score}-end device`,
    };
  } else if (totalSizeMB <= threshold.risky) {
    return {
      canHandle: true,
      confidence: capabilities.score === 'high' ? 'medium' : 'low',
      reason: `Medium file size (${totalSizeMB.toFixed(1)}MB) may be slow on ${capabilities.score}-end device`,
    };
  } else {
    return {
      canHandle: false,
      confidence: 'low',
      reason: `Large file size (${totalSizeMB.toFixed(1)}MB) likely to fail on ${capabilities.score}-end device`,
    };
  }
}

/**
 * Get processing mode recommendation based on file size and device capabilities
 */
export function getProcessingRecommendation(
  totalFileSizeBytes: number,
  capabilities?: DeviceCapabilities
): {
  mode: 'client' | 'server';
  confidence: 'low' | 'medium' | 'high';
  reason: string;
  warning?: string;
} {
  const caps = capabilities || detectDeviceCapabilities();
  const clientAssessment = canHandleClientSideProcessing(caps, totalFileSizeBytes);
  const totalSizeMB = totalFileSizeBytes / (1024 * 1024);

  // Always recommend server for very large files
  if (totalSizeMB > 75) {
    return {
      mode: 'server',
      confidence: 'high',
      reason: `Files over 75MB (${totalSizeMB.toFixed(1)}MB) process much faster on our servers`,
      warning: 'Large files may cause browser crashes or extremely slow processing if done client-side',
    };
  }

  // Recommend server for low-end devices with medium+ files
  if (caps.score === 'low' && totalSizeMB > 15) {
    return {
      mode: 'server',
      confidence: 'medium',
      reason: `${totalSizeMB.toFixed(1)}MB may be too large for your device (${caps.isMobile ? 'mobile' : 'low-end'})`,
      warning: 'Client-side processing may freeze your browser or fail',
    };
  }

  // Recommend client-side for small files or privacy-conscious users
  if (clientAssessment.canHandle && clientAssessment.confidence !== 'low') {
    return {
      mode: 'client',
      confidence: clientAssessment.confidence,
      reason: `${clientAssessment.reason} - keeps your data completely private`,
    };
  }

  // Borderline cases - slight preference for server on medium+ files
  if (totalSizeMB > 25) {
    return {
      mode: 'server',
      confidence: 'medium',
      reason: `${totalSizeMB.toFixed(1)}MB files process significantly faster on our servers`,
      warning: 'Client-side processing will be slower and may use significant memory',
    };
  }

  // Default to client-side for privacy
  return {
    mode: 'client',
    confidence: 'medium',
    reason: 'Small files can be processed safely in your browser for maximum privacy',
  };
}