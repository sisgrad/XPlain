#!/usr/bin/env node
/**
 * Rebuild the offline Excalidraw export IIFE used by render_template.html.
 * Run from anywhere: node skills/excalidraw-diagram/references/vendor/build.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outJs = join(here, 'excalidraw-export.iife.js');
const outVer = join(here, 'VERSION.txt');
const work = mkdtempSync(join(tmpdir(), 'xplain-excal-vendor-'));

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

try {
  writeFileSync(join(work, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '@excalidraw/excalidraw', 'esbuild', '--no-fund', '--no-audit'], work);
  // Ensure esbuild native binary is present (npm may skip install scripts).
  spawnSync(process.execPath, [join(work, 'node_modules/esbuild/install.js')], { cwd: work, stdio: 'inherit' });

  writeFileSync(
    join(work, 'entry.mjs'),
    'import { exportToSvg } from "@excalidraw/excalidraw";\nwindow.ExcalidrawExport = { exportToSvg };\n',
  );

  run(
    join(work, 'node_modules/.bin/esbuild'),
    [
      'entry.mjs',
      '--bundle',
      '--format=iife',
      '--platform=browser',
      '--target=es2022',
      `--outfile=${outJs}`,
      '--minify',
      '--legal-comments=none',
    ],
    work,
  );

  const pkg = JSON.parse(readFileSync(join(work, 'node_modules/@excalidraw/excalidraw/package.json'), 'utf8'));
  writeFileSync(
    outVer,
    [
      `@excalidraw/excalidraw@${pkg.version}`,
      'bundle=excalidraw-export.iife.js',
      'built-for=offline Playwright render (exportToSvg)',
      `rebuilt=${new Date().toISOString()}`,
      '',
    ].join('\n'),
  );
  console.log(`Wrote ${outJs}`);
  console.log(`Wrote ${outVer}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
