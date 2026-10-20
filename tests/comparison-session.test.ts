import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  saveComparisonSession,
  loadComparisonSession,
  clearComparisonSession,
  comparisonSessionStorageKey,
} from '../src/services/comparison-session';

function stubStorage() {
  const values: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    }),
  };
  vi.stubGlobal('chrome', { storage: { local } });
  return { values, local };
}

afterEach(() => vi.unstubAllGlobals());

describe('comparison session storage', () => {
  it('safely saves and loads comparison data without URL leakage', async () => {
    stubStorage();

    await saveComparisonSession({
      original: 'fix this query please',
      enhanced: 'Optimize the following SQL query for PostgreSQL 16...',
      mode: 'advanced',
    });

    const loaded = await loadComparisonSession();
    expect(loaded).toBeDefined();
    expect(loaded?.original).toBe('fix this query please');
    expect(loaded?.enhanced).toBe('Optimize the following SQL query for PostgreSQL 16...');
    expect(loaded?.mode).toBe('advanced');
    expect(typeof loaded?.createdAt).toBe('number');
  });

  it('handles missing or corrupted comparison data gracefully', async () => {
    const { values } = stubStorage();

    // Empty storage
    const emptyResult = await loadComparisonSession();
    expect(emptyResult).toBeNull();

    // Corrupted non-object data
    values[comparisonSessionStorageKey] = 'invalid-string';
    const corruptedResult = await loadComparisonSession();
    expect(corruptedResult).toBeNull();

    // Incomplete data missing original or enhanced text
    values[comparisonSessionStorageKey] = { original: 'only original' };
    const incompleteResult = await loadComparisonSession();
    expect(incompleteResult).toBeNull();
  });

  it('clears comparison session data on demand', async () => {
    const { values } = stubStorage();

    await saveComparisonSession({
      original: 'hello',
      enhanced: 'Hello.',
      mode: 'typo',
    });
    expect(values[comparisonSessionStorageKey]).toBeDefined();

    await clearComparisonSession();
    expect(values[comparisonSessionStorageKey]).toBeUndefined();
  });
});
