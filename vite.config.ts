import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Injeta os bundles compilados (JS/CSS) no Service Worker gerado em dist/sw.js
 * para garantir que o app shell funcione offline mesmo apos a primeira instalacao.
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
      const bundleUrls = fs
        .readdirSync(assetsDir)
        .filter((file) => file.endsWith('.js') || file.endsWith('.css'))
        .map((file) => `/assets/${file}`);
      const swSource = fs.readFileSync(swPath, 'utf8');
      const updated = swSource.replace(
        'const BUILD_ASSETS = [];',
        `const BUILD_ASSETS = ${JSON.stringify(bundleUrls)};`,
      );
      fs.writeFileSync(swPath, updated, 'utf8');
    },
  };
}

// Configuração unificada do Vite e do runner Vitest para testes unitários e de UI.
export default defineConfig({
  plugins: [react(), pwaPrecachePlugin()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
