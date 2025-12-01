import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js',
          dest: '.'
        },
        {
          src: 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm',
          dest: '.'
        }
      ]
    })
  ],
  base: './', // Important for Electron relative paths
  publicDir: 'assets',
  resolve: {
    alias: {
      process: "process/browser",
      stream: "stream-browserify",
      zlib: "browserify-zlib",
      util: "util",
      buffer: "buffer", // Added explicit buffer alias
    }
  },
  define: {
    'process.env': {},
    'global': 'window', // Polyfill global for simple-peer
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
  }
})
