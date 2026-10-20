import { validateOnlineProviderConfig, type OnlineProviderConfig } from '../providers/online-config';

/** Must be called directly from a user action; asks only for the configured endpoint's origin. */
export function requestOnlineHostPermission(config: OnlineProviderConfig): Promise<boolean> {
  const validated = validateOnlineProviderConfig(config);
  return chrome.permissions.request({ origins: [validated.originPattern] });
}
