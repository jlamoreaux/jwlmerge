import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

import App from './App';
import './globals.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element not found — index.html is missing <div id="root">');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
