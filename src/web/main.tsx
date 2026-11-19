import React from 'react';
import { createRoot } from 'react-dom/client';
import 'lxgw-wenkai-lite-webfont/lxgwwenkailite-regular.css';
import './workbench-themes.generated.css';
import './tokens.css';
import './shell.css';
import { App } from './App.js';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

