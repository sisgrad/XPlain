import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  bundledCliPath,
  describeRunEvent,
  mirrorSessionDiagrams,
  prepareSkillCopy,
  privateProjectDir,
  resolveCliPath,
  shellCommand,
  versionSatisfies,
} from '../src/agent/ClaudexorProvider';

const EXT_ROOT = path.resolve(__dirname, '../..');

import { distArchiveName, listManagedNodes, managedNodeRoot, DEFAULT_MANAGED_NODE_VERSION } from '../src/agent/nodeRuntime';

describe('nodeRuntime', () => {
  it('names official dist archives per platform', () => {
    assert.deepEqual(distArchiveName('24.21.0', 'linux', 'x64'), { file: 'node-v24.21.0-linux-x64.tar.gz', ext: 'tar.gz' });
    assert.deepEqual(distArchiveName('24.21.0', 'darwin', 'arm64'), { file: 'node-v24.21.0-darwin-arm64.tar.gz', ext: 'tar.gz' });
    assert.deepEqual(distArchiveName('24.21.0', 'win32', 'x64'), { file: 'node-v24.21.0-win-x64.zip', ext: 'zip' });
    assert.throws(() => distArchiveName('24.21.0', 'freebsd', 'x64'), /No official Node.js build/);
    assert.match(DEFAULT_MANAGED_NODE_VERSION, /^24\.\d+\.\d+$/);
  });

  it('lists managed runtimes newest first, ignoring incomplete dirs', () => {
    const gs = fs.mkdtempSync(path.join(os.tmpdir(), 'xplain-gs-'));
    try {
      assert.deepEqual(listManagedNodes(gs), []);
      const bin = process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node');
      for (const v of ['v24.15.0', 'v24.21.0']) {
        const b = path.join(managedNodeRoot(gs), v, bin);
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.writeFileSync(b, '');
      }
      fs.mkdirSync(path.join(managedNodeRoot(gs), 'v24.30.0'), { recursive: true }); // no binary
      assert.deepEqual(listManagedNodes(gs).map((m) => m.version), ['v24.21.0', 'v24.15.0']);
    } finally {
      fs.rmSync(gs, { recursive: true, force: true });
    }
  });
});

import { effortParameter, pickEffortValue } from '../src/agent/CursorSdkProvider';

describe('Cursor SDK effort mapping', () => {
  it('finds the effort/thinking parameter and matches levels loosely', () => {
    const model = {
      id: 'm',
      displayName: 'M',
      parameters: [
        { id: 'tools', values: [{ value: 'on' }] },
        { id: 'thinkingLevel', displayName: 'Thinking', values: [{ value: 'Low' }, { value: 'Medium' }, { value: 'High' }, { value: 'Max' }] },
      ],
    };
    const p = effortParameter(model)!;
    assert.equal(p.id, 'thinkingLevel');
    assert.deepEqual(p.values, ['Low', 'Medium', 'High', 'Max']);
    assert.equal(pickEffortValue(p.values, 'high'), 'High');
    assert.equal(pickEffortValue(p.values, 'xhigh'), 'High');
    assert.equal(pickEffortValue(p.values, 'ultra'), undefined);
    assert.equal(pickEffortValue(p.values, ''), undefined);
    assert.equal(effortParameter({ id: 'x', displayName: 'X' }), undefined);
    assert.equal(effortParameter(undefined), undefined);
  });
});

describe('ClaudexorProvider', () => {
  it('ships the claudexor CLI inside the extension', () => {
    const cli = bundledCliPath(EXT_ROOT);
    assert.ok(fs.existsSync(cli), `missing ${cli} — run npm install`);
    assert.equal(resolveCliPath({ extensionPath: EXT_ROOT }), cli);
    assert.throws(() => resolveCliPath({ extensionPath: EXT_ROOT, cliPath: '/nonexistent/claudexor.js' }), /not found/);
  });

  it('checks the Node.js minimum version', () => {
    assert.equal(versionSatisfies('v24.15.0'), true);
    assert.equal(versionSatisfies('v25.0.0'), true);
    assert.equal(versionSatisfies('v24.14.9'), false);
    assert.equal(versionSatisfies('v22.12.0'), false);
    assert.equal(versionSatisfies('garbage'), false);
  });

  it('summarizes NDJSON run events', () => {
    assert.equal(describeRunEvent({ frame: 'run.started', runId: 'r1' }), 'run r1 started');
    assert.equal(
      describeRunEvent({ type: 'harness.event', payload: { harness_id: 'claude', type: 'message', title: 'Reading the kernel' } }),
      '[claude] Reading the kernel',
    );
    assert.equal(
      describeRunEvent({ type: 'harness.event', payload: { harness_id: 'codex', type: 'tool_call', tool: { name: 'read', target: 'a.cu' } } }),
      '[codex] tool read — a.cu',
    );
    assert.equal(describeRunEvent({ type: 'harness.event', payload: { type: 'message', payload: { buffered: true } } }), undefined);
    assert.equal(describeRunEvent({ frame: 'run.terminal', status: 'succeeded' }), 'run finished: succeeded');
    assert.equal(describeRunEvent({ type: 'budget.observation' }), undefined);
  });

  it('renders a shell-safe command line', () => {
    const line = shellCommand({
      command: '/opt/my node/bin/node',
      args: ['/x/claudexor.js', 'ask', '--prompt-file', "it's.md"],
      env: {},
      cli: '/x/claudexor.js',
      node: { command: '/opt/my node/bin/node', env: { ELECTRON_RUN_AS_NODE: '1' }, version: 'v24.21.0' },
    });
    assert.equal(line, `ELECTRON_RUN_AS_NODE=1 '/opt/my node/bin/node' /x/claudexor.js ask --prompt-file 'it'\\''s.md'`);
  });

  it('copies the Excalidraw skill into a private project and mirrors session diagrams back', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xplain-cx-'));
    try {
      const project = path.join(tmp, 'project');
      const workspace = path.join(tmp, 'workspace');
      prepareSkillCopy(EXT_ROOT, project, 'excalidraw-diagram', 'claude');
      assert.ok(fs.existsSync(path.join(project, '.xplain/skills/excalidraw-diagram/SKILL.md')));
      assert.ok(fs.existsSync(path.join(project, '.claude/skills/excalidraw-diagram/SKILL.md')));
      assert.ok(!fs.existsSync(path.join(project, '.xplain/skills/excalidraw-diagram/references/.venv')), 'venv must not be copied');

      const diag = path.join(project, '.xplain/diagrams/sess1');
      fs.mkdirSync(diag, { recursive: true });
      fs.writeFileSync(path.join(diag, 'flow.png'), Buffer.from([1, 2, 3]));
      fs.writeFileSync(path.join(diag, 'flow.excalidraw'), '{}');
      assert.equal(mirrorSessionDiagrams(project, workspace, 'sess1'), 2);
      assert.ok(fs.existsSync(path.join(workspace, '.xplain/diagrams/sess1/flow.png')));
      assert.ok(!fs.existsSync(diag), 'private copy is removed after mirroring');
      assert.equal(mirrorSessionDiagrams(project, workspace, 'missing'), 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('derives a stable private project dir per workspace', () => {
    const a = privateProjectDir('/gs', '/home/u/proj');
    assert.equal(a, privateProjectDir('/gs', '/home/u/proj'));
    assert.notEqual(a, privateProjectDir('/gs', '/home/u/other'));
    assert.ok(a.startsWith(path.join('/gs', 'claudexor', 'projects')));
  });
});
