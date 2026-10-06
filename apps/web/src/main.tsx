import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@quizparty/ui-tokens/tokens.css';
import './styles/fonts.css';
import './styles/global.css';
import { App } from './App';
import { detectDevice, installDocumentFlags } from './lib/device';

installDocumentFlags(
  document,
  detectDevice({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  }),
);

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
