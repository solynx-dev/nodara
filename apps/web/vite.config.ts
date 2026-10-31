import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const API = process.env.NODARA_API ?? 'http://localhost:8080';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: false, // served from public/manifest.webmanifest
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: API, ws: true, changeOrigin: false } },
  },
  preview: { port: 4173, proxy: { '/api': { target: API, ws: true } } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'], react: ['react', 'react-dom', 'react-router'] } } },
  },
});
