const fs = require('node:fs');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

function herdr(args) {
  return spawnSync(process.env.HERDR_BIN_PATH || 'herdr', args, {
    encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
}

async function popup(dir) {
  let status = 2;
  let input, output, socket, child;
  try {
    const request = JSON.parse(fs.readFileSync(join(dir, 'request.json'), 'utf8'));
    socket = net.createConnection(request.socket);
    await once(socket, 'connect');
    // Closing the caller or interrupting it terminates only this invocation's fzf.
    socket.on('close', () => child?.kill());
    socket.on('error', () => child?.kill());
    if (!Array.isArray(request.args) || !request.args.every(arg => typeof arg === 'string')
        || typeof request.cwd !== 'string' || !request.env
        || !Object.values(request.env).every(value => typeof value === 'string')) {
      throw new Error('Invalid fzf popup request');
    }
    if (fs.existsSync(join(dir, 'input'))) input = fs.openSync(join(dir, 'input'), 'r');
    output = fs.openSync(join(dir, 'output'), 'w', 0o600);
    child = spawn('fzf', [...request.args, '--no-height', '--no-tmux'], {
      cwd: request.cwd,
      env: { ...request.env, FZF_HERDR_POPUP: '1' },
      stdio: [input ?? 'inherit', output, 'inherit'],
    });
    const [code] = await once(child, 'exit');
    status = code ?? 130;
  } catch (error) {
    console.error(error.message);
  } finally {
    if (input !== undefined) fs.closeSync(input);
    if (output !== undefined) fs.closeSync(output);
    if (socket && !socket.destroyed) socket.end(String(status));
  }
  return status; // Herdr closes the popup when its command exits.
}

async function main(args = process.argv.slice(2)) {
  if (process.env.FZF_HERDR_REQUEST) return popup(process.env.FZF_HERDR_REQUEST);
  const source = process.env.HERDR_PANE_ID || process.env.HERDR_ACTIVE_PANE_ID;
  if (process.env.HERDR_ENV !== '1' || !source || process.env.FZF_HERDR_POPUP === '1') {
    const child = spawnSync('fzf', args, { stdio: 'inherit' });
    if (child.error) throw child.error;
    return child.status ?? 130;
  }

  // Popup placement is session-modal, rejects --target-pane and returns no pane ID.
  // Do not open a window over another foreground pane from a background process.
  const origin = herdr(['pane', 'get', source]);
  if (origin.status !== 0 || !JSON.parse(origin.stdout).result.pane.focused) {
    throw new Error('Run the fzf popup from the focused pane');
  }
  const dir = fs.mkdtempSync(join(tmpdir(), 'fzf-herdr-'));
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\fzf-herdr-${randomUUID()}` : join(dir, 'socket');
  const server = net.createServer();
  server.maxConnections = 1;
  let client, timer, finish;
  let closing = false;
  const result = new Promise(resolve => { finish = resolve; });
  const interrupt = () => finish(130);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    // Private per-invocation files preserve NULs, multiline history and concurrent callers.
    if (!process.stdin.isTTY) fs.writeFileSync(join(dir, 'input'), fs.readFileSync(0), { mode: 0o600 });
    fs.writeFileSync(join(dir, 'request.json'), JSON.stringify({
      args, cwd: process.cwd(), env: process.env, socket: address,
    }), { mode: 0o600 });
    server.once('connection', socket => {
      if (closing) { socket.destroy(); return; }
      client = socket;
      clearTimeout(timer);
      // ponytail: 30-minute abandoned-picker limit; make it configurable if longer sessions matter.
      timer = setTimeout(() => finish(130), 30 * 60 * 1000);
      let status = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => {
        status += chunk;
        if (status.length > 3) { finish(2); socket.destroy(); }
      });
      socket.on('end', () => finish(/^\d{1,3}$/.test(status) && Number(status) <= 255 ? Number(status) : 130));
      socket.on('close', () => finish(130)); // Forced popup closure, no result.
      socket.on('error', () => finish(130));
    });
    server.listen(address);
    await once(server, 'listening');
    const opened = herdr([
      'plugin', 'pane', 'open', '--plugin', 'fzf.popup', '--entrypoint', 'picker',
      '--cwd', process.cwd(), '--focus',
      '--env', `FZF_HERDR_RUNNER=${__filename}`,
      '--env', `FZF_HERDR_REQUEST=${dir}`,
    ]);
    if (opened.error || opened.status !== 0) {
      throw new Error(opened.error?.message || opened.stderr || 'Could not open fzf.popup; run herdr/setup.ps1');
    }
    // A pipe disconnect reports closure without polling Herdr or confusing popup and pane IDs.
    timer = setTimeout(() => { console.error('fzf popup did not start'); finish(2); }, 10000);
    const status = await result;
    if (status === 0) process.stdout.write(fs.readFileSync(join(dir, 'output')));
    return status;
  } finally {
    closing = true;
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    client?.destroy();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

module.exports = { main };
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});
