const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openWorktree } = require('../scripts/open.cjs');
const config = path.resolve(__dirname, '../../../../config/nushell/config.nu');
const runner = path.resolve(__dirname, '../scripts/runner.ps1');
const missingGit = { error: { code: 'worktree_list_failed', message: 'program not found' } };
const reply = (status, data) => ({ status, [status ? 'stderr' : 'stdout']: JSON.stringify(data) });
const root = path.join(os.tmpdir(), 'repo with spaces 日本語');
const checkout = path.join(root, '..', 'feature checkout 日本語');
const installedGit = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe');
const gitBin = process.platform === 'win32' && fs.existsSync(installedGit) ? installedGit : 'git';
const gitList = ['worktree', 'list', '--porcelain', '-z'];
const native = ['worktree', 'open', '--cwd', root, '--branch', 'feature', '--label', 'feature', '--focus'];
const listing = target => ({ status: 0, stdout:
  `worktree ${root}\0HEAD abc\0branch refs/heads/main\0\0worktree ${target}\0HEAD abc\0branch refs/heads/feature\0\0` });

function expectCommands(t, commands) {
  t.after(() => mock.restoreAll());
  mock.method(cp, 'spawnSync', (bin, args) => {
    assert.equal(bin, args[0] === 'worktree' && args[1] === 'list' ? gitBin : 'test-herdr');
    assert.ok(commands.length, `Unexpected command: ${args.join(' ')}`);
    const [expected, result] = commands.shift();
    assert.deepEqual(args, expected);
    return result;
  });
  const warnings = [];
  mock.method(console, 'warn', message => warnings.push(message));
  t.after(() => assert.equal(commands.length, 0));
  return warnings;
}

test('native API always uses the primary checkout, not the target/caller workspace', t => {
  const warnings = expectCommands(t, [[gitList, listing(checkout)], [native, reply(0, { result: 'native' })]]);
  assert.equal(openWorktree('feature', 'test-herdr'), '{"result":"native"}');
  assert.deepEqual(warnings, []);
});
test('opening the main branch also uses the primary checkout', t => {
  const args = ['worktree', 'open', '--cwd', root, '--branch', 'main', '--label', 'main', '--focus'];
  expectCommands(t, [[gitList, listing(checkout)], [args, reply(0, { result: 'main' })]]);
  assert.equal(openWorktree('main', 'test-herdr'), '{"result":"main"}');
});
for (const existing of [false, true]) {
  test(`missing server Git ${existing ? 'reuses' : 'creates'} the resolved checkout and warns`, t => {
    const paneCwd = process.platform === 'win32' ? `\\\\?\\${checkout.toUpperCase()}\\` : checkout + '/';
    const warnings = expectCommands(t, [
      [gitList, listing(checkout)],
      [native, reply(1, missingGit)],
      [['api', 'snapshot'], reply(0, { result: { snapshot: { panes: existing
        ? [{ cwd: paneCwd, workspace_id: 'w-existing' }] : [{ cwd: os.homedir(), workspace_id: 'w-other' }] } } })],
      [existing ? ['workspace', 'focus', 'w-existing']
        : ['workspace', 'create', '--cwd', checkout, '--label', 'feature', '--focus'], reply(0, { result: 'fallback' })],
    ]);
    assert.equal(openWorktree('feature', 'test-herdr'), '{"result":"fallback"}');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /without native worktree grouping/);
  });
}
for (const failure of [
  { error: { code: 'untrusted_repository', message: 'program not found' } },
  { error: { code: 'worktree_list_failed', message: 'permission denied' } },
  { error: { code: 'linked_worktree_source', message: 'Unexpected parent rejection' } },
]) {
  test(`does not bypass ${failure.error.code}: ${failure.error.message}`, t => {
    expectCommands(t, [[gitList, listing(checkout)], [native, reply(7, failure)]]);
    assert.throws(() => openWorktree('feature', 'test-herdr'), error => error.exitCode === 7);
  });
}
test('fallback API failure propagates', t => {
  expectCommands(t, [[gitList, listing(checkout)], [native, reply(1, missingGit)], [['api', 'snapshot'], reply(9, { error: 'offline' })]]);
  assert.throws(() => openWorktree('feature', 'test-herdr'), error => error.exitCode === 9);
});
test('missing CLI is not treated as missing server Git', t => {
  expectCommands(t, [[gitList, listing(checkout)], [native, { error: new Error('spawn failed') }]]);
  assert.throws(() => openWorktree('feature', 'test-herdr'), /spawn failed/);
});
for (const result of [{ error: new Error('Git spawn failed') }, { status: 8, stderr: 'Git permission denied' }]) {
  test(`local Git failure stops before Herdr: ${result.error?.message || result.stderr}`, t => {
    expectCommands(t, [[gitList, result]]);
    assert.throws(() => openWorktree('feature', 'test-herdr'), /Git /);
  });
}
test('a missing target checkout cannot open or create a workspace', t => {
  expectCommands(t, [[gitList, listing(checkout)]]);
  assert.throws(() => openWorktree('missing', 'test-herdr'), /Expected one worktree for missing, found 0/);
});

test('Windows pane without Git on PATH still discovers the primary checkout', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-no-git-path-'));
  const preload = path.join(dir, 'herdr-mock.cjs');
  try {
    for (const args of [
      ['init', '--quiet', '--initial-branch=main'],
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=NUL', 'commit', '--quiet', '--allow-empty', '-m', 'init'],
    ]) {
      const result = cp.spawnSync(installedGit, args, { cwd: dir, encoding: 'utf8' });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
    }
    fs.writeFileSync(preload, `
      const cp = require('node:child_process');
      const real = cp.spawnSync;
      cp.spawnSync = (bin, args, options) => {
        if (bin !== 'test-herdr') return real(bin, args, options);
        require('node:assert/strict').equal(require('node:path').resolve(args[3]), ${JSON.stringify(dir)});
        return {status:0, stdout:'{"result":"native"}'};
      };
    `);
    const result = cp.spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/open.cjs'), 'main', 'test-herdr'], {
      cwd: dir, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: path.dirname(process.execPath),
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(preload)}` },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '{"result":"native"}');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const fallback of [false, true]) {
  test(`real Nushell + Worktrunk + popup: ${fallback ? 'missing server Git' : 'native API'} from main, linked and nested directories`, { timeout: 90000 }, () => {
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
        if (args[0] === 'worktree' && (args[2] !== '--cwd' ||
            require('node:path').resolve(args[3]) !== require('node:path').resolve(process.env.TEST_ROOT))) {
          return {status:1, stderr:JSON.stringify({error:{code:'linked_worktree_source',message:'New and open worktree actions start from the repo parent workspace.'}})};
        }
        if (process.env.TEST_MISSING_GIT && args[0] === 'worktree') {
          return {status:1, stderr:JSON.stringify({error:{code:'worktree_list_failed',message:'program not found'}})};
        }
        if (args[0] === 'api') return {status:0, stdout:JSON.stringify({result:{snapshot:{panes:[]}}})};
        return {status:0, stdout:'{"result":"opened"}'};
      };
    `);
    const env = { ...process.env, HERDR_BIN_PATH: 'test-herdr', TEST_RECEIPT: receipt, TEST_MISSING_GIT: fallback ? '1' : '',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(preload)}`, TEST_ROOT: repo,
      WORKTRUNK_WORKTREE_PATH: path.join(dir, 'checkouts', '{{ branch | sanitize }}') };
    let cwd = repo;
    function run(bin, args) {
      const result = cp.spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout: 20000 });
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
    function assertOpened(result, branch) {
      assert.equal(result.status, 0, result.stderr);
      const args = calls().filter(args => args[0] === 'worktree').at(-1);
      assert.deepEqual(args.slice(0, 3), ['worktree', 'open', '--cwd']);
      assert.equal(path.resolve(args[3]), repo, 'Herdr must always start from the primary checkout');
      assert.deepEqual(args.slice(4), ['--branch', branch, '--label', branch, '--focus']);
      const target = branch === 'main' ? repo : path.join(dir, 'checkouts', branch.replaceAll('/', '-'));
      assert.equal(fs.existsSync(path.join(target, '.git')), true, 'all test checkouts must stay in the temporary directory');
      if (fallback) {
        assert.match(result.stderr, /without native worktree grouping/);
        const created = calls().at(-1);
        assert.deepEqual(created.slice(0, 3), ['workspace', 'create', '--cwd']);
        assert.equal(path.resolve(created[3]), target, 'Herdr must receive a native checkout path, not an MSYS execute template');
        assert.deepEqual(created.slice(4), ['--label', branch, '--focus']);
      }
    }
    try {
      git(['init', '--quiet', '--initial-branch=main']);
      git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=NUL', 'commit', '--quiet', '--allow-empty', '-m', 'init']);
      for (const [command, branch] of [
        ['herdr switch -c weikai/security-20261019', 'weikai/security-20261019'],
        ['herdr switch weikai/security-20261019', 'weikai/security-20261019'],
        ["herdr switch '^'", 'main'],
      ]) assertOpened(nu(command), branch);
      assert.equal(git(['branch', '--show-current']), 'main', '--no-cd must preserve the source checkout');
      const linked = path.join(dir, 'checkouts', 'weikai-security-20261019');
      const nested = path.join(linked, 'nested 日本語');
      fs.mkdirSync(nested);
      for (const source of [linked, nested]) {
        cwd = source;
        assertOpened(nu('herdr switch weikai/security-20261019'), 'weikai/security-20261019');
        assertOpened(nu("herdr switch '^'"), 'main');
        assert.equal(git(['branch', '--show-current']), 'weikai/security-20261019');
      }
      assertOpened(nu('herdr switch -c weikai/from-child'), 'weikai/from-child');

      // Exercise the real popup runner from outside the repository, including
      // current-branch creation. Only the fzf choice and Herdr transport are mocked.
      cwd = dir;
      for (const [branch, base] of [['weikai/security-20261019', 'default'], ['weikai/popup-child', 'current']]) {
        const script = `. ${quote(runner)}; function Select-Branch { return ${quote(branch)} }; $status = Invoke-Switch (Get-WorktrunkCommand) 'test-herdr' ${quote(nested)} ${quote(base)}; exit $status`;
        assertOpened(run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]), branch);
      }
      cwd = nested;
      const beforeFailures = calls().length;
      for (const command of ['herdr switch __missing_branch__', 'herdr switch -c weikai/security-20261019']) {
        const result = nu(command);
        assert.notEqual(result.status, 0);
        assert.equal(calls().length, beforeFailures, 'a failed switch must not call Herdr');
      }
      assert.equal(fs.existsSync(path.join(linked, '.git')), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
