import { afterEach, describe, expect, it, vi } from 'vitest';
import { insertIntoChatGPT } from '../src/integrations/chatgpt';

function setChromeApi(url: string, response: unknown) {
  const api = {
    tabs: { query: vi.fn(async () => [{ id: 7, url }]) },
    scripting: { executeScript: vi.fn(async () => [{ result: response }]) },
  };
  vi.stubGlobal('chrome', api);
  return api;
}

afterEach(() => vi.unstubAllGlobals());

describe('ChatGPT insertion', () => {
  it('rejects other sites without injecting a script', async () => {
    const api = setChromeApi('https://example.com/', { status: 'inserted' });
    await expect(insertIntoChatGPT('A prompt')).rejects.toThrow('available only on ChatGPT');
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('asks before replacing existing text and confirms against the unchanged field', async () => {
    const api = setChromeApi('https://chatgpt.com/', { status: 'needs-confirmation', signature: '18:12345' });
    await expect(insertIntoChatGPT('Refined prompt')).resolves.toEqual({
      status: 'needs-confirmation',
      signature: '18:12345',
    });

    api.scripting.executeScript.mockResolvedValueOnce([{ result: { status: 'inserted' } }]);
    await expect(insertIntoChatGPT('Refined prompt', '18:12345')).resolves.toEqual({ status: 'inserted' });
    expect(api.scripting.executeScript).toHaveBeenLastCalledWith(expect.objectContaining({
      target: { tabId: 7 },
      args: ['Refined prompt', true, '18:12345'],
    }));
  });
});
