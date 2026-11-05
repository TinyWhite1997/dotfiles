const assert = require('node:assert/strict');
const { test } = require('node:test');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// No fake Herdr responses: use a separate server and stop only that server.
test('real Herdr + Worktrunk preserve grouping from primary, linked and nested checkouts', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-native-'));
  const repo = path.join(dir, 'repo with spaces 日本語');
  const session = `switch-test-${process.pid}-${Date.now()}`;
  const preload = path.join(dir, 'session-herdr.cjs');
  const opener = path.resolve(__dirname, '../scripts/open.cjs');
  fs.mkdirSync(repo);
  fs.writeFileSync(preload, `
    const cp = require('node:child_process');
    const real = cp.spawnSync;
    cp.spawnSync = (bin, args, options) => bin === 'session-herdr'
      ? real('herdr', ['--session', ${JSON.stringify(session)}, ...args], options)
      : real(bin, args, options);
  `);
  const env = { ...process.env, HERDR_BIN_PATH: 'session-herdr',
    WORKTRUNK_WORKTREE_PATH: path.join(dir, 'checkouts', '{{ branch | sanitize }}'),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(preload)}` };
  function run(bin, args) {
    const r = cp.spawnSync(bin, args, { cwd: repo, env, encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.ifError(r.error);
    return r;
  }
  function checked(bin, args) {
    const r = run(bin, args);
    assert.equal(r.status, 0, `${bin} ${args.join(' ')}: ${r.stderr || r.stdout}`);
    return r;
  }
  function herdr(args) { return checked('herdr', ['--session', session, ...args]); }
  checked('git', ['init', '--quiet', '--initial-branch=main']);
  checked('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=NUL', 'commit', '--quiet', '--allow-empty', '-m', 'init']);
  const status = herdr(['status', 'server']).stdout;
  assert.match(status, /status: not running/);
  assert.ok(status.includes(path.join('sessions', session, 'herdr.sock')), 'test server must have its own socket');
  const server = cp.spawn('herdr', ['--session', session, 'server'], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', data => { log += data; });
  server.stderr.on('data', data => { log += data; });
  server.on('error', error => { log += error.message; });
  const exited = new Promise(resolve => server.once('exit', resolve));
  try {
    const deadline = Date.now() + 15000;
    while (run('herdr', ['--session', session, 'workspace', 'list']).status !== 0) {
      assert.ok(server.exitCode === null && Date.now() < deadline, `test server did not start: ${log}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const execute = ['--no-cd', '--execute', 'node', '--', opener, '{{ branch }}'];
    const opened = checked('git-wt', ['-C', repo, 'switch', '--create', 'feature', ...execute]);
    assert.doesNotMatch(opened.stderr, /without native worktree grouping/);
    const createdCount = JSON.parse(herdr(['workspace', 'list']).stdout).result.workspaces.length;
    const linked = path.join(dir, 'checkouts', 'feature');
    const nested = path.join(linked, 'nested 日本語');
    fs.mkdirSync(nested);
    checked('git-wt', ['-C', linked, 'switch', 'feature', ...execute]);
    checked('git-wt', ['-C', nested, 'switch', '^', ...execute]);
    const workspaces = JSON.parse(herdr(['workspace', 'list']).stdout).result.workspaces;
    assert.equal(workspaces.length, createdCount, `reopening must not create duplicate workspaces: ${JSON.stringify(workspaces)}`);
    const child = workspaces.find(ws => ws.worktree?.is_linked_worktree &&
      fs.realpathSync.native(ws.worktree.checkout_path) === fs.realpathSync.native(linked));
    const parent = workspaces.find(ws => ws.worktree && !ws.worktree.is_linked_worktree &&
      fs.realpathSync.native(ws.worktree.checkout_path) === fs.realpathSync.native(repo));
    assert.ok(parent && child, JSON.stringify(workspaces));
    assert.equal(child.worktree.repo_key, parent.worktree.repo_key, 'child must belong to the parent repository group');
    assert.equal(workspaces.filter(ws => ws.worktree?.repo_key === parent.worktree.repo_key).length, 2);
  } finally {
    if (server.exitCode === null) herdr(['server', 'stop']);
    await Promise.race([exited, new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`test server did not stop: ${session}`)), 10000).unref();
    })]);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(process.env.APPDATA, 'herdr', 'sessions', session), { recursive: true, force: true });
  }
});
