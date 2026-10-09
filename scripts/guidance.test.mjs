import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, lstat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = fileURLToPath(new URL('../', import.meta.url));

test('real Dotbot links selected guidance, preserves originals, and reflects source edits without reinstall', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dotbot-guidance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const source = join(root, 'instructions');
  await mkdir(source);
  for (const profile of ['work', 'personal']) await writeFile(join(source, `${profile}.md`), `${profile} guide\n`);
  const targets = [join(home, '.pi/agent/AGENTS.md'), join(home, '.copilot/copilot-instructions.md')];
  for (const path of targets) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, 'original user instructions');
  }
  const mcp = join(home, '.pi/agent/mcp.json');
  await writeFile(mcp, '{"mcpServers":{"existing":{}}}');
  function install(profile) {
    return execFileSync(process.env.DOTFILES_TEST_PYTHON ?? 'python', [
      join(repo, 'dotbot/bin/dotbot'), '-d', root, '-c', join(repo, 'install.conf-agents.yaml'),
    ], {
      env: { ...process.env, HOME: home, USERPROFILE: home, DOTFILES_PROFILE: profile, PYTHONUTF8: '1' },
      encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  for (const profile of ['personal', 'work']) {
    install(profile);
    for (const path of targets) {
      assert.ok((await lstat(path)).isSymbolicLink());
      assert.equal(await realpath(path), await realpath(join(source, `${profile}.md`)));
    }
    const updated = `${profile} edited without running install\n`;
    await writeFile(join(source, `${profile}.md`), updated);
    for (const path of targets) assert.equal(await readFile(path, 'utf8'), updated);
    install(profile); // Existing symlinks do not create more backups.
  }
  for (const path of targets) {
    const backups = (await readdir(join(path, '..'))).filter(name => name.includes('.dotbot-backup.'));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(join(path, '..', backups[0]), 'utf8'), 'original user instructions');
  }
  assert.throws(() => install('missing'), /Command failed/);
  for (const path of targets) assert.equal(await realpath(path), await realpath(join(source, 'work.md')));
  assert.equal(await readFile(mcp, 'utf8'), '{"mcpServers":{"existing":{}}}');
});
