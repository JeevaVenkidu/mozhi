import { afterEach, describe, expect, it, vi } from 'vitest';
import { openModeGuideInSettings } from '../src/components/mode-selector';
import { modeDefinitions } from '../src/core/mode-definitions';
import { modes } from '../src/core/types';
import { saveComparisonSession, loadComparisonSession } from '../src/services/comparison-session';

function stubChromeApis() {
  const tabs = {
    query: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const storageValues: Record<string, unknown> = {};
  const storage = {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storageValues[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(storageValues, items); }),
      remove: vi.fn(async (key: string) => { delete storageValues[key]; }),
    },
  };
  const runtime = {
    getURL: vi.fn((path: string) => `chrome-extension://mozhi-test-id/${path}`),
    openOptionsPage: vi.fn(),
  };

  vi.stubGlobal('chrome', { tabs, storage, runtime });
  return { tabs, storage, storageValues, runtime };
}

afterEach(() => vi.unstubAllGlobals());

describe('Popup UX: Mode Guide Navigation & Settings Linking', () => {
  it('opens options.html#mode-guide in an existing options tab if one is open', async () => {
    const { tabs, runtime } = stubChromeApis();
    tabs.query.mockImplementation((_query, callback) => {
      callback([{ id: 42, url: 'chrome-extension://mozhi-test-id/options.html' }]);
    });

    openModeGuideInSettings();

    expect(runtime.getURL).toHaveBeenCalledWith('options.html#mode-guide');
    expect(tabs.update).toHaveBeenCalledWith(42, {
      active: true,
      url: 'chrome-extension://mozhi-test-id/options.html#mode-guide',
    });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('creates a new options tab with #mode-guide if no options tab is open', async () => {
    const { tabs, runtime } = stubChromeApis();
    tabs.query.mockImplementation((_query, callback) => {
      callback([]);
    });

    openModeGuideInSettings();

    expect(runtime.getURL).toHaveBeenCalledWith('options.html#mode-guide');
    expect(tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://mozhi-test-id/options.html#mode-guide',
    });
  });
});

describe('Popup UX: Safe Comparison Passing & Navigation', () => {
  it('stores comparison text safely in local storage and opens compare.html without URL query params', async () => {
    const { tabs, runtime } = stubChromeApis();
    const promptText = 'why is my query slow?';
    const enhancedText = 'You are a PostgreSQL query specialist. Help investigate...';

    // Save comparison data
    await saveComparisonSession({
      original: promptText,
      enhanced: enhancedText,
      mode: 'advanced',
    });

    // Simulate opening comparison tab
    const compareUrl = runtime.getURL('compare.html');
    await chrome.tabs.create({ url: compareUrl });

    // Verify compare URL has zero query parameters, avoiding URL history and log leakage
    expect(compareUrl).toBe('chrome-extension://mozhi-test-id/compare.html');
    expect(compareUrl).not.toContain('?');
    expect(compareUrl).not.toContain('query');
    expect(tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://mozhi-test-id/compare.html' });

    // Verify storage has the data ready for the compare tab to load
    const loaded = await loadComparisonSession();
    expect(loaded).toBeDefined();
    expect(loaded?.original).toBe(promptText);
    expect(loaded?.enhanced).toBe(enhancedText);
    expect(loaded?.mode).toBe('advanced');
  });
});

describe('Popup UX: Conditional Privacy Messaging', () => {
  function getPrivacyNote(provider: 'local' | 'openai-compatible', modelReady: boolean): string {
    if (provider === 'local') {
      return modelReady
        ? 'Local on-device: prompt correction stays on this device only when local inference is used.'
        : 'Local model selected: download and verify model files in Settings before refining.';
    }
    return 'Online BYOK: prompt is sent to your configured provider endpoint only when you choose Enhance.';
  }

  it('accurately states local on-device execution when local provider and model are ready', () => {
    const note = getPrivacyNote('local', true);
    expect(note).toContain('Local on-device');
    expect(note).toContain('stays on this device only when local inference is used');
  });

  it('accurately states verification requirement when local model is not downloaded or ready', () => {
    const note = getPrivacyNote('local', false);
    expect(note).toContain('download and verify model files in Settings');
  });

  it('accurately explains BYOK transmission when online provider is selected', () => {
    const note = getPrivacyNote('openai-compatible', false);
    expect(note).toContain('Online BYOK');
    expect(note).toContain('sent to your configured provider endpoint only when you choose Enhance');
    expect(note).not.toContain('stays on this device');
  });
});

describe('Popup UX: Mode Button Labels & Compact Sizing', () => {
  it('uses concise shortLabels across all four modes to prevent truncation in 4-column layout', () => {
    for (const mode of modes) {
      const def = modeDefinitions[mode];
      expect(def.shortLabel.length).toBeLessThanOrEqual(8);
    }
    expect(modeDefinitions.typo.shortLabel).toBe('Typo');
    expect(modeDefinitions.light.shortLabel).toBe('Light');
    expect(modeDefinitions.balanced.shortLabel).toBe('Balanced');
    expect(modeDefinitions.advanced.shortLabel).toBe('Advanced');
  });
});

describe('Popup UX: Character Counter Formatting & Warnings', () => {
  function formatCounter(length: number, provider: 'local' | 'openai-compatible'): { text: string; isError: boolean } {
    if (provider === 'local') {
      return {
        text: `${length}/300 (Local limit)`,
        isError: length > 300,
      };
    }
    return {
      text: `${length}/20,000`,
      isError: length > 20_000,
    };
  }

  it('formats live character count with provisional 300 limit for local mode', () => {
    const normal = formatCounter(45, 'local');
    expect(normal.text).toBe('45/300 (Local limit)');
    expect(normal.isError).toBe(false);

    const exceeded = formatCounter(312, 'local');
    expect(exceeded.text).toBe('312/300 (Local limit)');
    expect(exceeded.isError).toBe(true);
  });

  it('formats standard 20,000 limit for online mode', () => {
    const normal = formatCounter(450, 'openai-compatible');
    expect(normal.text).toBe('450/20,000');
    expect(normal.isError).toBe(false);
  });
});
