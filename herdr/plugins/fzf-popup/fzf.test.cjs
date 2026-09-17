const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const { join } = require('node:path');
const bridge = join(__dirname, 'fzf.cjs');
const env = {
  ...process.env, HERDR_ENV: '0', FZF_HERDR_REQUEST: '', FZF_HERDR_POPUP: '',
  FZF_DEFAULT_OPTS: '', FZF_DEFAULT_OPTS_FILE: '',
};
const input = Buffer.from('other\0print 日本語\nprint "a&b"\0space and quote\'s.txt\0');
const selected = Buffer.from('print 日本語\nprint "a&b"\0');
const args = ['--read0', '--print0', '--filter=日本語'];

for (const mode of ['ordinary', 'nested']) {
  test(`${mode} terminal uses normal fzf with raw I/O`, () => {
    const result = spawnSync(process.execPath, [bridge, ...args], {
      input, env: { ...env, ...(mode === 'nested' ? { HERDR_ENV: '1', HERDR_PANE_ID: 'test:origin', FZF_HERDR_POPUP: '1' } : {}) },
    });
    assert.equal(result.status, 0, result.stderr.toString());
    assert.deepEqual(result.stdout, selected);
  });
}

// Fake only Herdr: real parent, pipe, request files, popup worker and fzf.
const harness = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const realSpawnSync = cp.spawnSync;
const mode = process.env.TEST_MODE;
let dir;
cp.spawnSync = (command, args, options) => {
  if (command !== 'test-herdr') return realSpawnSync(command, args, options);
  if (args[0] === 'pane') {
    assert.deepEqual(args, ['pane', 'get', 'test:origin']);
    return { status: 0, stdout: JSON.stringify({ result: { pane: { focused: mode !== 'unfocused' } } }) };
  }
  assert.equal(args[2], 'open'); // Popups have no pane ID and cannot use pane.close.
  assert.equal(args.includes('--target-pane'), false);
  assert.equal(args[args.indexOf('--cwd') + 1], process.cwd());
  dir = args.find(arg => arg.startsWith('FZF_HERDR_REQUEST=')).slice('FZF_HERDR_REQUEST='.length);
  if (mode === 'open-error') return { status: 1, stderr: 'popup unavailable' };
  if (mode === 'closed' || mode === 'interrupt') {
    const request = JSON.parse(fs.readFileSync(require('node:path').join(dir, 'request.json')));
    const socket = require('node:net').createConnection(request.socket);
    socket.once('connect', () => mode === 'interrupt' ? process.emit('SIGINT') : socket.destroy());
    socket.on('error', () => {});
  } else {
    const child = cp.spawn(process.execPath, [process.env.TEST_BRIDGE], {
      env: { ...process.env, FZF_HERDR_REQUEST: dir }, stdio: 'ignore',
    });
    child.on('error', error => { throw error; });
  }
  return { status: 0, stdout: JSON.stringify({ result: { type: 'ok' } }) };
};
require(process.env.TEST_BRIDGE).main(JSON.parse(process.env.TEST_ARGS)).then(code => {
  assert.equal(fs.existsSync(dir), false);
  process.exitCode = code;
}).catch(error => {
  assert.ok(['open-error', 'unfocused'].includes(mode), error.stack);
  assert.match(error.message, /popup unavailable|focused pane/);
  if (dir) assert.equal(fs.existsSync(dir), false);
  process.exitCode = 2;
});
`;
function options(mode, fzfArgs = args) {
  return { ...env, HERDR_ENV: '1', HERDR_PANE_ID: 'test:origin', HERDR_BIN_PATH: 'test-herdr',
    TEST_MODE: mode, TEST_BRIDGE: bridge, TEST_ARGS: JSON.stringify(fzfArgs) };
}
for (const [mode, fzfArgs, code, output] of [
  ['selected', args, 0, selected],
  ['no-match', ['--filter=unmatchable-981b'], 1, Buffer.alloc(0)],
  ['fzf-error', ['--not-a-real-option'], 2, Buffer.alloc(0)],
  ['closed', args, 130, Buffer.alloc(0)],
  ['interrupt', args, 130, Buffer.alloc(0)],
  ['open-error', args, 2, Buffer.alloc(0)],
  ['unfocused', args, 2, Buffer.alloc(0)],
]) {
  test(`popup lifecycle: ${mode}`, () => {
    const result = spawnSync(process.execPath, ['-e', harness], {
      input, timeout: 15000, env: options(mode, fzfArgs),
    });
    assert.equal(result.status, code, result.stderr.toString());
    assert.deepEqual(result.stdout, output);
  });
}

test('concurrent callers keep selections separate', async () => {
  await Promise.all(['one', 'two'].map(label => new Promise((resolve, reject) => {
    const expected = Buffer.from(`日本語 ${label}\0`);
    const child = spawn(process.execPath, ['-e', harness], { env: options('selected') });
    const output = [], errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.on('exit', code => {
      try {
        assert.equal(code, 0, Buffer.concat(errors).toString());
        assert.deepEqual(Buffer.concat(output), expected);
        resolve();
      } catch (error) { reject(error); }
    });
    child.stdin.end(expected);
  })));
});
