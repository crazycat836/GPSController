import React from 'react'
import ReactDOM from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App'
import { I18nProvider } from './i18n'
import ErrorBoundary from './components/ErrorBoundary'
import { migrateLegacyKeys } from './lib/storage-keys'

// Move settings saved under earlier key names (`gpscontroller.*`, old
// camelCase avatar keys) to `geomirage.*`. One-shot, idempotent — no-op for
// fresh installs and for users who've already migrated.
migrateLegacyKeys()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
