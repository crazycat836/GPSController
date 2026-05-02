import React from 'react'
import ReactDOM from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App'
import { I18nProvider } from './i18n'
import ErrorBoundary from './components/ErrorBoundary'
import { migrateAvatarKeys } from './lib/storage-keys'

// Promote legacy `gpsController.*` avatar keys to the canonical
// `gpscontroller.*` snake_case namespace. One-shot, idempotent — no-op for
// fresh installs and for users who've already migrated.
migrateAvatarKeys()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
