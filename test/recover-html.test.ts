import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  extractEmbeddedHtmlDocument,
  extractHtmlPaths,
  isCompleteHtmlDocument,
  isRenderTemplateShell,
  recoverHtmlAnswer,
} from '../src/agent/recoverHtml';

const FULL = `<!DOCTYPE html>
<html lang="ru"><head><title>QK</title></head>
<body><h1>QK</h1><p>${'x'.repeat(500)}</p><img src="data:image/png;base64,aa=="/></body></html>`;

const RENDER_SHELL = `<!DOCTYPE html>
<html><head><title>XPlain explanation</title></head>
<body><div id="root"></div>
<script src="./vendor/excalidraw-export.iife.js"></script>
<script>window.renderDiagram = async function () {}</script>
</body></html>`;

describe('recoverHtmlAnswer', () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'xplain-recover-'));
    await fs.mkdir(path.join(root, '.xplain', 'skills', 'excalidraw-diagram', 'references'), { recursive: true });
    await fs.writeFile(path.join(root, '.xplain', 'qk_explanation.html'), FULL);
    await fs.writeFile(
      path.join(root, '.xplain', 'skills', 'excalidraw-diagram', 'references', 'render_template.html'),
      RENDER_SHELL,
    );
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('detects complete documents vs stubs', () => {
    assert.equal(isCompleteHtmlDocument(FULL), true);
    assert.equal(isCompleteHtmlDocument('<!DOCTYPE html><html></html>'), false);
    assert.equal(isRenderTemplateShell(RENDER_SHELL), true);
    assert.equal(isCompleteHtmlDocument(RENDER_SHELL), false);
  });

  it('extracts html paths from stub text', () => {
    const paths = extractHtmlPaths('see `/hdd/XPlain/.xplain/qk_explanation.html` or cat it');
    assert.ok(paths.some((p) => p.endsWith('qk_explanation.html')));
  });

  it('extracts an HTML document after a chat preamble', () => {
    const mixed = `All four diagrams are rendered. Here is the explanation.\n\n${FULL}`;
    const embedded = extractEmbeddedHtmlDocument(mixed);
    assert.equal(embedded, FULL);
  });

  it('prefers preamble-embedded HTML over a recent render_template on disk', async () => {
    const mixed = `All four diagrams are rendered and validated. Here is the explanation.\n\n${FULL}`;
    const res = await recoverHtmlAnswer(mixed, {
      workspaceRoots: [root],
      sinceMs: Date.now() - 60_000,
    });
    assert.equal(res.recoveredFrom, undefined);
    assert.match(res.html, /<title>QK<\/title>/);
    assert.equal(isRenderTemplateShell(res.html), false);
  });

  it('recovers HTML written beside a stub chat reply', async () => {
    const stub = `Полный HTML в \`/workspace/.xplain/qk_explanation.html\`. В чат не помещается.\n\n## Summary\nshort`;
    const res = await recoverHtmlAnswer(stub, {
      workspaceRoots: [root],
      sinceMs: Date.now() - 60_000,
    });
    assert.ok(res.recoveredFrom?.endsWith('qk_explanation.html'));
    assert.match(res.html, /QK/);
    assert.match(res.html, /data:image\/png/);
  });

  it('keeps an already-complete HTML answer', async () => {
    const res = await recoverHtmlAnswer(FULL, { workspaceRoots: [root] });
    assert.equal(res.recoveredFrom, undefined);
    assert.equal(res.html, FULL);
  });
});
