#!/usr/bin/env node
/**
 * Build script — bundles all JS entry points into dist/
 * Run: node build.js
 * Watch: node build.js --watch
 */

import esbuild from 'esbuild';
import fs       from 'fs';
import path     from 'path';

const watch = process.argv.includes('--watch');

// Read overlay CSS and expose as a virtual module so it can be imported as a string
const inlineCSSPlugin = {
  name: 'inline-css',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = await fs.promises.readFile(args.path, 'utf8');
      return {
        contents: `export default ${JSON.stringify(css)};`,
        loader: 'js',
      };
    });
  },
};

const baseConfig = {
  bundle:   true,
  minify:   false, // keep readable for debugging; set true for production
  sourcemap: 'inline',
  plugins:  [inlineCSSPlugin],
  logLevel: 'info',
};

const entries = [
  // Content script — must be IIFE (no ES module syntax in output for content scripts)
  {
    entryPoints: ['src/content/content-main.js'],
    outfile:     'dist/content-main.js',
    format:      'iife',
    platform:    'browser',
    // Make chrome available as a global (it's provided by the extension runtime)
    external:    [],
    define:      {},
  },
  // Service worker — ESM output (manifest declares "type": "module")
  {
    entryPoints: ['src/background/service-worker.js'],
    outfile:     'dist/service-worker.js',
    format:      'esm',
    platform:    'browser',
  },
  // Options page script — IIFE
  {
    entryPoints: ['src/options/options.js'],
    outfile:     'dist/options.js',
    format:      'iife',
    platform:    'browser',
  },
  // Popup script — IIFE
  {
    entryPoints: ['src/popup/popup.js'],
    outfile:     'dist/popup.js',
    format:      'iife',
    platform:    'browser',
  },
];

async function build() {
  // Ensure dist/ exists
  fs.mkdirSync('dist', { recursive: true });

  if (watch) {
    const contexts = await Promise.all(
      entries.map(e => esbuild.context({ ...baseConfig, ...e }))
    );
    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('Watching for changes…');
  } else {
    await Promise.all(entries.map(e => esbuild.build({ ...baseConfig, ...e })));
    console.log('\nBuild complete. Load the extension root directory in Chrome.');
  }
}

build().catch(err => { console.error(err); process.exit(1); });
