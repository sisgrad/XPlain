import * as assert from 'node:assert/strict';
import {
  buildIsolationBlock,
  CURSORIGNORE_BEGIN,
  CURSORIGNORE_END,
  stripIsolationBlock,
} from '../src/agent/cursorIsolation';

describe('cursorIsolation', () => {
  it('builds a managed block with session diagram allow-exception', () => {
    const block = buildIsolationBlock('abc-123');
    assert.match(block, new RegExp(CURSORIGNORE_BEGIN));
    assert.match(block, new RegExp(CURSORIGNORE_END));
    assert.match(block, /\.xplain\/sessions\/\*\*/);
    assert.match(block, /\.xplain\/diagrams\/\*\*/);
    assert.match(block, /!\.xplain\/diagrams\/abc-123\//);
    assert.match(block, /!\.xplain\/skills\//);
  });

  it('strips an existing managed block', () => {
    const text = ['# keep me', '', buildIsolationBlock('old'), '# also keep', ''].join('\n');
    const stripped = stripIsolationBlock(text);
    assert.match(stripped, /# keep me/);
    assert.match(stripped, /# also keep/);
    assert.doesNotMatch(stripped, /xplain-agent-isolation/);
    assert.doesNotMatch(stripped, /abc-123|old/);
  });
});
