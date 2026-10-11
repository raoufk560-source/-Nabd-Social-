import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': rootDir
    }
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true'
  }
});
