import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './ui/AppRouter';
import { registerServiceWorker } from './pwa/registerServiceWorker';

if (import.meta.env.PROD) {
  void registerServiceWorker();
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <AppRouter />
    </StrictMode>,
  );
}
