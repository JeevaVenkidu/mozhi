import type { ProviderKind } from '../core/types';
import { Icon } from './icons';

export function ProviderSelector({ value, onChange, compact = false, disabled = false }: {
  value: ProviderKind;
  onChange: (provider: ProviderKind) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <legend className="text-[10px] font-mono font-semibold tracking-wider uppercase text-muted-ink">
          Processing Engine
        </legend>
        <span className="text-[11px] font-mono text-faint">
          {value === 'local' ? 'On-Device WebGPU' : 'BYOK Online API'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1 p-1 bg-subtle rounded-xl border border-line">
        <button
          type="button"
          aria-pressed={value === 'local'}
          disabled={disabled}
          onClick={() => onChange('local')}
          className={`flex items-center justify-center gap-1.5 rounded-lg text-xs transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
            compact ? 'py-1.5' : 'py-2 sm:text-sm'
          } ${
            value === 'local'
              ? 'bg-white text-ink shadow-xs font-semibold'
              : 'text-muted-ink hover:text-ink font-medium'
          }`}
        >
          <span className={`size-1.5 rounded-full ${value === 'local' ? 'bg-emerald' : 'bg-muted-ink/40'}`} />
          <span>Local WebGPU</span>
        </button>
        <button
          type="button"
          aria-pressed={value === 'openai-compatible'}
          disabled={disabled}
          onClick={() => onChange('openai-compatible')}
          className={`flex items-center justify-center gap-1.5 rounded-lg text-xs transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
            compact ? 'py-1.5' : 'py-2 sm:text-sm'
          } ${
            value === 'openai-compatible'
              ? 'bg-white text-ink shadow-xs font-semibold'
              : 'text-muted-ink hover:text-ink font-medium'
          }`}
        >
          <span className={`size-1.5 rounded-full ${value === 'openai-compatible' ? 'bg-indigo' : 'bg-muted-ink/40'}`} />
          <span>Online BYOK</span>
        </button>
      </div>
      {!compact && (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-ink">
          <Icon name="shield" className="mt-0.5 size-3.5 shrink-0 text-indigo" />
          {value === 'local'
            ? 'Prompts are processed on this device. Download the model from Settings when you are ready.'
            : 'Your prompt goes only to the configured HTTPS endpoint when you click Enhance.'}
        </p>
      )}
    </fieldset>
  );
}
