import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // One .env at the repository root for every package; Vite exposes only VITE_* variables to the browser.
  envDir: '../..',
  server: { port: 5173, strictPort: true },
});
