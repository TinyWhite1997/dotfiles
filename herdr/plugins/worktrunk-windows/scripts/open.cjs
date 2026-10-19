const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function checkoutKey(value) {
  if (!value) return '';
  try { value = fs.realpathSync.native(value); } catch { value = path.resolve(value); }
  value = value.replace(/\\/g, '/').replace(/^\/\/\?\//, '').replace(/\/$/, '');
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function openWorktree(branch, sourceWorkspace, herdrBin = process.env.HERDR_BIN_PATH || 'herdr') {
  if (!branch) throw new Error('Usage: open.cjs <branch> [source-workspace] [herdr-bin]');
  function run(args) {
    const result = cp.spawnSync(herdrBin, args, { encoding: 'utf8', windowsHide: true });
    if (result.error) throw result.error;
    return result;
  }
  function checked(result) {
    if (result.status !== 0) {
      const error = new Error(result.stderr || result.stdout || 'Herdr command failed');
      error.exitCode = result.status || 1;
      throw error;
    }
    return result.stdout;
  }

  const source = sourceWorkspace ? ['--workspace', sourceWorkspace] : ['--cwd', process.cwd()];
  const opened = run(['worktree', 'open', ...source, '--branch', branch, '--label', branch, '--focus']);
  if (opened.status === 0) return opened.stdout;
  let failure;
  try { failure = JSON.parse(opened.stderr).error; } catch {}
  // A long-running Windows server may not have Git on its inherited PATH.
  // Only bypass that discovery failure, never trust/permission/checkout errors.
  if (failure?.code !== 'worktree_list_failed' || failure.message !== 'program not found') {
    return checked(opened);
  }

  // Worktrunk's execute templates can contain /c/... MSYS paths on Windows.
  // Read Git's NUL-delimited native paths instead of passing that template on.
  const listed = cp.spawnSync('git', ['worktree', 'list', '--porcelain', '-z'], { encoding: 'utf8', windowsHide: true });
  if (listed.error) throw listed.error;
  const matches = checked(listed).split('\0\0').map(entry => entry.split('\0'))
    .filter(fields => fields.includes(`branch refs/heads/${branch}`));
  if (matches.length !== 1) throw new Error(`Expected one worktree for ${branch}, found ${matches.length}`);
  const checkout = matches[0].find(field => field.startsWith('worktree ')).slice('worktree '.length);
  const snapshot = JSON.parse(checked(run(['api', 'snapshot']))).result.snapshot;
  const key = checkoutKey(checkout);
  const existing = snapshot.panes.find(pane => checkoutKey(pane.cwd) === key);
  return checked(run(existing
    ? ['workspace', 'focus', existing.workspace_id]
    : ['workspace', 'create', '--cwd', checkout, '--label', branch, '--focus']));
}

module.exports = { openWorktree };
if (require.main === module) {
  try { process.stdout.write(openWorktree(...process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
}
