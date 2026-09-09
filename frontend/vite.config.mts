import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  base: './',
  server: { port: 5173 },
  build: {
    rolldownOptions: {
      output: {
        // Rolldown (Vite 8) manual chunking — split the heaviest deps out of
        // the main chunk so app-code changes don't bust the vendor cache.
        codeSplitting: {
          groups: [
            { name: 'leaflet', test: /node_modules[\\/]leaflet[\\/]/ },
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})
