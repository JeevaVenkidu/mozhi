import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getConfiguredManifestPermissions,
  getGrantedPermissions,
  getExtensionPermissionsInfo,
  describeHostPermissionPurpose,
} from '../src/services/permissions-info';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Permissions Info Service', () => {
  it('reads configured manifest permissions directly from chrome.runtime.getManifest', () => {
    vi.stubGlobal('chrome', {
      runtime: {
        getManifest: () => ({
          permissions: ['storage', 'activeTab', 'scripting'],
          optional_host_permissions: ['https://*/*', 'https://huggingface.co/*'],
        }),
      },
    });

    const manifest = getConfiguredManifestPermissions();
    expect(manifest.requiredPermissions).toEqual(['storage', 'activeTab', 'scripting']);
    expect(manifest.requiredHostPermissions).toEqual([]);
    expect(manifest.optionalHostPermissions).toEqual(['https://*/*', 'https://huggingface.co/*']);
  });

  it('reads granted origins and permissions from chrome.permissions.getAll', async () => {
    vi.stubGlobal('chrome', {
      permissions: {
        getAll: vi.fn(async () => ({
          origins: ['https://api.openai.com/*'],
          permissions: ['storage'],
        })),
      },
    });

    const granted = await getGrantedPermissions();
    expect(granted.grantedOrigins).toEqual(['https://api.openai.com/*']);
    expect(granted.grantedPermissions).toEqual(['storage']);
  });

  it('returns combined information via getExtensionPermissionsInfo', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        getManifest: () => ({
          permissions: ['storage', 'activeTab'],
          optional_host_permissions: ['https://*/*'],
        }),
      },
      permissions: {
        getAll: vi.fn(async () => ({
          origins: ['https://api.example.com/*'],
          permissions: ['storage', 'activeTab'],
        })),
      },
    });

    const info = await getExtensionPermissionsInfo();
    expect(info.requiredPermissions).toEqual(['storage', 'activeTab']);
    expect(info.optionalHostPermissions).toEqual(['https://*/*']);
    expect(info.grantedOrigins).toEqual(['https://api.example.com/*']);
  });

  it('handles environments where chrome APIs are unavailable gracefully', async () => {
    vi.stubGlobal('chrome', undefined);

    const manifest = getConfiguredManifestPermissions();
    expect(manifest.requiredPermissions).toBeDefined();

    const granted = await getGrantedPermissions();
    expect(granted.grantedOrigins).toEqual([]);
    expect(granted.grantedPermissions).toEqual([]);
  });

  it('provides plain-language descriptions for known pattern purposes', () => {
    expect(describeHostPermissionPurpose('https://huggingface.co/*')).toContain('Hugging Face');
    expect(describeHostPermissionPurpose('https://*.hf.co/*')).toContain('Hugging Face');
    expect(describeHostPermissionPurpose('https://*/*')).toContain('custom HTTPS API endpoint');
  });
});
