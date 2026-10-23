import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/noto-sans-sinhala';
import '@fontsource-variable/noto-sans-tamil';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const ORINAI_HOSTS = ['www.orinai.org', 'orinai.org'];

function isOrinAiOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return ORINAI_HOSTS.some((h) => host === h);
}

window.addEventListener('error', (event) => {
  if (process.env.NODE_ENV !== 'production') console.warn('[Orin]', event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.name === 'AbortError') return;
  if (process.env.NODE_ENV !== 'production') console.warn('[Orin]', event.reason);
  event.preventDefault();
});

const startApp = () => {
  const rootElement = document.getElementById('root');
  if (!rootElement) return;

  // Builds use content-hashed assets. If a browser retains an old app shell,
  // /refresh.html removes only Orin's asset caches. Never erase chat history or
  // preferences on a deploy, and never treat an absent version endpoint as a version.

  if ('serviceWorker' in navigator && isOrinAiOrigin()) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
        // When a new SW activates and sends SW_UPDATED_RELOAD, hard-reload once
        // so iOS users get the fresh app and auth fix rather than the stale cached copy.
        navigator.serviceWorker.addEventListener('message', e => {
          if (e.data?.type === 'SW_UPDATED_RELOAD') {
            // Only reload if not already reloading (avoid loop)
            if (!sessionStorage.getItem('sw_reloaded')) {
              sessionStorage.setItem('sw_reloaded', '1');
              window.location.reload();
            }
          }
        });
      }).catch(() => {});
    });
  }
  try {
    const app = <App />;
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        {app}
      </React.StrictMode>
    );
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('Mount error:', err);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
