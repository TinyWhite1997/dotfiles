const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi package sync '));
try {
  const script = path.join(root, 'sync-packages.cjs');
  const agentDir = path.join(root, '.pi', 'agent');
  const settings = path.join(agentDir, 'settings.json');
  const output = path.join(root, 'agent', 'packages');
  fs.copyFileSync(path.join(__dirname, 'sync-packages.cjs'), script);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(path.dirname(output));
  fs.writeFileSync(output, 'unchanged\n');

  const run = (override = agentDir) => spawnSync(process.execPath, [script], {
    cwd: os.tmpdir(),
    env: { ...process.env, PI_CODING_AGENT_DIR: override, HOME: root, USERPROFILE: root },
    encoding: 'utf8',
  });
  const read = () => fs.readFileSync(output, 'utf8');
  const header = '# Generated from Pi settings. Use pi install / pi remove, then commit.\n';

  assert.equal(run().status, 0);
  assert.equal(read(), 'unchanged\n');
  for (const packages of [undefined, 'not an array']) {
    fs.writeFileSync(settings, JSON.stringify({ packages }));
    assert.equal(run().status, 0);
    assert.equal(read(), 'unchanged\n');
  }
  fs.writeFileSync(settings, JSON.stringify({ packages: ['npm:example', '/含空格/package path'] }));
  assert.equal(run().status, 0);
  assert.equal(read(), `${header}npm:example\n/含空格/package path\n`);

  fs.writeFileSync(settings, JSON.stringify({ packages: [] }));
  assert.equal(run('').status, 0); // Default home directory, no override.
  assert.equal(read(), header);

  fs.writeFileSync(settings, '{invalid');
  assert.notEqual(run().status, 0);
  assert.equal(read(), header); // Parsing errors must not overwrite the list.
  console.log('Package sync checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
