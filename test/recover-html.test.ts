import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractHtmlPaths, isCompleteHtmlDocument, recoverHtmlAnswer } from '../src/agent/recoverHtml';

const FULL = `<!DOCTYPE html>
<html lang="ru"><head><title>QK</title></head>
<body><h1>QK</h1><p>${'x'.repeat(500)}</p><img src="data:image/png;base64,aa=="/></body></html>`;

describe('recoverHtmlAnswer', () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'xplain-recover-'));
    await fs.mkdir(path.join(root, '.xplain'), { recursive: true });
    await fs.writeFile(path.join(root, '.xplain', 'qk_explanation.html'), FULL);
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('detects complete documents vs stubs', () => {
    assert.equal(isCompleteHtmlDocument(FULL), true);
    assert.equal(isCompleteHtmlDocument('<!DOCTYPE html><html></html>'), false);
  });

  it('extracts html paths from stub text', () => {
    const paths = extractHtmlPaths('see `/hdd/XPlain/.xplain/qk_explanation.html` or cat it');
    assert.ok(paths.some((p) => p.endsWith('qk_explanation.html')));
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
