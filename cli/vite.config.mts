import { resolve } from 'path'
import { defineConfig } from 'vite'

// One ESM file with the shared code inlined; node-pty (native), @xterm/headless, its serialize addon and yaml stay dependencies.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, '../src/shared') } },
  build: {
    ssr: resolve(__dirname, 'src/main.ts'),
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      external: ['node-pty', '@xterm/headless', '@xterm/addon-serialize', 'yaml'],
      output: { format: 'es', entryFileNames: 'sldev.mjs', banner: '#!/usr/bin/env node' }
    }
  }
})
