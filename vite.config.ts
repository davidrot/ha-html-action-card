import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Dev only: a stand-in camera picture for the examples page (Home Assistant serves the real one). */
const cameraPicture = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9d3c7"/><stop offset="1" stop-color="#bfb7a8"/></linearGradient></defs>
  <rect width="640" height="360" fill="url(#w)"/>
  <rect y="250" width="640" height="110" fill="#8a6f55"/>
  <rect x="60" y="50" width="150" height="120" fill="#bfe0f5" stroke="#fff" stroke-width="8"/>
  <path d="M135 50v120M60 110h150" stroke="#fff" stroke-width="5"/>
  <rect x="300" y="190" width="260" height="80" rx="14" fill="#5d7a8c"/>
  <rect x="300" y="160" width="260" height="50" rx="14" fill="#6f8ea1"/>
  <rect x="320" y="270" width="14" height="24" fill="#3c2f25"/><rect x="526" y="270" width="14" height="24" fill="#3c2f25"/>
  <rect x="250" y="120" width="10" height="130" fill="#4a3b2e"/><ellipse cx="255" cy="110" rx="34" ry="26" fill="#f4e3b0"/>
  <circle cx="470" cy="80" r="26" fill="none" stroke="#7a6a58" stroke-width="5"/><path d="M470 80V62M470 80l12 8" stroke="#7a6a58" stroke-width="4"/>
  <text x="14" y="26" font-family="monospace" font-size="15" fill="#fff" stroke="#0006" stroke-width=".5">CAM 01  demo picture</text>
</svg>`;

// Single-file ES module bundle for HACS / dashboard resources.
export default defineConfig({
  plugins: [
    {
      name: 'demo-camera',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/api/camera_proxy')) return next();
          res.setHeader('Content-Type', 'image/svg+xml');
          res.end(cameraPicture);
        });
      },
    },
  ],
  define: { __VERSION__: JSON.stringify(pkg.version) },
  build: {
    lib: {
      entry: 'src/main.ts',
      formats: ['es'],
      fileName: () => 'html-action-card.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: true,
  },
});
