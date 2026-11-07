import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DiagnosticConsent } from './components/DiagnosticConsent';
import './index.css';
import { importSessionFromUrl } from './lib/mobileSession';
import { clearRetiredBrowserStatistics } from './lib/legacyStorage';

async function bootstrap() {
  clearRetiredBrowserStatistics();
  let connectionError: string | null = null;
  try { await importSessionFromUrl(); }
  catch (error) { connectionError = String((error as Error).message); }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        {connectionError && <p role="alert" className="bg-amber-50 p-4 text-amber-900 dark:bg-amber-950 dark:text-amber-100">{connectionError}</p>}
        <App />
      </ErrorBoundary>
      <DiagnosticConsent />
    </React.StrictMode>
  );
}
void bootstrap();
