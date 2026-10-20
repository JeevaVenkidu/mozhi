import { localModelOrigins } from '../providers/local-model-config';

/** Request the model host domains only from a user-initiated model action. */
export function requestLocalModelPermission(): Promise<boolean> {
  return chrome.permissions.request({ origins: [...localModelOrigins] });
}
