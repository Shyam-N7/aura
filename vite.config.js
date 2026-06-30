import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' (not 'autoUpdate'): a waiting build never reloads on its OWN —
      // main.jsx/App.jsx drive updateSW(true) at a SAFE moment (never mid-song)
      // instead, so the update applies itself without yanking the app out from
      // under a listener and without a manual close/reopen. See src/lib/appUpdate.js.
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'AURA FM — AI radio that reads your mood',
        short_name: 'AURA FM',
        description: 'An AI music player and personal radio that learns how you feel and plays the songs that fit.',
        theme_color: '#1a1814',
        background_color: '#1a1814',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Audio streams have rotating CDN tokens; never cache them. Talk and
        // event POSTs must hit the network. Everything else falls into
        // sensible buckets per the V.7.0 plan.
        navigateFallback: '/index.html',
        // An offline NAVIGATION to /api/... must fail, not serve the app shell.
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/api\/catalog\/featured/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'aura-featured', expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 } },
          },
          {
            urlPattern: /\/api\/lyrics\//,
            handler: 'CacheFirst',
            options: { cacheName: 'aura-lyrics', expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 } },
          },
          // `/api/why` is intentionally NOT registered here — it's a POST and
          // Workbox only caches GET, so a CacheFirst rule would silently no-op
          // and every call would still hit Gemini. Server-side `why_cache`
          // table in server/index.js gives us the 24h TTL we want.
          {
            // PUBLIC reads only — fast cache fallback if the network is slow/
            // offline. Per-user authed endpoints (stats, sonic-dna, journal,
            // library, likes, history) are deliberately EXCLUDED: Workbox keys by
            // URL (not the session), so caching them would let one user's private
            // data be served to the next user on a shared device. They now go
            // straight to the network. (security: M7)
            urlPattern: /\/api\/(discover|catalog|artists|albums|tracks)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'aura-api',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
          {
            // Talk + write-side endpoints must always be live.
            urlPattern: /\/api\/(llm|events)/,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        // Service worker not registered in dev — Vite HMR doesn't play nicely
        // with workbox. Use `npm run preview` to test PWA behaviour.
        enabled: false,
      },
    }),
  ],
  server: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
