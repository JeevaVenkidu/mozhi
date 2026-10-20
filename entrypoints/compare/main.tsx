import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import { Icon, MozhiMark } from '../../src/components/icons';
import { loadComparisonSession, type ComparisonSession } from '../../src/services/comparison-session';
import { getModeDefinition } from '../../src/core/mode-definitions';
import { insertIntoChatGPT } from '../../src/integrations/chatgpt';

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function ComparePage() {
  const [session, setSession] = useState<ComparisonSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedOriginal, setCopiedOriginal] = useState(false);
  const [copiedEnhanced, setCopiedEnhanced] = useState(false);
  const [insertStatus, setInsertStatus] = useState<string>('');

  useEffect(() => {
    void loadComparisonSession().then((loaded) => {
      setSession(loaded);
      setLoading(false);
    });
  }, []);

  async function handleCopy(text: string, type: 'original' | 'enhanced') {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'original') {
        setCopiedOriginal(true);
        setTimeout(() => setCopiedOriginal(false), 1800);
      } else {
        setCopiedEnhanced(true);
        setTimeout(() => setCopiedEnhanced(false), 1800);
      }
    } catch {
      // Ignore clipboard write errors
    }
  }

  async function handleInsert() {
    if (!session?.enhanced) return;
    setInsertStatus('');
    try {
      const res = await insertIntoChatGPT(session.enhanced);
      if (res.status === 'inserted') {
        setInsertStatus('Inserted into ChatGPT.');
      } else if (res.status === 'needs-confirmation') {
        setInsertStatus('ChatGPT prompt has existing text; open extension popup to confirm replacement.');
      } else {
        setInsertStatus('Could not insert automatically. Copy text manually.');
      }
    } catch (err) {
      setInsertStatus(err instanceof Error ? err.message : 'Could not insert into active tab.');
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas p-6 flex items-center justify-center text-ink">
        <div className="flex items-center gap-2.5 text-xs text-muted-ink">
          <span className="size-4 animate-spin rounded-full border-2 border-indigo border-r-transparent" />
          <span>Loading comparison data…</span>
        </div>
      </main>
    );
  }

  if (!session || !session.original || !session.enhanced) {
    return (
      <main className="min-h-screen bg-canvas p-6 sm:p-12 flex flex-col items-center justify-center text-ink">
        <div className="doppelrand-shell max-w-md w-full p-2">
          <div className="doppelrand-core p-8 flex flex-col items-center text-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-subtle text-muted-ink border border-line">
              <Icon name="compare" className="size-5" />
            </div>
            <h1 className="text-base font-bold text-ink">No Comparison Data Available</h1>
            <p className="text-xs leading-relaxed text-muted-ink">
              No active comparison prompt was found in this session. Refine a prompt in the Mozhi popup and click{' '}
              <strong className="text-ink">Compare</strong> to inspect differences side by side.
            </p>
            <button
              type="button"
              onClick={() => window.close()}
              className="mt-2 rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-white hover:bg-black transition"
            >
              Close this tab
            </button>
          </div>
        </div>
      </main>
    );
  }

  const modeDef = getModeDefinition(session.mode);
  const origWords = countWords(session.original);
  const enhWords = countWords(session.enhanced);

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur-md px-5 py-3.5 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-7 place-items-center rounded-lg bg-ink text-white shadow-xs">
              <MozhiMark className="size-4" />
            </div>
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-lg font-bold tracking-tight text-ink leading-none">
                Mozhi
              </h1>
              <span className="text-[11px] font-mono text-muted-ink border-l border-line pl-2">
                Prompt Comparison
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleCopy(session.enhanced, 'enhanced')}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle transition shadow-2xs"
            >
              <Icon name={copiedEnhanced ? 'check' : 'copy'} className="size-3.5" />
              <span>{copiedEnhanced ? 'Copied Refined' : 'Copy Refined'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleInsert()}
              className="rounded-xl bg-ink px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-black transition shadow-xs"
            >
              Review &amp; Insert
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex-1 max-w-6xl w-full p-4 sm:p-8 flex flex-col gap-5">
        {/* Metric summary banner */}
        <section aria-label="Transformation summary" className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-surface border border-line shadow-2xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-semibold uppercase text-muted-ink">Mode:</span>
            <span className="text-xs font-bold text-ink">{modeDef.name}</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-soft text-indigo-900 border border-indigo/20 font-semibold">
              {modeDef.badge}
            </span>
            <span className="hidden sm:inline text-xs text-muted-ink">
              • {modeDef.tagline}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-muted-ink">
            <span>
              Original: <strong className="text-ink">{origWords}</strong> words ({session.original.length} chars)
            </span>
            <span>→</span>
            <span>
              Refined: <strong className="text-ink">{enhWords}</strong> words ({session.enhanced.length} chars)
            </span>
          </div>
        </section>

        {insertStatus && (
          <div role="status" className="p-3 rounded-xl bg-indigo-soft/70 border border-indigo/20 text-xs text-indigo-950 font-medium">
            {insertStatus}
          </div>
        )}

        {/* Side-by-side comparison grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 flex-1">
          {/* Original prompt card */}
          <section aria-labelledby="original-title" className="doppelrand-shell p-1.5 flex flex-col">
            <div className="doppelrand-core p-4 sm:p-5 flex-1 flex flex-col gap-2.5">
              <div className="flex items-center justify-between border-b border-line-subtle pb-2.5">
                <div className="flex items-center gap-2">
                  <h2 id="original-title" className="text-xs font-mono font-bold uppercase tracking-wider text-muted-ink">
                    Original Prompt
                  </h2>
                  <span className="text-[10px] font-mono text-faint">
                    {session.original.length} chars
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(session.original, 'original')}
                  className="flex items-center gap-1 text-xs text-indigo hover:text-indigo-hover font-medium"
                >
                  <Icon name={copiedOriginal ? 'check' : 'copy'} className="size-3" />
                  <span>{copiedOriginal ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              <div className="flex-1 min-h-[220px] whitespace-pre-wrap font-sans text-xs sm:text-sm leading-relaxed text-muted-ink break-words select-text">
                {session.original}
              </div>
            </div>
          </section>

          {/* Refined prompt card */}
          <section aria-labelledby="refined-title" className="doppelrand-shell p-1.5 flex flex-col">
            <div className="doppelrand-core p-4 sm:p-5 flex-1 flex flex-col gap-2.5 bg-white">
              <div className="flex items-center justify-between border-b border-line-subtle pb-2.5">
                <div className="flex items-center gap-2">
                  <h2 id="refined-title" className="text-xs font-mono font-bold uppercase tracking-wider text-indigo-900">
                    Refined Prompt ({modeDef.shortLabel})
                  </h2>
                  <span className="text-[10px] font-mono text-faint">
                    {session.enhanced.length} chars
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(session.enhanced, 'enhanced')}
                  className="flex items-center gap-1 text-xs text-indigo hover:text-indigo-hover font-medium"
                >
                  <Icon name={copiedEnhanced ? 'check' : 'copy'} className="size-3" />
                  <span>{copiedEnhanced ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              <div className="flex-1 min-h-[220px] whitespace-pre-wrap font-sans text-xs sm:text-sm leading-relaxed text-ink break-words select-text">
                {session.enhanced}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<ComparePage />);
}
