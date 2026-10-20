import { afterEach, describe, expect, it, vi } from 'vitest';
import { enhancePrompt, ProviderError } from '../src/core/enhancer';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible';
import { validateOnlineProviderConfig } from '../src/providers/online-config';

const config = { baseUrl: 'https://api.example.com/v1/', model: 'small-model' };

afterEach(() => vi.unstubAllGlobals());

describe('online provider configuration', () => {
  it('normalizes the chat completions URL and requests only its origin', () => {
    expect(validateOnlineProviderConfig(config)).toEqual({
      endpointUrl: 'https://api.example.com/v1/chat/completions',
      originPattern: 'https://api.example.com/*',
      model: 'small-model',
    });
  });

  it.each([
    'http://api.example.com/v1',
    'javascript:alert(1)',
    'https://user:password@api.example.com/v1',
    'https://localhost:11434/v1',
    'https://api.example.com/v1?token=secret',
  ])('rejects unsafe endpoint URL %s', (baseUrl) => {
    expect(() => validateOnlineProviderConfig({ ...config, baseUrl })).toThrow();
  });
});

describe('OpenAI-compatible provider', () => {
  it('sends the selected prompt and mode to the configured endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '  Refined prompt  ' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAICompatibleProvider(config, 'secret-key');

    await expect(enhancePrompt({ prompt: 'Draft a release note', mode: 'balanced' }, provider)).resolves.toBe('Refined prompt');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer secret-key');
    const body = JSON.parse(String(init?.body));
    expect(body.messages[0].content).toContain('well organized');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Draft a release note' });
    expect(String(url)).not.toContain('secret-key');
  });

  it('returns actionable authentication errors without hiding them in the engine', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAICompatibleProvider(config, 'bad-key');
    await expect(enhancePrompt({ prompt: 'Summarize this', mode: 'light' }, provider)).rejects.toMatchObject({
      name: 'OnlineProviderError',
      message: 'The endpoint rejected the API key. Check the key in settings.',
    });
  });

  it('explains rate limits and malformed response bodies', async () => {
    const rateLimited = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    vi.stubGlobal('fetch', rateLimited);
    const provider = new OpenAICompatibleProvider(config, 'secret-key');
    await expect(provider.enhance({ prompt: 'Try again later', mode: 'light' })).rejects.toMatchObject({ message: expect.stringContaining('rate limiting') });

    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('{', { status: 200 }));
    vi.stubGlobal('fetch', malformed);
    await expect(provider.enhance({ prompt: 'Try again later', mode: 'light' })).rejects.toMatchObject({ message: expect.stringContaining('unreadable response') });
  });

  it('offers a separate, prompt-free connection check', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAICompatibleProvider(config, 'secret-key');
    await expect(provider.testConnection()).resolves.toBeUndefined();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages).toEqual([{ role: 'user', content: 'Reply with the single word OK.' }]);
  });

  it('requires a key before any request can be made', () => {
    expect(() => new OpenAICompatibleProvider(config, ' ')).toThrow(ProviderError);
  });

  it('keeps a pre-cancelled request from reaching fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    const provider = new OpenAICompatibleProvider(config, 'secret-key');
    await expect(provider.enhance({ prompt: 'Cancel me', mode: 'light' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts an in-flight request when the user cancels', async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAICompatibleProvider(config, 'secret-key');
    const controller = new AbortController();
    const pending = provider.enhance({ prompt: 'Cancel this request', mode: 'balanced' }, controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
