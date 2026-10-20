/**
 * Inspection service that uses the runtime extension manifest and chrome.permissions
 * as the single source of truth for configured and granted permissions.
 */

export interface ExtensionPermissionsInfo {
  requiredPermissions: string[];
  requiredHostPermissions: string[];
  optionalHostPermissions: string[];
  optionalPermissions: string[];
  grantedOrigins: string[];
  grantedPermissions: string[];
}

export function getConfiguredManifestPermissions(): {
  requiredPermissions: string[];
  requiredHostPermissions: string[];
  optionalHostPermissions: string[];
  optionalPermissions: string[];
} {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getManifest) {
    return {
      requiredPermissions: ['storage', 'activeTab', 'scripting'],
      requiredHostPermissions: [],
      optionalHostPermissions: [
        'https://*/*',
        'https://huggingface.co/*',
        'https://*.huggingface.co/*',
        'https://*.hf.co/*',
      ],
      optionalPermissions: [],
    };
  }

  try {
    const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
      optional_host_permissions?: string[];
    };
    return {
      requiredPermissions: Array.isArray(manifest.permissions) ? [...manifest.permissions] : [],
      requiredHostPermissions: Array.isArray(manifest.host_permissions) ? [...manifest.host_permissions] : [],
      optionalHostPermissions: Array.isArray(manifest.optional_host_permissions)
        ? [...manifest.optional_host_permissions]
        : [],
      optionalPermissions: Array.isArray(manifest.optional_permissions)
        ? [...manifest.optional_permissions]
        : [],
    };
  } catch {
    return {
      requiredPermissions: [],
      requiredHostPermissions: [],
      optionalHostPermissions: [],
      optionalPermissions: [],
    };
  }
}

export async function getGrantedPermissions(): Promise<{
  grantedOrigins: string[];
  grantedPermissions: string[];
}> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.getAll) {
    return {
      grantedOrigins: [],
      grantedPermissions: [],
    };
  }

  try {
    const all = await chrome.permissions.getAll();
    return {
      grantedOrigins: Array.isArray(all.origins) ? [...all.origins] : [],
      grantedPermissions: Array.isArray(all.permissions) ? [...all.permissions] : [],
    };
  } catch {
    return {
      grantedOrigins: [],
      grantedPermissions: [],
    };
  }
}

export async function getExtensionPermissionsInfo(): Promise<ExtensionPermissionsInfo> {
  const manifest = getConfiguredManifestPermissions();
  const granted = await getGrantedPermissions();

  return {
    ...manifest,
    ...granted,
  };
}

/**
 * Returns a human-friendly description of what a specific permission pattern is used for.
 */
export function describeHostPermissionPurpose(pattern: string): string {
  if (pattern.includes('huggingface.co') || pattern.includes('hf.co')) {
    return 'Used only when downloading local ONNX model files from Hugging Face for on-device inference.';
  }
  if (pattern === 'https://*/*') {
    return 'Declared as an optional pattern to allow requesting access only to your custom HTTPS API endpoint on demand.';
  }
  return 'Requested on-demand for specific endpoint connectivity.';
}
