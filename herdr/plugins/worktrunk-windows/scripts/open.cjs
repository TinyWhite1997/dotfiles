const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function checkoutKey(value) {
  if (!value) return '';
  try { value = fs.realpathSync.native(value); } catch { value = path.resolve(value); }
  value = value.replace(/\\/g, '/').replace(/^\/\/\?\//, '').replace(/\/$/, '');
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function openWorktree(branch, herdrBin = process.env.HERDR_BIN_PATH || 'herdr') {
  if (!branch) throw new Error('Usage: open.cjs <branch> [herdr-bin]');
  function run(args) {
    const result = cp.spawnSync(herdrBin, args, { encoding: 'utf8', windowsHide: true });
    if (result.error) throw result.error;
    return result;
  }
  function checked(result) {
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const error = new Error(result.stderr || result.stdout || 'Command failed');
      error.exitCode = result.status || 1;
      throw error;
    }
    return result.stdout;
  }

  // Worktrunk executes this in the target checkout, even with --no-cd.
  // Git lists the primary checkout first; Herdr requires that as its source.
  // NUL-delimited Git paths also avoid MSYS execute-template paths on Windows.
  const installedGit = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe');
  const gitBin = process.platform === 'win32' && fs.existsSync(installedGit) ? installedGit : 'git';
  const listed = cp.spawnSync(gitBin, ['worktree', 'list', '--porcelain', '-z'], { encoding: 'utf8', windowsHide: true });
  const entries = checked(listed).split('\0\0').filter(Boolean).map(entry => entry.split('\0'));
  const checkoutPath = fields => fields.find(field => field.startsWith('worktree '))?.slice('worktree '.length);
  const root = checkoutPath(entries[0] || []);
  const matches = entries.filter(fields => fields.includes(`branch refs/heads/${branch}`));
  if (matches.length !== 1) throw new Error(`Expected one worktree for ${branch}, found ${matches.length}`);
  const checkout = checkoutPath(matches[0]);
  if (!root || !checkout) throw new Error('Git worktree listing is missing a checkout path');

  const opened = run(['worktree', 'open', '--cwd', root, '--branch', branch, '--label', branch, '--focus']);
  if (opened.status === 0) return opened.stdout;
  let failure;
  try { failure = JSON.parse(opened.stderr).error; } catch {}
  // Only bypass missing server Git, never trust/permission/checkout errors.
  if (failure?.code !== 'worktree_list_failed' || failure.message !== 'program not found') {
    return checked(opened);
  }

  const snapshot = JSON.parse(checked(run(['api', 'snapshot']))).result.snapshot;
  const key = checkoutKey(checkout);
  const existing = snapshot.panes.find(pane => checkoutKey(pane.cwd) === key);
  console.warn('Warning: Herdr server cannot find Git; using a regular workspace without native worktree grouping. Restart the server with Git on PATH when safe.');
  return checked(run(existing
    ? ['workspace', 'focus', existing.workspace_id]
    : ['workspace', 'create', '--cwd', checkout, '--label', branch, '--focus']));
}

module.exports = { openWorktree };
if (require.main === module) {
  try { process.stdout.write(openWorktree(...process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
}
