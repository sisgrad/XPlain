import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { candidatePaths, inlineLocalAssets } from '../src/agent/inlineAssets';

/** Minimal 1×1 PNG. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('inlineLocalAssets', () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'xplain-inline-'));
    await fs.mkdir(path.join(root, '.xplain', 'diagrams', 'sess1'), { recursive: true });
    await fs.mkdir(path.join(root, '.xplain', 'diagrams', 'other'), { recursive: true });
    await fs.writeFile(path.join(root, '.xplain', 'diagrams', 'walk.png'), TINY_PNG); // legacy root
    await fs.writeFile(path.join(root, '.xplain', 'diagrams', 'sess1', 'walk.png'), TINY_PNG);
    await fs.writeFile(path.join(root, '.xplain', 'diagrams', 'other', 'walk.png'), TINY_PNG);
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const opts = () => ({
    workspaceRoots: [root],
    readFile: async (abs: string) => {
      try {
        return new Uint8Array(await fs.readFile(abs));
      } catch {
        return undefined;
      }
    },
    listDir: async (abs: string) => {
      try {
        return await fs.readdir(abs);
      } catch {
        return [];
      }
    },
  });

  it('maps /workspace/.xplain/... and relative paths onto the workspace root', () => {
    const c = candidatePaths('/workspace/.xplain/diagrams/walk.png', [root]);
    assert.ok(c.some((p) => p.endsWith(path.join('.xplain', 'diagrams', 'walk.png'))));
  });

  it('inlines img src path references as data URIs', async () => {
    const html = `<!DOCTYPE html><html><body><img src="/workspace/.xplain/diagrams/sess1/walk.png" alt="d"></body></html>`;
    const res = await inlineLocalAssets(html, { ...opts(), sessionId: 'sess1' });
    assert.equal(res.missing.length, 0);
    assert.equal(res.inlined.length, 1);
    assert.match(res.html, /src="data:image\/png;base64,/);
    assert.doesNotMatch(res.html, /\/workspace\/\.xplain/);
  });

  it('inlines css url() references', async () => {
    const html = `<style>.x{background:url('.xplain/diagrams/sess1/walk.png')}</style>`;
    const res = await inlineLocalAssets(html, { ...opts(), sessionId: 'sess1' });
    assert.match(res.html, /url\("data:image\/png;base64,/);
  });

  it('does not fall back to another session\'s diagram when sessionId is set', async () => {
    const html = `<img src="walk.png">`;
    const res = await inlineLocalAssets(html, { ...opts(), sessionId: 'sess1' });
    assert.equal(res.missing.length, 0);
    // basename resolves only under sess1/, not other/ or diagrams root
    assert.match(res.html, /data:image\/png;base64,/);
    const forbidden = await inlineLocalAssets(`<img src=".xplain/diagrams/other/walk.png">`, {
      ...opts(),
      sessionId: 'sess1',
    });
    assert.deepEqual(forbidden.missing, ['.xplain/diagrams/other/walk.png']);
  });

  it('leaves http(s) and existing data URIs alone', async () => {
    const html = `<img src="https://example.com/a.png"><img src="data:image/png;base64,aa">`;
    const res = await inlineLocalAssets(html, opts());
    assert.equal(res.inlined.length, 0);
    assert.match(res.html, /https:\/\/example.com\/a.png/);
    assert.match(res.html, /data:image\/png;base64,aa/);
  });

  it('reports missing local files', async () => {
    const res = await inlineLocalAssets(`<img src=".xplain/diagrams/nope.png">`, opts());
    assert.deepEqual(res.missing, ['.xplain/diagrams/nope.png']);
  });
});
