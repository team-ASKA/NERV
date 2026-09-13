import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
//
// The `/api/*` routes are Vercel serverless functions (see the `api/` directory).
// For full-stack local development run `vercel dev`, which serves both this app
// and the serverless functions on a single origin — no dev proxy required.
// Running plain `npm run dev` (vite) is fine for UI work; `/api` calls will simply
// be unavailable and the app degrades gracefully.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
