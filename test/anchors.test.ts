import * as assert from 'node:assert/strict';
import {
  applyLineChange,
  applyLineChanges,
  findSnippet,
  formatRange,
  hashBlock,
  normalizeBlock,
  rangeMatchesHash,
  toLineChange,
} from '../src/editor/anchors';

describe('anchors', () => {
  describe('normalizeBlock / hashBlock', () => {
    it('ignores trailing whitespace, CRLF and surrounding blank lines', () => {
      const a = 'int x = 1;   \r\n  return x;\r\n\r\n';
      const b = '\nint x = 1;\n  return x;';
      assert.equal(normalizeBlock(a), normalizeBlock(b));
      assert.equal(hashBlock(a), hashBlock(b));
    });
    it('is sensitive to indentation changes', () => {
      assert.notEqual(hashBlock('a\n  b'), hashBlock('a\nb'));
    });
  });

  describe('toLineChange', () => {
    it('describes a whole-line insertion before a line', () => {
      const c = toLineChange({ startLine: 4, startChar: 0, endLine: 4, endChar: 0, text: 'new\n' });
      assert.deepEqual(c, { startLine: 5, endLine: 4, delta: 1 });
    });
    it('describes a whole-line deletion', () => {
      const c = toLineChange({ startLine: 4, startChar: 0, endLine: 5, endChar: 0, text: '' });
      assert.deepEqual(c, { startLine: 5, endLine: 5, delta: -1 });
    });
    it('describes typing within a line', () => {
      const c = toLineChange({ startLine: 9, startChar: 3, endLine: 9, endChar: 3, text: 'x' });
      assert.deepEqual(c, { startLine: 10, endLine: 10, delta: 0 });
    });
    it('describes a multi-line replacement', () => {
      const c = toLineChange({ startLine: 2, startChar: 1, endLine: 4, endChar: 2, text: 'a\nb' });
      assert.deepEqual(c, { startLine: 3, endLine: 5, delta: -1 });
    });
  });

  describe('applyLineChange', () => {
    const block = { startLine: 10, endLine: 20 };

    it('shifts the block when lines are inserted above', () => {
      assert.deepEqual(applyLineChange(block, { startLine: 3, endLine: 3, delta: 2 }), { startLine: 12, endLine: 22 });
    });
    it('shifts the block when whole lines are inserted right before it', () => {
      assert.deepEqual(applyLineChange(block, { startLine: 10, endLine: 9, delta: 1 }), { startLine: 11, endLine: 21 });
    });
    it('shifts the block when a line directly above is deleted', () => {
      assert.deepEqual(applyLineChange(block, { startLine: 9, endLine: 9, delta: -1 }), { startLine: 9, endLine: 19 });
    });
    it('keeps the block when editing below it', () => {
      assert.deepEqual(applyLineChange(block, { startLine: 25, endLine: 30, delta: -5 }), block);
    });
    it('grows the block when lines are inserted inside', () => {
      assert.deepEqual(applyLineChange(block, { startLine: 15, endLine: 15, delta: 3 }), { startLine: 10, endLine: 23 });
    });
    it('shrinks the block when lines are deleted inside', () => {
      assert.deepEqual(applyLineChange(block, { startLine: 12, endLine: 14, delta: -2 }), { startLine: 10, endLine: 18 });
    });
    it('returns null when the block is deleted entirely', () => {
      assert.equal(applyLineChange(block, { startLine: 8, endLine: 22, delta: -15 }), null);
    });
    it('points to the replacement when the block is overwritten', () => {
      assert.deepEqual(applyLineChange(block, { startLine: 10, endLine: 20, delta: -8 }), { startLine: 10, endLine: 12 });
    });
    it('applies a sequence of changes', () => {
      const r = applyLineChanges(block, [
        { startLine: 1, endLine: 1, delta: 1 },
        { startLine: 30, endLine: 30, delta: 5 },
        { startLine: 15, endLine: 15, delta: 1 },
      ]);
      assert.deepEqual(r, { startLine: 11, endLine: 22 });
    });
  });

  describe('findSnippet', () => {
    const doc = ['a', 'b', 'c', 'x', 'b', 'c', 'y'];
    it('finds the occurrence closest to the preferred start', () => {
      assert.deepEqual(findSnippet(doc, 'b\nc', 1), { startLine: 2, endLine: 3 });
      assert.deepEqual(findSnippet(doc, 'b\nc  ', 6), { startLine: 5, endLine: 6 });
    });
    it('returns null when the snippet is gone', () => {
      assert.equal(findSnippet(doc, 'zzz', 1), null);
      assert.equal(findSnippet(doc, '', 1), null);
    });
  });

  describe('rangeMatchesHash', () => {
    const lines = ['one', 'two', 'three'];
    it('validates a hash against document lines', () => {
      const h = hashBlock('two\nthree');
      assert.equal(rangeMatchesHash(lines, { startLine: 2, endLine: 3 }, h), true);
      assert.equal(rangeMatchesHash(lines, { startLine: 1, endLine: 2 }, h), false);
      assert.equal(rangeMatchesHash(lines, { startLine: 3, endLine: 5 }, h), false);
    });
  });

  it('formats ranges', () => {
    assert.equal(formatRange({ startLine: 4, endLine: 4 }), 'L4');
    assert.equal(formatRange({ startLine: 4, endLine: 9 }), 'L4-L9');
  });
});
