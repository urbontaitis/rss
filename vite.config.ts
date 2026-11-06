import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src * data: blob:",
  "media-src * data: blob:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  'frame-src https:',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "manifest-src 'self'",
].join('; ')

function csp(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />`)
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), csp()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 400,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
            { name: 'dompurify', test: /node_modules[\\/]dompurify[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'supabase/functions/fetch/handler.ts'],
      exclude: ['src/test/**', 'src/main.tsx', 'src/**/*.d.ts'],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      thresholds: {
        statements: 99,
        branches: 95,
        functions: 99,
        lines: 99,
      },
    },
  },
})
