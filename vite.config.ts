import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`       -> hosted build (dist/) that talks to Supabase
// `npm run build:demo`  -> one self-contained HTML file (dist-demo/) running on sample data
// base './' = relative asset paths, so the build works at a domain root or a sub-path
// (e.g. GitHub Pages at /sdr-renovation-pm/).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'demo' ? [react(), viteSingleFile()] : [react()],
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist' },
}));
