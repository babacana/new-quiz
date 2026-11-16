import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TotemApp } from './ui/TotemApp';

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <TotemApp />
    </StrictMode>,
  );
}
