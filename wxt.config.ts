import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    minimum_chrome_version: '102',
    name: 'Mozhi — Local-First Prompt Enhancer',
    description: 'Refine prompts without silently changing where they are processed.',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    permissions: ['storage', 'activeTab', 'scripting'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    optional_host_permissions: ['https://*/*', 'https://huggingface.co/*', 'https://*.huggingface.co/*', 'https://*.hf.co/*'],
    action: {
      default_title: 'Open Mozhi',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      },
    },
  },
});
