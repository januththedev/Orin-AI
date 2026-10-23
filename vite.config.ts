import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

/** Injects build timestamp into public/sw.js when writing to dist so cache version auto-bumps on deploy. */
function swVersionPlugin() {
  let outDir = 'dist';
  return {
    name: 'sw-version',
    configResolved(config: { build: { outDir: string } }) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const publicSw = path.resolve(process.cwd(), 'public/sw.js');
      const distSw = path.resolve(process.cwd(), outDir, 'sw.js');
      if (!fs.existsSync(publicSw) || !fs.existsSync(path.dirname(distSw))) return;
      let content = fs.readFileSync(publicSw, 'utf-8');
      content = content.replace(/%SW_VERSION%/g, Date.now().toString());
      fs.writeFileSync(distSw, content);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, (process as any).cwd(), '');

  return {
    plugins: [react(), swVersionPlugin()],
    server: { proxy: { '/api/workspace': 'http://127.0.0.1:3001' } },
    preview: { proxy: { '/api/workspace': 'http://127.0.0.1:3001' } },
    resolve: {
      // Single React copy so the app can never load two Reacts and crash on hooks.
      dedupe: ['react', 'react-dom'],
    },
    build: {
      chunkSizeWarningLimit: 1000,
      // Vite 8 minifies with Oxc, not esbuild. Naming 'esbuild' explicitly makes
      // vite try to import a package it no longer depends on, and the build dies
      // with ERR_MODULE_NOT_FOUND -- so leave this on the default minifier.
      minify: true,
      target: 'es2020',
      cssMinify: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // AI SDK — largest dep, rarely changes → separate chunk
            if (id.includes('@google/genai')) return 'vendor-ai';
            // Math — heavy, only in maths tab
            if (id.includes('nerdamer')) return 'vendor-nerdamer';
            if (id.includes('mathjs')) return 'vendor-mathjs';
            if (id.includes('katex')) return 'vendor-katex';
            // Plotly — only in graphs
            if (id.includes('plotly')) return 'vendor-plotly';
            // React core
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'vendor-react';
          },
        },
      },
    },
    define: {
      // Legacy browser references stay empty; provider secrets remain server-side.
      'process.env.API_KEY': JSON.stringify(''),
      'process.env.VITE_RECAPTCHA_SITE_KEY': JSON.stringify(env.VITE_RECAPTCHA_SITE_KEY || env.RECAPTCHA_SITE_KEY || ''),
      // Shim Node's global for browser-only libs (e.g. plotly/has-hover)
      global: 'window',
    },
  };
});
