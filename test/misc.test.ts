import * as assert from 'node:assert/strict';
import { deriveTitle } from '../src/agent/titles';
import { ContextDraft } from '../src/context/ContextDraft';
import { isViewMessage } from '../src/shared/protocol';
import type { DraftItem } from '../src/shared/types';

const code: DraftItem = {
  kind: 'code',
  anchorId: 'a',
  file: 'debug_samples/4_warp_specialization.cu',
  startLine: 61,
  endLine: 224,
  language: 'cuda',
  text: '__global__ void attention_tcgen05_v4_kernel(\n  int x',
};

describe('deriveTitle', () => {
  it('prefers the agent title', () => {
    assert.equal(deriveTitle({ agentTitle: ' **Warp roles** ', question: 'q', format: 'markdown', content: '# h', items: [] }), 'Warp roles');
  });
  it('falls back to the first markdown heading', () => {
    assert.equal(deriveTitle({ question: 'q', format: 'markdown', content: 'intro\n\n## Why TMEM is used\ntext', items: [] }), 'Why TMEM is used');
  });
  it('uses the html <title>', () => {
    assert.equal(deriveTitle({ question: '', format: 'html', content: '<html><title>Pipeline stages</title></html>', items: [] }), 'Pipeline stages');
  });
  it('falls back to the question, then to the code block', () => {
    assert.equal(deriveTitle({ question: 'What does the MMA warp do?', format: 'markdown', content: 'no heading', items: [code] }), 'What does the MMA warp do?');
    const fromCode = deriveTitle({ question: '', format: 'markdown', content: '', items: [code] });
    assert.ok(fromCode.startsWith('4_warp_specialization.cu L61-L224: __global__ void attention_tcgen05'), fromCode);
    assert.ok(fromCode.length <= 72);
  });
  it('truncates long titles on a word boundary', () => {
    const t = deriveTitle({ agentTitle: 'word '.repeat(40), question: '', format: 'markdown', content: '', items: [] });
    assert.ok(t.length <= 72, t);
    assert.ok(t.endsWith('…'));
  });
});

describe('ContextDraft', () => {
  it('deduplicates items and tracks changes', () => {
    const d = new ContextDraft();
    let fired = 0;
    d.onDidChange(() => fired++);
    assert.equal(d.add(code), true);
    assert.equal(d.add({ ...code }), false);
    assert.equal(d.add({ kind: 'result', sessionId: 's', title: 't' }), true);
    assert.equal(d.snapshot.items.length, 2);
    d.move(1, 0);
    assert.equal(d.snapshot.items[0].kind, 'result');
    d.removeAt(0);
    d.setQuestion('why');
    d.setTemplate('tpl');
    assert.equal(d.isEmpty, false);
    d.clear();
    assert.equal(d.isEmpty, true);
    assert.equal(fired, 7);
  });

  it('updates code ranges when anchors move', () => {
    const d = new ContextDraft();
    d.add(code);
    d.updateCodeRanges(() => ({ startLine: 70, endLine: 233 }));
    const item = d.snapshot.items[0];
    assert.ok(item.kind === 'code' && item.startLine === 70 && item.endLine === 233);
  });
});

describe('protocol', () => {
  it('recognises view messages', () => {
    assert.equal(isViewMessage({ type: 'ready' }), true);
    assert.equal(isViewMessage({ nope: 1 }), false);
    assert.equal(isViewMessage(null), false);
  });
});
