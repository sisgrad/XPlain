import * as assert from 'node:assert/strict';
import {
  bridgeSkillPath,
  canonicalSkillPath,
  skillBridgeForProvider,
} from '../src/skills/skillPaths';

describe('skillPaths', () => {
  it('keeps a durable agent-agnostic store under .xplain/skills', () => {
    assert.equal(canonicalSkillPath('excalidraw-diagram'), '.xplain/skills/excalidraw-diagram');
  });

  it('maps providers to discovery bridges', () => {
    assert.equal(skillBridgeForProvider('cursor'), 'cursor');
    assert.equal(skillBridgeForProvider('hermes'), 'claude');
    assert.equal(skillBridgeForProvider('anthropic'), 'claude');
    assert.equal(skillBridgeForProvider('openai'), 'none');
    assert.equal(skillBridgeForProvider('xplain'), 'none');
    assert.equal(skillBridgeForProvider('mock'), 'none');
  });

  it('builds bridge paths per family', () => {
    assert.equal(bridgeSkillPath('excalidraw-diagram', 'cursor'), '.cursor/skills/excalidraw-diagram');
    assert.equal(bridgeSkillPath('excalidraw-diagram', 'claude'), '.claude/skills/excalidraw-diagram');
    assert.equal(bridgeSkillPath('excalidraw-diagram', 'none'), '.xplain/skills/excalidraw-diagram');
  });
});
