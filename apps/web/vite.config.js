import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'commercial-development-preview',
    apply: 'serve',
    configureServer(server) {
      if (process.env.ALTAN_COMERCIAL_PREVIEW !== '1') return;
      server.middlewares.use((req, _res, next) => {
        if (req.headers.accept?.includes('text/html') && !/\.[a-z0-9]+(?:\?|$)/i.test(req.url)) req.url = '/comercial-dev.html';
        next();
      });
    },
  }],
})
