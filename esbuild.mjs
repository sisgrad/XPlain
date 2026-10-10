// Build script: bundles the extension host code (CommonJS, Node) and the
// webview UI (IIFE, browser). Usage: node esbuild.mjs [--watch] [--production]
import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** @type {import('esbuild').Plugin} */
const reportPlugin = {
  name: 'report',
  setup(build) {
    build.onEnd((result) => {
      const label = build.initialOptions.outfile ?? 'bundle';
      if (result.errors.length) {
        console.error(`[esbuild] ${label}: ${result.errors.length} error(s)`);
      } else {
        console.log(`[esbuild] ${label} built`);
      }
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: [path.join(root, 'src/extension.ts')],
  bundle: true,
  outfile: path.join(root, 'dist/extension.js'),
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'silent',
  plugins: [reportPlugin],
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: [path.join(root, 'webview/main.tsx')],
  bundle: true,
  outfile: path.join(root, 'dist/webview.js'),
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  alias: { '@shared': path.join(root, 'src/shared') },
  loader: { '.css': 'css' },
  sourcemap: !production,
  minify: production,
  logLevel: 'silent',
  plugins: [reportPlugin],
};

async function copyStatic() {
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await copyFile(path.join(root, 'webview/styles.css'), path.join(root, 'dist/webview.css'));
  await copyFile(
    path.join(root, 'node_modules/highlight.js/styles/github-dark.min.css'),
    path.join(root, 'dist/hljs.css'),
  );
  await copyFile(path.join(root, 'node_modules/@vscode/codicons/dist/codicon.css'), path.join(root, 'dist/codicon.css'));
  await copyFile(path.join(root, 'node_modules/@vscode/codicons/dist/codicon.ttf'), path.join(root, 'dist/codicon.ttf'));
}

async function main() {
  await copyStatic();
  if (watch) {
    const ctxs = await Promise.all([esbuild.context(extensionOptions), esbuild.context(webviewOptions)]);
    await Promise.all(ctxs.map((c) => c.watch()));
    console.log('[esbuild] watching...');
  } else {
    const results = await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
    for (const r of results) {
      for (const e of r.errors) console.error(e.text, e.location ? `${e.location.file}:${e.location.line}` : '');
    }
    if (results.some((r) => r.errors.length)) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
