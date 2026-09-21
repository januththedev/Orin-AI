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
    build: {
      chunkSizeWarningLimit: 1000,
      minify: 'esbuild',
      target: 'es2020',
      cssMinify: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // AI SDK — largest dep, rarely changes → separate chunk
            if (id.includes('@google/genai')) return 'vendor-ai';
            // Firebase — split into smaller pieces
            if (id.includes('firebase/firestore')) return 'vendor-firebase-firestore';
            if (id.includes('firebase/auth') || id.includes('firebase/compat')) return 'vendor-firebase-auth';
            if (id.includes('firebase/app') || id.includes('firebase/messaging')) return 'vendor-firebase-core';
            if (id.includes('firebase-admin')) return 'vendor-firebase-admin';
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
      // Expose API Keys
      'process.env.API_KEY': JSON.stringify(env.API_KEY || env.VITE_API_KEY),
      'process.env.FIREBASE_API_KEY': JSON.stringify(env.FIREBASE_API_KEY || env.VITE_FIREBASE_API_KEY),
      'process.env.FIREBASE_APP_ID': JSON.stringify(env.FIREBASE_APP_ID || env.VITE_FIREBASE_APP_ID),
      'process.env.FIREBASE_AUTH_DOMAIN': JSON.stringify(env.FIREBASE_AUTH_DOMAIN || env.VITE_FIREBASE_AUTH_DOMAIN),
      'process.env.FIREBASE_PROJECT_ID': JSON.stringify(env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID),
      'process.env.FIREBASE_STORAGE_BUCKET': JSON.stringify(env.FIREBASE_STORAGE_BUCKET || env.VITE_FIREBASE_STORAGE_BUCKET),
      'process.env.FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(env.FIREBASE_MESSAGING_SENDER_ID || env.VITE_FIREBASE_MESSAGING_SENDER_ID),
      'process.env.FIREBASE_MEASUREMENT_ID': JSON.stringify(env.FIREBASE_MEASUREMENT_ID || env.VITE_FIREBASE_MEASUREMENT_ID),
      'process.env.VAPID_KEY': JSON.stringify(env.VAPID_KEY || env.VITE_VAPID_KEY),
      'process.env.VITE_RECAPTCHA_SITE_KEY': JSON.stringify(env.VITE_RECAPTCHA_SITE_KEY || env.RECAPTCHA_SITE_KEY || ''),
      // Shim Node's global for browser-only libs (e.g. plotly/has-hover)
      global: 'window',
    },
  };
});
