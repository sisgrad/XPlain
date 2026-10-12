import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../bundled-templates');

describe('bundled-templates', () => {
  it('ships at least one valid built-in template folder', () => {
    assert.ok(fs.existsSync(ROOT), `missing ${ROOT}`);
    const dirs = fs
      .readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name);
    assert.ok(dirs.length >= 1, 'expected bundled template directories');

    for (const id of dirs) {
      const metaPath = path.join(ROOT, id, 'template.json');
      assert.ok(fs.existsSync(metaPath), metaPath);
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
        id?: string;
        scope?: string;
        name?: string;
        instruction?: string;
        files?: Array<{ name: string }>;
      };
      assert.equal(meta.id, id, `${id}: id must match folder name`);
      assert.equal(meta.scope, 'builtin');
      assert.ok(meta.name?.trim(), `${id}: name required`);
      assert.ok(meta.instruction?.trim(), `${id}: instruction required`);
      for (const f of meta.files ?? []) {
        const fp = path.join(ROOT, id, 'files', f.name);
        assert.ok(fs.existsSync(fp), `${id}: missing file ${f.name}`);
      }
    }
  });
});
