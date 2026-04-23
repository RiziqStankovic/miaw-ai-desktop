import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Windows Electron Vite configuration.
 *
 * Keeps the original Thuki React app intact by aliasing the small subset of
 * Tauri client modules it imports to local Electron shims.
 */
export default defineConfig(async () => ({
  base: './',
  plugins: [tailwindcss(), react()],
  clearScreen: false,
  resolve: {
    alias: {
      '@tauri-apps/api/core': path.resolve(rootDir, 'src/shims/tauri-core.ts'),
      '@tauri-apps/api/event': path.resolve(
        rootDir,
        'src/shims/tauri-event.ts',
      ),
      '@tauri-apps/api/window': path.resolve(
        rootDir,
        'src/shims/tauri-window.ts',
      ),
      '@tauri-apps/api/dpi': path.resolve(rootDir, 'src/shims/tauri-dpi.ts'),
    },
  },
  build: {
    chunkSizeWarningLimit: 950,
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
  },
}));
