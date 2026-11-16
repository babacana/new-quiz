import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Configuração unificada do Vite e do runner Vitest para testes unitários e de UI.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
