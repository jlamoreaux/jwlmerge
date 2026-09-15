/**
 * Tests for MergeOrchestrator.
 *
 * The orchestrator is the only thing between the UI and the merge itself, and
 * it used to carry a second "server-side" path that never existed. These cover
 * what it does now: assess the device, run the browser merge, report timing.
 */

import { describe, test, expect } from 'bun:test';

import { MergeOrchestrator } from '../lib/merge/merge-orchestrator';

import type { ManagedFile } from '../lib/types/file-management';

/** A ManagedFile of a given size; the bytes are never read by these tests. */
function fileOfSize(name: string, megabytes: number): ManagedFile {
  return {
    id: name,
    file: { name, size: Math.round(megabytes * 1024 * 1024) } as File,
    metadata: { fileName: name, fileSize: Math.round(megabytes * 1024 * 1024) },
    dataTypes: [{ id: 'notes', name: 'Notes', description: '', enabled: true }],
    isSelected: true,
  };
}

describe('MergeOrchestrator', () => {
  test('accepts a pair of ordinary backups', () => {
    const assessment = MergeOrchestrator.canProcessClientSide([
      fileOfSize('a.jwlibrary', 4),
      fileOfSize('b.jwlibrary', 4),
    ]);

    expect(assessment.feasible).toBe(true);
  });

  test('refuses files too large for a browser to hold', () => {
    const assessment = MergeOrchestrator.canProcessClientSide([
      fileOfSize('huge-a.jwlibrary', 150),
      fileOfSize('huge-b.jwlibrary', 150),
    ]);

    expect(assessment.feasible).toBe(false);
    expect(assessment.reason).toMatch(/too large/i);
  });

  test('refuses the merge rather than attempting it, when the device cannot cope', async () => {
    // There is no server to fall back to, so an infeasible merge has to fail
    // with a reason instead of silently producing something.
    const result = await MergeOrchestrator.orchestrateMerge([
      fileOfSize('huge-a.jwlibrary', 150),
      fileOfSize('huge-b.jwlibrary', 150),
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too large/i);
    expect(typeof result.processingTime).toBe('number');
  });

  test('estimates scale with file size', () => {
    const small = MergeOrchestrator.estimateProcessingTime([fileOfSize('s.jwlibrary', 1)]);
    const large = MergeOrchestrator.estimateProcessingTime([fileOfSize('l.jwlibrary', 40)]);

    expect(small.estimate).toMatch(/seconds/);
    expect(large.confidence).toBe('low');
  });

  test('reports suitability, not a choice of where to process', () => {
    const { recommendation } = MergeOrchestrator.getRecommendation([
      fileOfSize('a.jwlibrary', 2),
      fileOfSize('b.jwlibrary', 2),
    ]);

    expect(['comfortable', 'slow', 'risky']).toContain(recommendation.suitability);
    expect(recommendation).not.toHaveProperty('mode');
  });
});
