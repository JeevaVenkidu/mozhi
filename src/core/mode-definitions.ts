import type { EnhancementMode } from './types';

export interface ModeDefinition {
  id: EnhancementMode;
  name: string;
  shortLabel: string;
  badge: string;
  tagline: string;
  description: string;
  disclaimer?: string;
  characteristics: string[];
}

export const modeDefinitions: Record<EnhancementMode, ModeDefinition> = {
  typo: {
    id: 'typo',
    name: 'Typo & Grammar Fix',
    shortLabel: 'Typo',
    badge: 'Surface Fixes',
    tagline: 'Corrects spelling, punctuation, capitalization, and grammar errors only.',
    description:
      'Makes strictly surface-level corrections to spelling, punctuation, grammar, and obvious typos. Preserves exact wording, sentence structure, tone, language, and level of detail. Never alters technical identifiers, code, URLs, or domain terminology, and returns clean input unchanged.',
    characteristics: [
      'Zero structural changes or added sections',
      'Preserves original tone, voice, and language',
      'Leaves technical identifiers, code, and URLs intact',
      'Returns already correct prompts completely unchanged',
    ],
  },
  light: {
    id: 'light',
    name: 'Light',
    shortLabel: 'Light',
    badge: 'Clarity',
    tagline: 'Refines phrasing and clarity while preserving the original voice.',
    description:
      'Improves awkward or unclear phrasing and fixes errors with minimal edits while closely retaining the user’s original phrasing, structure, and length. Clarifies requests where the intended meaning is already evident without adding elaborate roles or expanding simple queries.',
    characteristics: [
      'Minimal edits for smoother reading and clarity',
      'Preserves original length and sentence structure',
      'Retains personal voice and natural style',
      'Avoids artificial expansion or added sections',
    ],
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    shortLabel: 'Balanced',
    badge: 'Actionable',
    tagline: 'Makes requests clearer, more specific, and easier for an AI to execute.',
    description:
      'Organizes the prompt to highlight the core objective, context, and constraints. Adds concise instructions or structured output requirements when they materially improve the result. Breaks complex requests into short sections or bullets while preserving all supplied facts and using placeholders for missing information.',
    characteristics: [
      'Structures requests for better AI comprehension',
      'Adds concise output formats or constraints when helpful',
      'Preserves all stated facts, constraints, and audience',
      'Uses placeholders or clarifying questions instead of inventing facts',
    ],
  },
  advanced: {
    id: 'advanced',
    name: 'Advanced',
    shortLabel: 'Advanced',
    badge: 'Engineered',
    tagline: 'Transforms requests into well-engineered, context-aware prompt architecture.',
    disclaimer:
      'A deeper restructuring mode that adds useful task structure while preserving intent. It does not guarantee correctness or promise that Advanced always produces a better answer in every situation.',
    description:
      'Performs deep prompt engineering based on the specific domain (programming, writing, research, planning, learning, creative). Applies structural building blocks—such as Role, Task, Context, Investigation Steps, Output Format, Constraints, and Quality Criteria—proportionate to task complexity. Never invents missing data, schemas, or benchmarks; instead, formulates systematic diagnostic steps, highlights hypotheses, and marks placeholders for evidence.',
    characteristics: [
      'Context- and domain-aware prompt architecture',
      'Proportionate structural blocks (Role, Task, Context, Steps, Format, Constraints)',
      'Systematic diagnostic steps and evidence placeholders for incomplete requests',
      'Strict non-fabrication of queries, schemas, citations, or facts',
    ],
  },
};

export function getModeDefinition(mode: EnhancementMode): ModeDefinition {
  return modeDefinitions[mode] ?? modeDefinitions.balanced;
}
