/**
 * Tests for MergeWorkerClient's promise settlement.
 *
 * Every failure path has to settle the promise mergeFiles() returns. A path
 * that only throws leaves the merge button spinning with no error, which is
 * indistinguishable to the user from a merge that is still running.
 */

import { describe, test, expect, afterEach } from 'bun:test';

import { MergeWorkerClient } from '../lib/workers/merge-worker-client';

import type { ManagedFile } from '../lib/types/file-management';

/** A Worker that accepts handlers and does nothing else. */
class InertWorker {
  onmessage: unknown = null;
  onerror: unknown = null;
  postMessage() {}
  terminate() {}
}

const originalWorker = (globalThis as { Worker?: unknown }).Worker;

afterEach(() => {
  (globalThis as { Worker?: unknown }).Worker = originalWorker;
});

/** A ManagedFile whose bytes cannot be read. */
function unreadableFile(name: string): ManagedFile {
  return {
    id: name,
    file: {
      name,
      size: 1024,
      arrayBuffer: () => Promise.reject(new Error('could not read file')),
    } as unknown as File,
    metadata: { fileName: name, fileSize: 1024 },
    dataTypes: [{ id: 'notes', name: 'Notes', description: '', enabled: true }],
    isSelected: true,
  };
}

/**
 * Settle with the rejection reason, or with null if the promise resolved or
 * never settled at all. A hang has to surface as a failed assertion rather
 * than a hung test run.
 */
async function rejectionOf(promise: Promise<unknown>, ms = 5000): Promise<Error | null> {
  const timeout = new Promise<Error>(resolve =>
    setTimeout(() => resolve(new Error('mergeFiles() never settled')), ms)
  );

  return Promise.race([
    promise.then(
      () => null,
      (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
    ),
    timeout,
  ]);
}

describe('MergeWorkerClient', () => {
  test('rejects when a source file cannot be read', async () => {
    (globalThis as { Worker?: unknown }).Worker = InertWorker;

    const client = new MergeWorkerClient();
    const merge = client.mergeFiles([unreadableFile('a.jwlibrary'), unreadableFile('b.jwlibrary')]);

    const error = await rejectionOf(merge);
    expect(error?.message).toMatch(/could not read file|Failed to prepare files/);
    client.terminate();
  });

  test('rejects when the worker is terminated before the files are sent', async () => {
    (globalThis as { Worker?: unknown }).Worker = InertWorker;

    const client = new MergeWorkerClient();
    const slowFile = {
      id: 'slow',
      file: {
        name: 'slow.jwlibrary',
        size: 1024,
        arrayBuffer: () => new Promise<ArrayBuffer>(resolve => setTimeout(() => resolve(new ArrayBuffer(8)), 20)),
      } as unknown as File,
      metadata: { fileName: 'slow.jwlibrary', fileSize: 1024 },
      dataTypes: [{ id: 'notes', name: 'Notes', description: '', enabled: true }],
      isSelected: true,
    } as ManagedFile;

    const merge = client.mergeFiles([slowFile, slowFile]);
    client.terminate(); // e.g. the user navigates away mid-merge

    const error = await rejectionOf(merge);
    expect(error?.message).toMatch(/cancelled before the files could be sent/);
  });
});
