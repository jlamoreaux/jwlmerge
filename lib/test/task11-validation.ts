/**
 * Validation tests for Task 11: Intelligent Processing Mode Selection
 * This module provides comprehensive testing for all Task 11 components
 */

import type { ManagedFile } from '@/lib/types/file-management';

import { MergeOrchestrator } from '@/lib/merge/merge-orchestrator';
import { detectDeviceCapabilities } from '@/lib/utils/device-capabilities';
import { calculateFileSizes, getEstimatedProcessingTime } from '@/lib/utils/file-size-tracker';
import { isWebWorkerSupported, canHandleClientMerge } from '@/lib/workers/merge-worker-client';

export interface ValidationResult {
  component: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: unknown;
}

export interface Task11ValidationReport {
  overallStatus: 'pass' | 'fail' | 'warning';
  results: ValidationResult[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  systemInfo: {
    deviceCapabilities: ReturnType<typeof detectDeviceCapabilities>;
    webWorkerSupport: boolean;
    browserInfo: {
      userAgent: string;
      memory: number | 'unknown';
      cpuCores: number | 'unknown';
    };
  };
}

/**
 * Create mock managed files for testing
 */
function createMockManagedFiles(configs: Array<{
  name: string;
  sizeMB: number;
  enabledDataTypes?: string[];
}>): ManagedFile[] {
  return configs.map(config => {
    const sizeBytes = config.sizeMB * 1024 * 1024;
    const mockFile = new File([new ArrayBuffer(sizeBytes)], config.name, {
      type: 'application/octet-stream'
    });

    const dataTypes = [
      { id: 'notes', name: 'Notes', description: 'Personal notes and annotations', enabled: false },
      { id: 'bookmarks', name: 'Bookmarks', description: 'Saved bookmarks', enabled: false },
      { id: 'highlights', name: 'Highlights', description: 'Text highlights', enabled: false },
      { id: 'tags', name: 'Tags', description: 'Tagged items', enabled: false },
      { id: 'inputfields', name: 'Input Fields', description: 'Form input data', enabled: false },
      { id: 'playlists', name: 'Playlists', description: 'Saved playlists', enabled: false },
    ];

    // Enable specified data types
    if (config.enabledDataTypes) {
      config.enabledDataTypes.forEach(id => {
        const dt = dataTypes.find(d => d.id === id);
        if (dt) {dt.enabled = true;}
      });
    } else {
      // Default: enable notes and bookmarks
      const notesType = dataTypes[0];
      const bookmarksType = dataTypes[1];
      if (notesType) {notesType.enabled = true;}
      if (bookmarksType) {bookmarksType.enabled = true;}
    }

    return {
      id: `test-${Date.now()}-${Math.random()}`,
      file: mockFile,
      isSelected: true,
      dataTypes,
      metadata: {
        deviceName: 'Test Device',
        creationDate: new Date().toISOString(),
        hash: `test-hash-${Date.now()}`,
        version: '1.0',
        fileSize: sizeBytes,
        fileName: config.name,
      },
    };
  });
}

/**
 * Test device capability detection
 */
function testDeviceCapabilities(): ValidationResult {
  try {
    const capabilities = detectDeviceCapabilities();

    // Validate that we get reasonable values
    const hasValidScore = ['low', 'medium', 'high'].includes(capabilities.score);
    const hasMemoryInfo = capabilities.memory === 'unknown' || (typeof capabilities.memory === 'number' && capabilities.memory > 0);
    const hasCpuInfo = capabilities.cpuCores === 'unknown' || (typeof capabilities.cpuCores === 'number' && capabilities.cpuCores > 0);

    if (!hasValidScore) {
      return {
        component: 'Device Capabilities',
        status: 'fail',
        message: `Invalid device capability score: ${capabilities.score}`,
        details: capabilities,
      };
    }

    if (!hasMemoryInfo || !hasCpuInfo) {
      return {
        component: 'Device Capabilities',
        status: 'warning',
        message: 'Some device info unavailable (normal on some browsers)',
        details: capabilities,
      };
    }

    return {
      component: 'Device Capabilities',
      status: 'pass',
      message: `Device detected as ${capabilities.score}-end with ${capabilities.memory}GB RAM, ${capabilities.cpuCores} cores`,
      details: capabilities,
    };
  } catch (error) {
    return {
      component: 'Device Capabilities',
      status: 'fail',
      message: `Detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Test file size calculations
 */
function testFileSizeCalculations(): ValidationResult {
  try {
    const mockFiles = createMockManagedFiles([
      { name: 'small.jwlibrary', sizeMB: 5 },
      { name: 'medium.jwlibrary', sizeMB: 25 },
      { name: 'large.jwlibrary', sizeMB: 50 },
    ]);

    const fileSizeInfo = calculateFileSizes(mockFiles);

    const expectedTotalMB = 5 + 25 + 50;
    const actualTotalMB = Math.round(fileSizeInfo.totalMB);

    if (Math.abs(actualTotalMB - expectedTotalMB) > 1) {
      return {
        component: 'File Size Calculation',
        status: 'fail',
        message: `Size calculation incorrect: expected ~${expectedTotalMB}MB, got ${actualTotalMB}MB`,
        details: fileSizeInfo,
      };
    }

    if (!fileSizeInfo.largestFile || Math.abs(fileSizeInfo.largestFile.sizeMB - 50) > 1) {
      return {
        component: 'File Size Calculation',
        status: 'fail',
        message: `Largest file detection incorrect: expected 50MB, got ${fileSizeInfo.largestFile?.sizeMB}MB`,
        details: fileSizeInfo,
      };
    }

    return {
      component: 'File Size Calculation',
      status: 'pass',
      message: `Correctly calculated ${actualTotalMB}MB total, largest file: ${fileSizeInfo.largestFile?.name}`,
      details: fileSizeInfo,
    };
  } catch (error) {
    return {
      component: 'File Size Calculation',
      status: 'fail',
      message: `Calculation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Test processing recommendations
 */
function testProcessingRecommendations(): ValidationResult {
  try {
    const testScenarios = [
      { name: 'Small files', files: [{ name: 'small.jwlibrary', sizeMB: 5 }], expectedMode: 'client' },
      { name: 'Large files', files: [{ name: 'large.jwlibrary', sizeMB: 80 }], expectedMode: 'server' },
      { name: 'Medium files', files: [{ name: 'med1.jwlibrary', sizeMB: 20 }, { name: 'med2.jwlibrary', sizeMB: 15 }] },
    ];

    const results: string[] = [];

    for (const scenario of testScenarios) {
      const mockFiles = createMockManagedFiles(scenario.files);
      const { recommendation } = MergeOrchestrator.getRecommendation(mockFiles);

      results.push(`${scenario.name}: recommended ${recommendation.mode} (${recommendation.confidence} confidence)`);

      if (scenario.expectedMode && recommendation.mode !== scenario.expectedMode) {
        return {
          component: 'Processing Recommendations',
          status: 'fail',
          message: `Unexpected recommendation for ${scenario.name}: expected ${scenario.expectedMode}, got ${recommendation.mode}`,
          details: { scenario, recommendation },
        };
      }
    }

    return {
      component: 'Processing Recommendations',
      status: 'pass',
      message: 'All recommendation scenarios passed',
      details: results,
    };
  } catch (error) {
    return {
      component: 'Processing Recommendations',
      status: 'fail',
      message: `Recommendation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Test Web Worker support
 */
function testWebWorkerSupport(): ValidationResult {
  try {
    const isSupported = isWebWorkerSupported();

    return {
      component: 'Web Worker Support',
      status: isSupported ? 'pass' : 'warning',
      message: isSupported ? 'Web Workers are supported' : 'Web Workers not supported (fallback will be used)',
      details: { supported: isSupported },
    };
  } catch (error) {
    return {
      component: 'Web Worker Support',
      status: 'fail',
      message: `Support check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Test client-side processing capability assessment
 */
function testClientSideCapabilityAssessment(): ValidationResult {
  try {
    const testCases = [
      { sizeMB: 5, memory: 4, expectedCanHandle: true },
      { sizeMB: 50, memory: 2, expectedCanHandle: false },
      { sizeMB: 100, memory: 8, expectedCanHandle: false },
      { sizeMB: 15, memory: undefined, expectedCanHandle: true },
    ];

    for (const testCase of testCases) {
      const totalBytes = testCase.sizeMB * 1024 * 1024;
      const assessment = canHandleClientMerge(totalBytes, testCase.memory);

      if (assessment.canHandle !== testCase.expectedCanHandle) {
        return {
          component: 'Client-side Capability Assessment',
          status: 'fail',
          message: `Assessment failed for ${testCase.sizeMB}MB with ${testCase.memory || 'unknown'}GB RAM`,
          details: { testCase, assessment },
        };
      }
    }

    return {
      component: 'Client-side Capability Assessment',
      status: 'pass',
      message: 'All capability assessments passed',
      details: testCases,
    };
  } catch (error) {
    return {
      component: 'Client-side Capability Assessment',
      status: 'fail',
      message: `Assessment failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Test time estimation
 */
function testTimeEstimation(): ValidationResult {
  try {
    const testSizes = [5, 25, 50]; // MB
    const results: string[] = [];

    for (const sizeMB of testSizes) {
      const sizeBytes = sizeMB * 1024 * 1024;
      const clientTime = getEstimatedProcessingTime(sizeBytes, 'client');
      const serverTime = getEstimatedProcessingTime(sizeBytes, 'server');

      results.push(`${sizeMB}MB: client ${clientTime.estimate}, server ${serverTime.estimate}`);

      // Basic validation - server should generally be faster or similar for large files
      if (sizeMB > 30) {
        const clientSeconds = parseInt(clientTime.estimate.split('-')[0] || '60') || 60;
        const serverSeconds = parseInt(serverTime.estimate.split('-')[0] || '30') || 30;

        if (serverSeconds > clientSeconds * 2) {
          return {
            component: 'Time Estimation',
            status: 'warning',
            message: `Server estimate seems too high for ${sizeMB}MB files`,
            details: { clientTime, serverTime },
          };
        }
      }
    }

    return {
      component: 'Time Estimation',
      status: 'pass',
      message: 'Time estimations look reasonable',
      details: results,
    };
  } catch (error) {
    return {
      component: 'Time Estimation',
      status: 'fail',
      message: `Estimation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Run comprehensive validation of Task 11 implementation
 */
export function validateTask11Implementation(): Task11ValidationReport {
  const results: ValidationResult[] = [
    testDeviceCapabilities(),
    testFileSizeCalculations(),
    testProcessingRecommendations(),
    testWebWorkerSupport(),
    testClientSideCapabilityAssessment(),
    testTimeEstimation(),
  ];

  // Calculate summary
  const summary = {
    totalTests: results.length,
    passed: results.filter(r => r.status === 'pass').length,
    failed: results.filter(r => r.status === 'fail').length,
    warnings: results.filter(r => r.status === 'warning').length,
  };

  // Determine overall status
  let overallStatus: 'pass' | 'fail' | 'warning' = 'pass';
  if (summary.failed > 0) {
    overallStatus = 'fail';
  } else if (summary.warnings > 0) {
    overallStatus = 'warning';
  }

  // Gather system info
  const deviceCapabilities = detectDeviceCapabilities();
  const systemInfo = {
    deviceCapabilities,
    webWorkerSupport: isWebWorkerSupported(),
    browserInfo: {
      userAgent: typeof globalThis !== 'undefined' && typeof globalThis.navigator !== 'undefined' ? globalThis.navigator.userAgent : 'server',
      memory: deviceCapabilities.memory,
      cpuCores: deviceCapabilities.cpuCores,
    },
  };

  return {
    overallStatus,
    results,
    summary,
    systemInfo,
  };
}

/**
 * Generate a human-readable validation report
 */
export function generateValidationReport(): string {
  const report = validateTask11Implementation();

  let output = `
Task 11 Validation Report
========================

Overall Status: ${report.overallStatus.toUpperCase()}
Tests: ${report.summary.passed}/${report.summary.totalTests} passed`;

  if (report.summary.warnings > 0) {
    output += `, ${report.summary.warnings} warnings`;
  }
  if (report.summary.failed > 0) {
    output += `, ${report.summary.failed} failed`;
  }

  output += `

System Information:
- Device Capability: ${report.systemInfo.deviceCapabilities.score}-end
- Memory: ${report.systemInfo.deviceCapabilities.memory === 'unknown' ? 'Unknown' : `${report.systemInfo.deviceCapabilities.memory}GB`}
- CPU Cores: ${report.systemInfo.deviceCapabilities.cpuCores === 'unknown' ? 'Unknown' : `${report.systemInfo.deviceCapabilities.cpuCores}`}
- Mobile: ${report.systemInfo.deviceCapabilities.isMobile ? 'Yes' : 'No'}
- Web Workers: ${report.systemInfo.webWorkerSupport ? 'Supported' : 'Not supported'}

Test Results:
`;

  for (const result of report.results) {
    let icon: string;
    if (result.status === 'pass') {
      icon = '✅';
    } else if (result.status === 'warning') {
      icon = '⚠️';
    } else {
      icon = '❌';
    }
    output += `${icon} ${result.component}: ${result.message}\n`;
  }

  return output;
}

// Export test helper for creating mock files
export { createMockManagedFiles };