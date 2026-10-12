#!/usr/bin/env node
/**
 * Package the extension into a platform-specific VSIX.
 *
 *   node scripts/package.mjs            → dist/xplain-<platform>-<version>.vsix
 *   node scripts/package.mjs --release  → …and a copy in releases/ (gitignored; upload it to GitHub Releases)
 *
 * Why platform-specific: the bundled Cursor SDK pulls `@cursor/sdk-<platform>` with a native
 * tree-sitter binding, so a VSIX built on linux-x64 only works on linux-x64. The target is the
 * host that runs this script (override with --target <vsce target>).
 *
 * vsce refuses relative images in README.md when package.json has no repository URL, so the
 * VSIX gets a copy of README.md with image tags stripped (the banner stays in the repo README).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const release = args.includes('--release');
const targetIdx = args.indexOf('--target');
const target = targetIdx >= 0 ? args[targetIdx + 1] : hostTarget();

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

// README for the VSIX: drop images (HTML <img …> and Markdown ![…](…)) and relative links, keep everything else.
const readme = fs
  .readFileSync(path.join(root, 'README.md'), 'utf8')
  .replace(/<p[^>]*>\s*<img[^>]*>\s*<\/p>\s*\n?/g, '')
  .replace(/<img[^>]*>/g, '')
  .replace(/!\[[^\]]*\]\([^)]*\)\n?/g, '')
  // Relative links (e.g. README.en.md) have nowhere to point from the VSIX — keep the text only.
  .replace(/\[([^\]]+)\]\((?!\w+:\/\/|#)[^)]*\)/g, '$1');
// vsce matches --readme-path against collected files, so it must be a repo-relative path.
const readmeRel = 'dist/README.vsix.md';
const readmePath = path.join(root, readmeRel);
fs.writeFileSync(readmePath, readme);

const out = path.join(dist, `${pkg.name}-${target}-${pkg.version}.vsix`);
const vsce = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce');
execFileSync(
  vsce,
  ['package', '--allow-missing-repository', '--target', target, '--readme-path', readmeRel, '--out', out],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);
fs.rmSync(readmePath, { force: true });
console.log(`[package] ${path.relative(root, out)} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB, target ${target})`);

if (release) {
  const releases = path.join(root, 'releases');
  fs.mkdirSync(releases, { recursive: true });
  const dest = path.join(releases, path.basename(out));
  fs.copyFileSync(out, dest);
  console.log(`[package] copied to ${path.relative(root, dest)}`);
}

function hostTarget() {
  const os = { linux: 'linux', darwin: 'darwin', win32: 'win32' }[process.platform];
  const arch = { x64: 'x64', arm64: 'arm64', arm: 'armhf' }[process.arch];
  if (!os || !arch) throw new Error(`unsupported host ${process.platform}/${process.arch}; pass --target`);
  return os === 'linux' && fs.existsSync('/etc/alpine-release') ? `alpine-${arch}` : `${os}-${arch}`;
}
