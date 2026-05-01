/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional `host:port` override for the local FastAPI backend. When
   * unset, `lib/constants.ts` falls back to `127.0.0.1:8777`. Only read
   * at build time — Vite inlines `import.meta.env.*` at bundle time.
   */
  readonly VITE_API_HOST?: string
}
