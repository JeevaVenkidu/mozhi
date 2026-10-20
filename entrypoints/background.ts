import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground(() => {
  // Keep extension storage unavailable to content scripts, including API keys.
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
});
