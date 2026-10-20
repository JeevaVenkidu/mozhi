import { describe, expect, it } from 'vitest';
import { creatorInfo } from '../src/core/about-config';

describe('Creator Attribution Configuration', () => {
  it('defines valid creator attribution information', () => {
    expect(creatorInfo.name.trim().length).toBeGreaterThan(0);
    expect(creatorInfo.role.trim().length).toBeGreaterThan(0);
    expect(creatorInfo.note.trim().length).toBeGreaterThan(0);
  });

  it('uses valid secure HTTPS URLs for website and GitHub', () => {
    expect(creatorInfo.websiteUrl).toMatch(/^https?:\/\//);
    expect(creatorInfo.githubUrl).toMatch(/^https?:\/\//);
    expect(() => new URL(creatorInfo.websiteUrl)).not.toThrow();
    expect(() => new URL(creatorInfo.githubUrl)).not.toThrow();
  });

  it('includes the creator note about helping people turn rough thoughts into clearer prompts', () => {
    expect(creatorInfo.note).toContain('rough thoughts into clearer prompts');
  });
});
