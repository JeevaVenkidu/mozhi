import { describe, expect, it } from 'vitest';
import examples from './fixtures/prompt-evaluation.json';
import { modes } from '../src/core/types';

describe('prompt evaluation fixture', () => {
  it('contains 100+ nonempty examples across every enhancement mode', () => {
    expect(examples.length).toBeGreaterThanOrEqual(100);
    expect(examples.every((example) => example.prompt.trim().length > 0)).toBe(true);
    expect(examples.every((example) => modes.includes(example.mode as (typeof modes)[number]))).toBe(true);
    expect(new Set(examples.map((example) => example.category)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(examples.map((example) => example.mode))).toEqual(new Set(modes));
  });
});
