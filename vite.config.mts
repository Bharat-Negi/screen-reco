import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_ORIGIN = 'http://127.0.0.1:5173';

/** Injects a Content-Security-Policy. Dev needs inline scripts + websocket for React Fast Refresh. */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'scp-csp',
    transformIndexHtml(html, ctx) {
      const dev = Boolean(ctx.server);
      const policy = [
        "default-src 'self'",
        dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "media-src 'self' blob: mediastream:",
        dev ? `connect-src 'self' ${DEV_ORIGIN} ws://127.0.0.1:5173` : "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ');
      return html.replace('%CSP%', policy);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist/renderer', emptyOutDir: true, target: 'chrome130' },
});
