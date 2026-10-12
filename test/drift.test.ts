import * as assert from 'node:assert/strict';
import { computeDrift, describeDrift, lineDiff, stripCosmetic, unifiedDiff, worstLevel } from '../src/editor/drift';

const kernel = [
  '__global__ void add(const float* a, const float* b, float* c, int n) {',
  '  int i = blockIdx.x * blockDim.x + threadIdx.x;',
  '  if (i < n) {',
  '    c[i] = a[i] + b[i];',
  '  }',
  '}',
].join('\n');

describe('drift', () => {
  it('identical text is fresh', () => {
    const d = computeDrift(kernel, kernel);
    assert.equal(d.level, 'fresh');
    assert.equal(d.changedLines, 0);
    assert.equal(d.cosmetic, false);
  });

  it('comment and whitespace edits are cosmetic → still fresh', () => {
    const edited = kernel.replace('int i =', '  int i =   ').replace('c[i] = a[i] + b[i];', 'c[i] = a[i] + b[i]; // sum') + '\n\n';
    const d = computeDrift(kernel, edited);
    assert.equal(d.level, 'fresh');
    assert.equal(d.cosmetic, true);
    assert.equal(d.changedLines, 0);
  });

  it('a small body edit is drifted (not outdated)', () => {
    const edited = kernel.replace('c[i] = a[i] + b[i];', 'c[i] = a[i] * b[i];');
    const d = computeDrift(kernel, edited);
    assert.equal(d.level, 'drifted');
    assert.equal(d.changedLines, 2); // one removed + one added
    assert.equal(d.headChanged, false);
    assert.match(describeDrift(d), /code changed \(2 lines\)/);
  });

  it('changing the block head (signature) marks it outdated', () => {
    const edited = kernel.replace('float* c, int n', 'float* c, int n, float alpha');
    const d = computeDrift(kernel, edited);
    assert.equal(d.level, 'outdated');
    assert.equal(d.headChanged, true);
  });

  it('a large rewrite is outdated by ratio and absolute lines', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `x${i} = f(${i});`);
    const old = `head()\n${lines.join('\n')}`;
    const rewritten = `head()\n${lines.map((l, i) => (i % 2 ? l : l.replace('f(', 'g('))).join('\n')}`;
    const d = computeDrift(old, rewritten);
    assert.equal(d.level, 'outdated');
    assert.ok(d.changedLines > 10);
    assert.ok(d.ratio > 0.3);
  });

  it('a few changed lines in a big block stay drifted even if more than ratio allows', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `l${i}`);
    const old = `h\n${lines.join('\n')}`;
    const edited = `h\n${lines.map((l, i) => (i < 3 ? `${l}'` : l)).join('\n')}`;
    const d = computeDrift(old, edited, { outdatedRatio: 0.1, driftedMaxLines: 10 });
    assert.equal(d.level, 'drifted'); // 6 changed lines ≤ driftedMaxLines
  });

  it('missing block is lost', () => {
    const d = computeDrift(kernel, undefined);
    assert.equal(d.level, 'lost');
    assert.equal(d.changedLines, 6);
    assert.equal(describeDrift(d), 'code block not found');
  });

  it('worstLevel orders fresh < drifted < outdated < lost', () => {
    assert.equal(worstLevel([]), 'fresh');
    assert.equal(worstLevel(['fresh', 'drifted']), 'drifted');
    assert.equal(worstLevel(['drifted', 'outdated', 'fresh']), 'outdated');
    assert.equal(worstLevel(['outdated', 'lost']), 'lost');
  });

  it('lineDiff produces a minimal LCS edit script', () => {
    const ops = lineDiff(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
    assert.deepEqual(
      ops.map((o) => `${o.type}:${o.text}`),
      ['same:a', 'del:b', 'add:x', 'same:c', 'same:d', 'add:e'],
    );
  });

  it('lineDiff falls back to replace-all when the matrix is too large', () => {
    const ops = lineDiff(['a', 'b'], ['a', 'c'], 1);
    assert.deepEqual(
      ops.map((o) => o.type),
      ['del', 'del', 'add', 'add'],
    );
  });

  it('unifiedDiff has headers and +/- markers', () => {
    const out = unifiedDiff('a\nb\n', 'a\nc\n', { file: 'k.cu' });
    assert.match(out, /^--- k\.cu \(explained\)\n\+\+\+ k\.cu \(current\)\n/);
    assert.ok(out.includes('\n a\n'));
    assert.ok(out.includes('\n-b\n'));
    assert.ok(out.includes('\n+c'));
  });

  it('stripCosmetic removes comments and whitespace', () => {
    const a = stripCosmetic('int x = 1; // one\n/* block\n comment */\n  int   y = 2;\n\n');
    const b = stripCosmetic('int x = 1;\nint y = 2;');
    assert.equal(a, b);
  });
});
