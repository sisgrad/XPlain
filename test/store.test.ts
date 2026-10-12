import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NodeStoreFs } from '../src/storage/fs';
import { XplainStore } from '../src/storage/XplainStore';

describe('XplainStore', () => {
  let root: string;
  let store: XplainStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'xplain-'));
    store = new XplainStore(new NodeStoreFs(path.join(root, '.xplain')));
    await store.init();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates the .xplain folder layout and an index', async () => {
    for (const p of ['.xplain', '.xplain/index.json', '.xplain/sessions', '.xplain/templates']) {
      assert.ok((await stat(path.join(root, p))).isFile() || (await stat(path.join(root, p))).isDirectory(), p);
    }
    const index = JSON.parse(await readFile(path.join(root, '.xplain/index.json'), 'utf8'));
    assert.deepEqual(index, { version: 1, anchors: [], sessions: [] });
  });

  it('reuses an anchor for the same block and moves it when the text shifts', async () => {
    const a = await store.upsertAnchor({ file: 'src/a.cu', startLine: 10, endLine: 12, text: 'x\ny\nz', language: 'cuda' });
    const b = await store.upsertAnchor({ file: 'src/a.cu', startLine: 10, endLine: 12, text: 'x\ny\nz', language: 'cuda' });
    assert.equal(a.id, b.id);
    const moved = await store.upsertAnchor({ file: 'src/a.cu', startLine: 14, endLine: 16, text: 'x\ny\nz', language: 'cuda' });
    assert.equal(moved.id, a.id);
    assert.equal(moved.startLine, 14);
    // A sub-range is a separate anchor.
    const sub = await store.upsertAnchor({ file: 'src/a.cu', startLine: 15, endLine: 15, text: 'y', language: 'cuda' });
    assert.notEqual(sub.id, a.id);
    assert.equal(store.anchors.length, 2);
  });

  it('stores sessions, links them to anchors and reads results back', async () => {
    const a1 = await store.upsertAnchor({ file: 'a.cu', startLine: 1, endLine: 2, text: 'a\nb', language: 'cuda' });
    const a2 = await store.upsertAnchor({ file: 'a.cu', startLine: 5, endLine: 5, text: 'c', language: 'cuda' });
    const session = await store.createSession({
      title: 'provisional',
      question: 'why?',
      items: [
        { kind: 'code', anchorId: a1.id, file: 'a.cu', startLine: 1, endLine: 2, language: 'cuda', text: 'a\nb' },
        { kind: 'code', anchorId: a2.id, file: 'a.cu', startLine: 5, endLine: 5, language: 'cuda', text: 'c' },
      ],
      agent: { provider: 'mock' },
    });
    assert.equal(session.status, 'pending');
    assert.deepEqual(session.anchorIds, [a1.id, a2.id]);
    // Drift tracking: the hash of the code the agent saw is recorded per anchor.
    assert.deepEqual(Object.keys(session.codeHashes ?? {}).sort(), [a1.id, a2.id].sort());
    assert.equal(session.codeHashes?.[a1.id], a1.textHash);

    await store.completeSession(session.id, { title: 'Warp specialisation explained', format: 'markdown', content: '# Hi' });
    const meta = store.getSession(session.id)!;
    assert.equal(meta.status, 'done');
    assert.equal(meta.title, 'Warp specialisation explained');
    // Both anchors see the same session (shared result for one context).
    assert.equal(store.sessionsForAnchor(a1.id)[0].id, session.id);
    assert.equal(store.sessionsForAnchor(a2.id)[0].id, session.id);

    const result = await store.readResult(session.id);
    assert.deepEqual(result, { format: 'markdown', content: '# Hi' });
    const ctx = await store.readSessionContext(session.id);
    assert.equal(ctx?.title, 'Warp specialisation explained');
    assert.equal(ctx?.items.length, 2);

    // Second session on the same block => two entries in the dropdown.
    const s2 = await store.createSession({ title: 't2', question: '', items: [ctx!.items[0]], agent: { provider: 'mock' } });
    await store.completeSession(s2.id, { title: 'Second look', format: 'html', content: '<h1>x</h1>' });
    assert.equal(store.sessionsForAnchor(a1.id).length, 2);
    assert.equal(store.sessionsForAnchor(a2.id).length, 1);
    assert.equal((await store.readResult(s2.id))?.format, 'html');

    // Deleting a session prunes anchors nobody references.
    await store.deleteSession(session.id);
    assert.ok(store.getAnchor(a1.id));
    assert.equal(store.getAnchor(a2.id), undefined);
  });

  it('replaceSessionContext overwrites context without dropping done status', async () => {
    const a = await store.upsertAnchor({ file: 'f.cu', startLine: 1, endLine: 2, text: 'x\ny', language: 'cuda' });
    const s = await store.createSession({
      title: 'Old',
      question: 'q1',
      items: [{ kind: 'code', anchorId: a.id, file: 'f.cu', startLine: 1, endLine: 2, language: 'cuda', text: 'x\ny' }],
      agent: { provider: 'mock' },
    });
    await store.completeSession(s.id, { title: 'Old', format: 'html', content: '<h1>Old</h1>' });
    await store.replaceSessionContext(s.id, {
      title: 'Revised',
      question: 'q2',
      items: [
        { kind: 'result', sessionId: s.id, title: 'Old' },
        { kind: 'file', name: 'n.md', content: 'note' },
      ],
      agent: { provider: 'cursor', model: 'composer-2.5' },
    });
    const meta = store.getSession(s.id)!;
    assert.equal(meta.status, 'done');
    assert.equal(meta.question, 'q2');
    assert.equal(meta.title, 'Revised');
    const ctx = await store.readSessionContext(s.id);
    assert.equal(ctx?.agent.provider, 'cursor');
    assert.ok(ctx?.items.some((i) => i.kind === 'file'));
    assert.equal((await store.readResult(s.id))?.content, '<h1>Old</h1>');
    // No code items in the new context → no code hashes.
    assert.deepEqual(meta.codeHashes, {});
  });

  it('backfills codeHashes for legacy sessions on init', async () => {
    const a = await store.upsertAnchor({ file: 'g.cu', startLine: 1, endLine: 1, text: 'legacy', language: 'cuda' });
    const s = await store.createSession({
      title: 'Legacy',
      question: '',
      items: [{ kind: 'code', anchorId: a.id, file: 'g.cu', startLine: 1, endLine: 1, language: 'cuda', text: 'legacy' }],
      agent: { provider: 'mock' },
    });
    // Simulate an index written before drift tracking existed.
    const indexPath = path.join(root, '.xplain', 'index.json');
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    for (const m of index.sessions) delete m.codeHashes;
    await writeFile(indexPath, JSON.stringify(index));

    const fresh = new XplainStore(new NodeStoreFs(path.join(root, '.xplain')));
    await fresh.init();
    assert.equal(fresh.getSession(s.id)?.codeHashes?.[a.id], a.textHash);
  });

  it('survives a reload from disk', async () => {
    const a = await store.upsertAnchor({ file: 'a.cu', startLine: 1, endLine: 1, text: 'a', language: 'cuda' });
    const s = await store.createSession({ title: 't', question: 'q', items: [], agent: { provider: 'mock' } });
    const fresh = new XplainStore(new NodeStoreFs(path.join(root, '.xplain')));
    await fresh.init();
    assert.equal(fresh.getAnchor(a.id)?.file, 'a.cu');
    assert.equal(fresh.getSession(s.id)?.question, 'q');
  });

  it('saves, lists, edits and deletes templates with files', async () => {
    const t = await store.saveTemplate({
      id: null,
      name: 'CUDA review',
      instruction: 'Focus on bank conflicts',
      files: [
        { name: 'notes.md', content: '# notes' },
        { name: '../evil/../path.txt', content: 'x' },
      ],
    });
    assert.equal(store.templateList.length, 1);
    assert.equal(t.scope, 'project');
    assert.deepEqual(
      t.files.map((f) => f.name),
      ['notes.md', 'path.txt'],
    );
    const files = await store.readTemplateFiles(t.id);
    assert.equal(files.find((f) => f.name === 'notes.md')?.content, '# notes');

    const edited = await store.saveTemplate({ id: t.id, name: 'CUDA review 2', instruction: 'x', files: [{ name: 'only.txt', content: 'o' }] });
    assert.equal(edited.id, t.id);
    assert.deepEqual((await store.readTemplateFiles(t.id)).map((f) => f.name), ['only.txt']);

    await store.deleteTemplate(t.id);
    assert.equal(store.templateList.length, 0);
  });
});
