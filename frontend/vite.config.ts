import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the browser talks to Vite (port 5173); Vite forwards /api (REST + WebSocket)
// to the FastAPI server, so there are no CORS problems and the code uses relative URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:8000', changeOrigin: true, ws: true },
    },
  },
})
