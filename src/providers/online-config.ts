export interface OnlineProviderConfig {
  baseUrl: string;
  model: string;
}

export interface ValidatedOnlineProviderConfig {
  endpointUrl: string;
  originPattern: string;
  model: string;
}

export function validateOnlineProviderConfig(config: OnlineProviderConfig): ValidatedOnlineProviderConfig {
  const rawBaseUrl = config.baseUrl.trim();
  const model = config.model.trim();
  if (!rawBaseUrl) throw new Error('Add an HTTPS endpoint URL in settings.');
  if (!model) throw new Error('Add a model name in settings.');
  if (model.length > 200) throw new Error('Model names must be 200 characters or fewer.');

  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new Error('Enter a valid endpoint URL beginning with https://.');
  }
  if (url.protocol !== 'https:') throw new Error('Online endpoints must use HTTPS.');
  if (url.username || url.password) throw new Error('Do not put credentials in the endpoint URL.');
  if (url.search || url.hash) throw new Error('Endpoint URLs cannot include a query string or fragment.');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new Error('Online endpoints must be remote HTTPS services, not localhost.');
  }

  const basePath = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  const endpointUrl = `${url.origin}${basePath}/chat/completions`;
  return { endpointUrl, originPattern: `${url.origin}/*`, model };
}
