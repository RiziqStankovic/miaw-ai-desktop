import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

function formatDiagnostic(error: unknown) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function showStartupDiagnostic(title: string, error: unknown) {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }

  root.innerHTML = `
    <div style="
      box-sizing: border-box;
      width: 100vw;
      min-height: 100vh;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(18, 12, 10, 0.96);
      color: #f0f0f2;
      font-family: Inter, Segoe UI, sans-serif;
    ">
      <div style="
        width: min(520px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);
        overflow: auto;
        border: 1px solid rgba(248, 113, 113, 0.35);
        border-radius: 18px;
        background: rgba(32, 18, 16, 0.98);
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
        padding: 16px;
      ">
        <div style="
          display: inline-flex;
          padding: 4px 9px;
          border-radius: 999px;
          background: rgba(248, 113, 113, 0.16);
          color: #fca5a5;
          font-size: 11px;
          font-weight: 700;
          margin-bottom: 10px;
        ">Startup diagnostic</div>
        <h1 style="font-size: 16px; margin: 0 0 8px;">${title}</h1>
        <p style="margin: 0 0 12px; color: #b8a7a0; font-size: 12px; line-height: 1.5;">
          Miaw failed before the normal UI was ready. Check this message and
          <code style="color:#ffb08a;">%APPDATA%\\Miaw\\miaw.log</code>.
        </p>
        <pre style="
          white-space: pre-wrap;
          word-break: break-word;
          margin: 0;
          padding: 12px;
          border-radius: 12px;
          background: rgba(0, 0, 0, 0.28);
          color: #fecaca;
          font-size: 11px;
          line-height: 1.45;
          user-select: text;
        "></pre>
      </div>
    </div>
  `;

  const pre = root.querySelector('pre');
  if (pre) {
    pre.textContent = formatDiagnostic(error);
  }
}

window.addEventListener('error', (event) => {
  showStartupDiagnostic('Renderer error', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  showStartupDiagnostic('Unhandled renderer promise rejection', event.reason);
});

class StartupErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    showStartupDiagnostic('React render error', error);
  }

  render() {
    if (this.state.error) {
      showStartupDiagnostic('React render error', this.state.error);
      return null;
    }
    return this.props.children;
  }
}

window.setTimeout(() => {
  if (!window.__thukiElectron) {
    showStartupDiagnostic(
      'Electron preload bridge missing',
      'window.__thukiElectron is not available. The preload script did not run or failed before exposing the bridge.',
    );
  }
}, 1500);

/**
 * Entry point for the React application.
 *
 * Mounts the root App component into the DOM container with ID 'root'.
 */
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <StartupErrorBoundary>
      <App />
    </StartupErrorBoundary>
  </React.StrictMode>,
);
