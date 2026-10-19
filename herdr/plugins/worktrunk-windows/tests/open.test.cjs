const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openWorktree } = require('../scripts/open.cjs');
const config = path.resolve(__dirname, '../../../../config/nushell/config.nu');
const missingGit = { error: { code: 'worktree_list_failed', message: 'program not found' } };
const reply = (status, data) => ({ status, [status ? 'stderr' : 'stdout']: JSON.stringify(data) });

function expectCommands(t, commands) {
  t.after(() => mock.restoreAll());
  mock.method(cp, 'spawnSync', (bin, args) => {
    assert.equal(bin, args[0] === 'worktree' && args[1] === 'list' ? 'git' : 'test-herdr');
    const [expected, result] = commands.shift();
    assert.deepEqual(args, expected);
    return result;
  });
  t.after(() => assert.equal(commands.length, 0));
}
const native = ['worktree', 'open', '--workspace', 'w-root', '--branch', 'feature', '--label', 'feature', '--focus'];
const gitList = ['worktree', 'list', '--porcelain', '-z'];
const listing = checkout => ({ status: 0, stdout: `worktree ${checkout}\0HEAD abc\0branch refs/heads/feature\0\0` });

test('native worktree API keeps its normal behavior', t => {
  expectCommands(t, [[native, reply(0, { result: 'native' })]]);
  assert.equal(openWorktree('feature', 'w-root', 'test-herdr'), '{"result":"native"}');
});
for (const existing of [false, true]) {
  test(`missing server Git ${existing ? 'reuses' : 'creates'} the resolved checkout`, t => {
    const checkout = path.join(os.tmpdir(), 'repo with spaces 日本語', 'feature');
    const paneCwd = process.platform === 'win32' ? `\\\\?\\${checkout.toUpperCase()}\\` : checkout + '/';
    expectCommands(t, [
      [native, reply(1, missingGit)],
      [gitList, listing(checkout)],
      [['api', 'snapshot'], reply(0, { result: { snapshot: { panes: existing
        ? [{ cwd: paneCwd, workspace_id: 'w-existing' }] : [{ cwd: os.homedir(), workspace_id: 'w-other' }] } } })],
      [existing ? ['workspace', 'focus', 'w-existing']
        : ['workspace', 'create', '--cwd', checkout, '--label', 'feature', '--focus'], reply(0, { result: 'fallback' })],
    ]);
    assert.equal(openWorktree('feature', 'w-root', 'test-herdr'), '{"result":"fallback"}');
  });
}
for (const failure of [
  { error: { code: 'untrusted_repository', message: 'program not found' } },
  { error: { code: 'worktree_list_failed', message: 'permission denied' } },
]) {
  test(`does not bypass ${failure.error.code}: ${failure.error.message}`, t => {
    expectCommands(t, [[native, reply(7, failure)]]);
    assert.throws(() => openWorktree('feature', 'w-root', 'test-herdr'), error => error.exitCode === 7);
  });
}
test('fallback API failure propagates', t => {
  expectCommands(t, [[native, reply(1, missingGit)], [gitList, listing(__dirname)], [['api', 'snapshot'], reply(9, { error: 'offline' })]]);
  assert.throws(() => openWorktree('feature', 'w-root', 'test-herdr'), error => error.exitCode === 9);
});
test('missing CLI is not treated as missing server Git', t => {
  expectCommands(t, [[native, { error: new Error('spawn failed') }]]);
  assert.throws(() => openWorktree('feature', 'w-root', 'test-herdr'), /spawn failed/);
});

for (const fallback of [false, true]) {
test(`Nushell + real Worktrunk: ${fallback ? 'missing server Git and native checkout paths' : 'native API'}, shortcuts and failure gating`, { timeout: 60000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-switch-'));
  const repo = path.join(dir, 'repo with spaces 日本語');
  const receipt = path.join(dir, 'calls.jsonl');
  const preload = path.join(dir, 'herdr-mock.cjs');
  fs.mkdirSync(repo);
  fs.writeFileSync(preload, `
    const cp = require('node:child_process');
    const real = cp.spawnSync;
    cp.spawnSync = (bin, args, options) => {
      if (bin !== 'test-herdr') return real(bin, args, options);
      require('node:fs').appendFileSync(process.env.TEST_RECEIPT, JSON.stringify(args) + '\\n');
      if (process.env.TEST_MISSING_GIT && args[0] === 'worktree') {
        return {status: 1, stderr: JSON.stringify({error:{code:'worktree_list_failed',message:'program not found'}})};
      }
      if (args[0] === 'api') return {status:0, stdout:JSON.stringify({result:{snapshot:{panes:[]}}})};
      return {status: 0, stdout: '{"result":"opened"}'};
    };
  `);
  const env = { ...process.env, HERDR_BIN_PATH: 'test-herdr', TEST_RECEIPT: receipt, TEST_MISSING_GIT: fallback ? '1' : '',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(preload)}` };
  function run(bin, args) {
    const result = cp.spawnSync(bin, args, { cwd: repo, env, encoding: 'utf8', timeout: 20000 });
    assert.ifError(result.error);
    return result;
  }
  function git(args) {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  function nu(command) {
    const result = run('nu', ['--config', config, '-i', '-c', `$env.WORKTRUNK_WORKTREE_PATH = ${quote(path.join(dir, 'checkouts', '{{ branch | sanitize }}'))}; ${command}`]);
    assert.doesNotMatch(result.stderr, /Error: nu::/, 'interactive startup must load the command without errors');
    return result;
  }
  const calls = () => fs.readFileSync(receipt, 'utf8').trim().split('\n').map(JSON.parse);
  try {
    git(['init', '--quiet', '--initial-branch=main']);
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=NUL', 'commit', '--quiet', '--allow-empty', '-m', 'init']);
    for (const [command, branch] of [
      ['herdr switch -c weikai/security-20261019', 'weikai/security-20261019'],
      ['herdr switch weikai/security-20261019', 'weikai/security-20261019'],
      ["herdr switch '^'", 'main'],
    ]) {
      const result = nu(command);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(calls().at(fallback ? -3 : -1), ['worktree', 'open', '--cwd', repo, '--branch', branch, '--label', branch, '--focus']);
      if (fallback) {
        const target = branch === 'main' ? repo : path.join(dir, 'checkouts', 'weikai-security-20261019');
        const args = calls().at(-1);
        assert.deepEqual(args.slice(0, 3), ['workspace', 'create', '--cwd']);
        assert.equal(path.resolve(args[3]), target, 'Herdr must receive a native checkout path, not an MSYS execute template');
        assert.deepEqual(args.slice(4), ['--label', branch, '--focus']);
      }
    }
    assert.equal(git(['branch', '--show-current']), 'main', '--no-cd must preserve the source checkout');
    for (const command of ['herdr switch __missing_branch__', 'herdr switch -c weikai/security-20261019']) {
      const result = nu(command);
      assert.notEqual(result.status, 0);
      assert.equal(calls().length, fallback ? 9 : 3, 'a failed switch must not call Herdr');
    }
    const checkout = path.join(dir, 'checkouts', 'weikai-security-20261019');
    assert.equal(fs.existsSync(path.join(checkout, '.git')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
}
