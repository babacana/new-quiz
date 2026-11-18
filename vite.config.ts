import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Injeta os bundles compilados (JS/CSS) e hash de versão no Service Worker gerado em dist/sw.js
 * para garantir invalidação determinística e cache offline do app shell.
 */
function pwaPrecachePlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'pwa-precache-assets',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const swPath = path.resolve(outDir, 'sw.js');
      const assetsDir = path.resolve(outDir, 'assets');
      if (!fs.existsSync(swPath) || !fs.existsSync(assetsDir)) {
        return;
      }
      const assetFiles = fs
        .readdirSync(assetsDir)
        .filter((file) => file.endsWith('.js') || file.endsWith('.css'))
        .sort();
      const bundleUrls = assetFiles.map((file) => `/assets/${file}`);
      const hash = crypto.createHash('sha256');
      for (const file of assetFiles) {
        hash.update(file);
        hash.update(fs.readFileSync(path.join(assetsDir, file)));
      }
      const cacheVersion = hash.digest('hex').slice(0, 10) || 'v1';

      const swSource = fs.readFileSync(swPath, 'utf8');
      const updated = swSource
        .replace(
          "const CACHE_NAME = 'new-quiz-shell-v1';",
          `const CACHE_NAME = 'new-quiz-shell-${cacheVersion}';`,
        )
        .replace(
          'const BUILD_ASSETS = [];',
          `const BUILD_ASSETS = ${JSON.stringify(bundleUrls)};`,
        );
      fs.writeFileSync(swPath, updated, 'utf8');
    },
  };
}

// Configuração unificada do Vite e do runner Vitest para testes unitários e de UI.
export default defineConfig({
  plugins: [react(), tailwindcss(), pwaPrecachePlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@supabase/')) {
            return 'vendor-supabase';
          }
          if (id.includes('node_modules/dexie')) {
            return 'vendor-dexie';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
