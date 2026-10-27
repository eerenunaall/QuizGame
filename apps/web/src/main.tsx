import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@quizparty/ui-tokens/tokens.css';
import './styles/fonts.css';
import './styles/global.css';
import './styles/motion.css';
import { App } from './App';
import { detectDevice, installDocumentFlags } from './lib/device';
import { createStorage } from './lib/storage';
import { applyTheme, pickTheme, saveTheme, themeFromQuery } from './lib/theme';

installDocumentFlags(
  document,
  detectDevice({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  }),
);

// Theme before first paint (no flash). A ?theme= override is remembered for this device.
{
  const storage = createStorage();
  const theme = pickTheme(window.location.search, storage, import.meta.env);
  if (themeFromQuery(window.location.search)) saveTheme(storage, theme);
  applyTheme(document, theme);
}

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
