import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'abexcore-logo.png',
        'apple-touch-icon.png',
        'pwa-192.png',
        'pwa-512.png',
        'robots.txt',
        'sitemap.xml',
      ],
      manifest: {
        name: 'AbexCore ERP',
        short_name: 'AbexCore',
        description:
          'Enterprise resource planning by AbexCore Technologies.',
        theme_color: '#2563eb',
        background_color: '#f1f5f9',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        // Plain /login — never ?tenant=owner (that hid company code in installed apps).
        start_url: '/login',
        // Bump id so devices pick up the corrected start_url on next install/update.
        id: '/app',
        categories: ['business', 'productivity'],
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        disableDevLogs: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Never cache API — Workbox defaults to GET-only; register POST too for login.
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkOnly',
            method: 'GET',
          },
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkOnly',
            method: 'POST',
          },
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkOnly',
            method: 'PUT',
          },
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkOnly',
            method: 'PATCH',
          },
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkOnly',
            method: 'DELETE',
          },
        ],
      },
      devOptions: {
        // PWA is for production/preview; keeps dev console clean and avoids SW/HMR conflicts.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          charts: ['chart.js', 'react-chartjs-2'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
