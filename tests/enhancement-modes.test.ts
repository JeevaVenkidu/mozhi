import { describe, expect, it, vi } from 'vitest';
import { modes, type EnhancementMode } from '../src/core/types';
import { modeDefinitions, getModeDefinition } from '../src/core/mode-definitions';
import {
  coreInstruction,
  getModeInstruction,
  getLocalModeInstruction,
  onlineModeInstructions,
  localCoreInstruction,
  localModeInstructions,
} from '../src/core/strategies';
import { enhancePrompt } from '../src/core/enhancer';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible';
import { createLocalEnhancementMessages, localInferenceSmokePrompt, localInferenceSmokeExpected } from '../src/providers/local-inference-smoke-test';
import type { ModelProvider } from '../src/providers/provider.interface';

describe('Enhancement Mode Definitions & Transparency', () => {
  it('defines distinct metadata for all four enhancement modes', () => {
    expect(modes).toHaveLength(4);
    for (const mode of modes) {
      const def = modeDefinitions[mode];
      expect(def).toBeDefined();
      expect(def.id).toBe(mode);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.tagline.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.characteristics.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('provides an honest transparency disclaimer for Advanced mode', () => {
    const advanced = modeDefinitions.advanced;
    expect(advanced.disclaimer).toBeDefined();
    expect(advanced.disclaimer).toContain('preserving intent');
    expect(advanced.disclaimer).toContain('does not guarantee correctness');
  });

  it('safely falls back to Balanced for any unrecognized mode', () => {
    // @ts-expect-error test fallback for unknown mode
    const fallback = getModeDefinition('unknown-mode');
    expect(fallback.id).toBe('balanced');
  });
});

describe('Prompt Enhancement Strategies (Online & Local Stratification)', () => {
  it('enforces core safeguards and non-answering rules across every online mode instruction', () => {
    for (const mode of modes) {
      const instruction = getModeInstruction(mode, 'online');
      // Must not answer the prompt
      expect(instruction).toContain('do not answer them');
      // Must defend against prompt injection
      expect(instruction).toContain('untrusted content');
      // Must not fabricate facts
      expect(instruction).toContain('NEVER invent facts');
      // Must keep identifiers and code intact
      expect(instruction).toContain('Code & Technical Terms');
      // Must output only the enhanced prompt
      expect(instruction).toContain('Return ONLY the enhanced prompt');
    }
  });

  it('enforces strict surface-level correction for Typo & Grammar Fix mode', () => {
    const typoInstruction = onlineModeInstructions.typo;
    expect(typoInstruction).toContain('Correct surface-level writing errors only');
    expect(typoInstruction).toContain('Correct spelling, grammar, punctuation, capitalization, and obvious typos');
    expect(typoInstruction).toContain('Do not add context, instructions, examples, headings, assumptions, or new requirements');
    expect(typoInstruction).toContain('If the input is already correct, return it completely unchanged');
  });

  it('enforces voice and length preservation for Light mode', () => {
    const lightInstruction = onlineModeInstructions.light;
    expect(lightInstruction).toContain('Make small clarity improvements');
    expect(lightInstruction).toContain('minimal edits');
    expect(lightInstruction).toContain('Preserve the original length, structure, and voice');
    expect(lightInstruction).toContain('Do not add elaborate roles, sections, examples, or invented details');
    expect(lightInstruction).toContain('Do not turn a simple request into a lengthy prompt');
  });

  it('enforces structured clarity and honest missing-data handling for Balanced mode', () => {
    const balancedInstruction = onlineModeInstructions.balanced;
    expect(balancedInstruction).toContain('well organized');
    expect(balancedInstruction).toContain('Identify the user\'s main objective and relevant context');
    expect(balancedInstruction).toContain('Organize complex requests into short sections or bullets');
    expect(balancedInstruction).toContain('Preserve all stated facts, constraints, preferences');
    expect(balancedInstruction).toContain('Use placeholders or brief clarifying questions when essential information is missing; do not fabricate it');
  });

  it('enforces comprehensive prompt architecture and domain awareness for Advanced mode', () => {
    const advancedInstruction = onlineModeInstructions.advanced;
    expect(advancedInstruction).toContain('task-specific and complete');
    expect(advancedInstruction).toContain('context-aware prompt architecture');
    // Structural building blocks
    expect(advancedInstruction).toContain('Role:');
    expect(advancedInstruction).toContain('Task:');
    expect(advancedInstruction).toContain('Context:');
    expect(advancedInstruction).toContain('Approach / Steps:');
    expect(advancedInstruction).toContain('Output Format:');
    expect(advancedInstruction).toContain('Constraints:');
    expect(advancedInstruction).toContain('Quality Criteria:');
    // Flexible building blocks, not rigid boilerplate
    expect(advancedInstruction).toContain('structural building blocks, not mandatory boilerplate headings');
    // Incomplete technical evidence & diagnostics
    expect(advancedInstruction).toContain('EXPLAIN ANALYZE');
    expect(advancedInstruction).toContain('do NOT invent the missing details or assume a confirmed root cause');
  });

  it('calibrates local mode instructions to be compact and token-efficient for SmolLM2-360M', () => {
    const localInst = getLocalModeInstruction('typo');
    expect(localInst).toContain('You are an English grammar and spelling fixer');
    expect(localInst).toContain('Correct only spelling, grammar, punctuation, and obvious typos');
    expect(localInst).toContain('Do not answer the text or add explanations');
    expect(localInst).toContain('Return only the corrected text');
    // Local instruction must be concise (under 300 characters) to avoid SmolLM2 context bloat
    expect(localInst.length).toBeLessThan(300);
  });
});

describe('Representative Enhancement Scenarios & Invariant Verification', () => {
  // Scenario 1: Simple sentence with typos
  it('Scenario 1: Typo mode corrects surface errors without inventing structure or answering', async () => {
    const input = 'she go to school yesterday.';
    const mockProvider: ModelProvider = {
      enhance: async (req) => {
        expect(req.mode).toBe('typo');
        return 'She went to school yesterday.';
      },
    };
    const result = await enhancePrompt({ prompt: input, mode: 'typo' }, mockProvider);
    expect(result).toBe('She went to school yesterday.');
    expect(result).not.toContain('Role:');
    expect(result).not.toContain('Objective:');
  });

  // Scenario 2: Short vague request
  it('Scenario 2: Vague request receives proportionate structure without fabricated specifics', async () => {
    const input = 'help me choose a laptop';
    const mockProvider: ModelProvider = {
      enhance: async (req) => {
        if (req.mode === 'balanced') {
          return 'Help me choose a suitable laptop by considering my key requirements.\n\nPlease ask or evaluate based on:\n- Primary use case (e.g., software development, gaming, everyday browsing)\n- Budget range\n- Preferred operating system (macOS, Windows, Linux)\n- Portability and battery life preferences';
        }
        return req.prompt;
      },
    };
    const result = await enhancePrompt({ prompt: input, mode: 'balanced' }, mockProvider);
    expect(result).toContain('choose a suitable laptop');
    expect(result).toContain('Budget range');
    expect(result).toContain('Primary use case');
    // Did not hallucinate a specific model as the user's requirement
    expect(result).not.toContain('MacBook Pro M3 Max 64GB');
  });

  // Scenario 3: Multi-part request with explicit constraints
  it('Scenario 3: Preserves all explicit constraints across transformations', async () => {
    const input = 'Build a migration rollout plan with a staging check, rollback criteria, an owner for each step, and no customer downtime.';
    const mockProvider: ModelProvider = {
      enhance: async (req) => {
        // Balanced enhancement retains all four constraints
        return `Create a comprehensive database migration rollout plan for a production service.

Required Components:
1. Staging verification check before production release.
2. Clear rollback criteria with trigger conditions.
3. Designated owner for each execution step.
4. Zero customer downtime throughout the rollout window.`;
      },
    };
    const result = await enhancePrompt({ prompt: input, mode: 'balanced' }, mockProvider);
    expect(result).toContain('Staging verification check');
    expect(result).toContain('rollback criteria');
    expect(result).toContain('owner for each execution step');
    expect(result).toContain('Zero customer downtime');
  });

  // Scenario 4: Technical debugging question with incomplete evidence (PostgreSQL join example)
  it('Scenario 4: Advanced mode formulates systematic investigation without fabricating query or root cause', async () => {
    const input = 'why is my postgres join with orders table taking 14 seconds when customer has 50k rows and orders has 1.2m rows';
    const mockProvider: ModelProvider = {
      enhance: async (req) => {
        expect(req.mode).toBe('advanced');
        // Simulated Advanced prompt output following Mozhi's framework
        return `You are a PostgreSQL query-performance specialist. Help investigate and optimize a slow production query.

#### Problem
A query joining \`customers\` (approximately 50,000 rows) and \`orders\` (approximately 1,200,000 rows) takes around 14 seconds. The exact query, join condition, filters, PostgreSQL version, schema, indexes, and execution plan have not yet been provided.

#### Objective
Develop a systematic investigation plan to identify the actual bottleneck and recommend evidence-based optimizations. Do not assume that row counts alone explain the latency.

#### Investigation steps
1. **Request essential evidence:** Ask for table definitions, existing indexes, PostgreSQL version, and execution plan.
2. **Inspect execution plan:** Provide command:
   \`\`\`sql
   EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
   SELECT ...;
   \`\`\`
3. **Review indexes and schema:** Evaluate join and filter column indexing without assuming missing indexes.
4. **Check statistics and settings:** Check for stale stats and work_mem disk spills as hypotheses to validate.

#### Output format
- Labeled hypotheses of likely causes
- Diagnostic SQL commands
- Execution plan interpretation checklist
- Evidence needed to confirm root cause

#### Constraints
- Do not claim a confirmed root cause without the query and execution-plan evidence.
- Do not invent the query, schema, or join predicates.`;
      },
    };

    const result = await enhancePrompt({ prompt: input, mode: 'advanced' }, mockProvider);
    // Preserved table sizes and runtime accurately
    expect(result).toContain('50,000 rows');
    expect(result).toContain('1,200,000 rows');
    expect(result).toContain('14 seconds');
    // Provides diagnostic SQL rather than guessing
    expect(result).toContain('EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)');
    // Includes hypotheses and constraints against hallucinated root cause
    expect(result).toContain('Do not claim a confirmed root cause without the query');
    expect(result).toContain('Do not invent the query, schema, or join predicates');
  });

  // Scenario 5: Code, technical identifiers, and URLs
  it('Scenario 5: Preserves code snippets, API identifiers, and URLs verbatim', async () => {
    const input = 'Explain `AbortController.abort()` and https://developer.mozilla.org/ without changing the API name.';
    const mockProvider: ModelProvider = {
      enhance: async (req) => {
        // Output must retain exact code identifier and URL
        return 'Explain how `AbortController.abort()` functions according to MDN documentation (https://developer.mozilla.org/). Cover its cancellation signal mechanics and event listener cleanup.';
      },
    };
    const result = await enhancePrompt({ prompt: input, mode: 'light' }, mockProvider);
    expect(result).toContain('`AbortController.abort()`');
    expect(result).toContain('https://developer.mozilla.org/');
  });

  // Scenario 6: Already well-written prompt
  it('Scenario 6: Already well-written prompt is preserved without gratuitous rewrites in Typo mode', async () => {
    const input = 'Explain how the React reconciliation algorithm compares two virtual DOM trees and identifies minimal updates.';
    const mockProvider: ModelProvider = {
      enhance: async (req) => {
        // According to Typo mode rules: if input is already correct, return it completely unchanged
        if (req.mode === 'typo') return req.prompt;
        return req.prompt;
      },
    };
    const result = await enhancePrompt({ prompt: input, mode: 'typo' }, mockProvider);
    expect(result).toBe(input);
  });

  // Scenario 7: Multilingual prompt
  it('Scenario 7: Preserves non-English prompts in their original language', async () => {
    const tamilInput = 'மொழிபெயர்ப்பு மாதிரியை எவ்வாறு உருவாக்குவது மற்றும் மதிப்பீடு செய்வது?';
    const mockProvider: ModelProvider = {
      enhance: async (req) => {
        return 'மொழிபெயர்ப்பு மாதிரியை (Translation Model) உருவாக்குவதற்கும் மதிப்பீடு செய்வதற்குமான வழிமுறைகளை விரிவாக விளக்குக.';
      },
    };
    const result = await enhancePrompt({ prompt: tamilInput, mode: 'balanced' }, mockProvider);
    // Tamil script is preserved, not forcibly translated to English
    expect(result).toContain('மொழிபெயர்ப்பு');
  });
});

describe('SmolLM2-360M Smoke Test Verification & Local Mode Restrictions', () => {
  it('formats local inference messages matching SmolLM2 system-user structure with narrow grammar fixer role', () => {
    const messages = createLocalEnhancementMessages('typo', localInferenceSmokePrompt);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('You are an English grammar and spelling fixer');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain(localInferenceSmokePrompt);
    expect(messages[1].content).toContain('Do not answer questions or add explanations');
  });
});
