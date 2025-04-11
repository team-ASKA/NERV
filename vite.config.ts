import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs';

// Custom plugin to copy PDF.js worker file to public directory
const copyPdfWorker = () => {
  return {
    name: 'copy-pdf-worker',
    buildStart() {
      const workerSource = resolve(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
      const workerDest = resolve(__dirname, 'public/pdf.worker.min.js');
      
      // Ensure the public directory exists
      if (!fs.existsSync(resolve(__dirname, 'public'))) {
        fs.mkdirSync(resolve(__dirname, 'public'), { recursive: true });
      }
      
      // Copy the worker file
      if (fs.existsSync(workerSource)) {
        fs.copyFileSync(workerSource, workerDest);
        console.log('Successfully copied PDF.js worker to public directory');
      } else {
        console.error('Could not find PDF.js worker file:', workerSource);
      }
    }
  };
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    copyPdfWorker()
  ],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
