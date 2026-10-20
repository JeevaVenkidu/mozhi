import { useState } from 'react';
import type { EnhancementMode, ProviderKind } from '../core/types';
import { modes } from '../core/types';
import { modeDefinitions, getModeDefinition } from '../core/mode-definitions';
import { Icon } from './icons';

export function openModeGuideInSettings() {
  const url = chrome.runtime.getURL('options.html#mode-guide');
  if (chrome.tabs?.query) {
    chrome.tabs.query({ url: chrome.runtime.getURL('options.html*') }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.update(tabs[0].id, { active: true, url });
      } else {
        chrome.tabs.create({ url });
      }
    });
  } else if (chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(url, '_blank');
  }
}

export function ModeSelector({
  value,
  onChange,
  disabled = false,
  provider,
  onSwitchToOnline,
}: {
  value: EnhancementMode;
  onChange: (mode: EnhancementMode) => void;
  compact?: boolean;
  disabled?: boolean;
  provider?: ProviderKind;
  onSwitchToOnline?: (targetMode: EnhancementMode) => void;
}) {
  const [switchTarget, setSwitchTarget] = useState<EnhancementMode | null>(null);
  const current = getModeDefinition(value);
  const isLocal = provider === 'local';

  function handleModeClick(modeKey: EnhancementMode) {
    if (isLocal && modeKey !== 'typo') {
      if (onSwitchToOnline) {
        setSwitchTarget(modeKey);
      }
      return;
    }
    setSwitchTarget(null);
    onChange(modeKey);
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <legend className="text-[10px] font-mono font-semibold tracking-wider uppercase text-muted-ink">
            Enhancement Mode
          </legend>
          <button
            type="button"
            aria-label="View mode transformation guide in Settings"
            title="View mode transformation guide in Settings"
            onClick={openModeGuideInSettings}
            className="grid size-4 place-items-center rounded text-faint hover:text-ink hover:bg-subtle transition"
          >
            <Icon name="info" className="size-3" />
          </button>
        </div>
        <span className="text-[10px] font-mono text-faint">
          {isLocal ? 'On-Device (Typo only)' : current.badge}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1 p-1 bg-subtle rounded-xl border border-line">
        {modes.map((modeKey) => {
          const item = modeDefinitions[modeKey];
          const isOnlineOnly = isLocal && modeKey !== 'typo';
          const isActive = value === modeKey && (!isLocal || modeKey === 'typo');
          return (
            <button
              key={modeKey}
              type="button"
              aria-pressed={isActive}
              disabled={disabled}
              title={isOnlineOnly ? `${item.name}: Online only. Click to switch to Online BYOK.` : `${item.name}: ${item.tagline}`}
              onClick={() => handleModeClick(modeKey)}
              className={`py-1.5 px-1 text-xs text-center rounded-lg transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                isActive
                  ? 'bg-white text-ink shadow-xs font-semibold'
                  : isOnlineOnly
                  ? 'text-muted-ink/70 hover:text-ink hover:bg-white/50 font-normal'
                  : 'text-muted-ink hover:text-ink font-medium'
              }`}
            >
              <div className="flex flex-col items-center">
                <span>{item.shortLabel}</span>
                {isOnlineOnly && (
                  <span className="text-[8px] font-mono leading-none text-muted-ink/80 mt-0.5">Online only</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {switchTarget && (
        <div role="alert" className="flex items-center justify-between gap-2 p-2 rounded-lg bg-indigo-soft/80 border border-indigo/20 text-xs">
          <span className="text-indigo-950 text-[11px] leading-tight">
            <strong>{modeDefinitions[switchTarget].name}</strong> is Online only. Switch provider?
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                const target = switchTarget;
                setSwitchTarget(null);
                onSwitchToOnline?.(target);
              }}
              className="px-2 py-0.5 rounded bg-indigo text-white text-[10px] font-semibold hover:bg-indigo-hover transition"
            >
              Switch
            </button>
            <button
              type="button"
              onClick={() => setSwitchTarget(null)}
              className="px-1.5 py-0.5 rounded text-muted-ink text-[10px] hover:text-ink transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="min-h-7 text-[11px] leading-snug text-muted-ink px-0.5" title={`${current.name}: ${current.tagline}`}>
        <span className="font-semibold text-ink">{current.name}:</span>{' '}
        <span className="text-muted-ink">
          {isLocal && value === 'typo'
            ? 'Corrects spelling, grammar, punctuation, and typos on this device. Light, Balanced, and Advanced are Online only.'
            : current.tagline}
        </span>
      </p>
    </fieldset>
  );
}
