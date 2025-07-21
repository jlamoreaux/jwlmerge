/**
 * Generate a UUID v4 string
 * Falls back to a random string generator for browsers that don't support crypto.randomUUID
 */
export function generateUUID(): string {
  // Try to use the native crypto.randomUUID if available
  if (typeof globalThis !== 'undefined' &&
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  // Fallback for browsers without crypto.randomUUID support
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}