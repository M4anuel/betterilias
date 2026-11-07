import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  build: {
    rollupOptions: { input: { app: 'index.html', admin: 'admin/index.html' } },
  },
  plugins: [
    {
      name: 'admin-directory-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] === '/admin') {
            res.writeHead(308, { Location: '/admin/' + (req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : '') });
            res.end();
          } else next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] === '/admin') {
            res.writeHead(308, { Location: '/admin/' + (req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : '') });
            res.end();
          } else next();
        });
      },
    },
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      }
    }
  }
})

