import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { validateConfig, readConnection } from '../hindsight/tunnel-auth.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
export const clients = [
  { name: 'Claude Code', file: '.claude.json', extra: { type: 'stdio' } },
  { name: 'Cursor', file: '.cursor/mcp.json', extra: {} },
  { name: 'Copilot', file: '.copilot/mcp-config.json', extra: { type: 'local', tools: ['*'], timeout: 180000 } },
  { name: 'Pi', file: '.pi/agent/mcp.json', extra: {
    type: 'stdio', exposure: 'deferred', timeout: 180,
    description: 'Shared work memory through a private Dev Tunnel. Recall and retain verified work findings only; never store credentials or personal-project content.',
  } },
];

async function snapshot(path) {
  let stat;
  try { stat = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  if (!stat.isFile()) {
    throw new Error(`Refusing to replace non-local/non-file configuration: ${path}`);
  }
  return await readFile(path, 'utf8');
}

function jsonObject(text, path) {
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error(`Invalid JSON; left unchanged: ${path}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected JSON object: ${path}`);
  return value;
}

function managed(entry) {
  // Includes the original manual registration and a previous checkout's absolute path.
  return entry && typeof entry.command === 'string' && /(^|[/\\])node(?:\.exe)?$/i.test(entry.command) &&
    Array.isArray(entry.args) && typeof entry.args[0] === 'string' && /[/\\]hindsight[/\\]stdio\.mjs$/i.test(entry.args[0]);
}

export async function configureAgents({ profile, home = homedir(), repo = repository, tunnelId, url, check = false }) {
  if (!['personal', 'work'].includes(profile)) throw new Error('Choose --profile work or personal.');
  if (!!tunnelId !== !!url) throw new Error('--tunnel-id and --url must be provided together.');
  if (profile === 'personal' && (tunnelId || url)) throw new Error('Personal profile must not configure a work tunnel.');
  const changes = [];
  const messages = [];
  async function plan(path, text) {
    const previous = await snapshot(path);
    if (previous !== text) changes.push({ path, previous, text });
  }

  const clientPath = join(home, '.hindsight', 'client.json');
  if (profile === 'work') {
    const previous = await snapshot(clientPath);
    const config = previous ? jsonObject(previous, clientPath) : tunnelId ? {} :
      await readConnection({ home, defaults: join(repo, 'hindsight', 'client.work.json') });
    if (tunnelId) Object.assign(config, { tunnelId, url });
    validateConfig(config);
    if (tunnelId) await plan(clientPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  const args = [join(resolve(repo), 'hindsight', 'stdio.mjs')];
  for (const client of clients) {
    const path = join(home, client.file);
    const previous = await snapshot(path);
    if (profile === 'personal' && previous === undefined) continue;
    const config = previous === undefined ? {} : jsonObject(previous, path);
    if ('mcpServers' in config && (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers))) {
      throw new Error(`Invalid mcpServers object; left unchanged: ${path}`);
    }
    config.mcpServers ??= {};
    const existing = config.mcpServers.hindsight;
    if (existing !== undefined && !managed(existing)) {
      if (profile === 'work') throw new Error(`Unrelated hindsight entry in ${path}; rename it before installing. No files changed.`);
      messages.push(`Preserved unrelated hindsight entry in ${path}; inspect it before personal use.`);
      continue;
    }
    if (profile === 'work') {
      config.mcpServers.hindsight = { ...existing, command: process.execPath, args, ...client.extra };
    } else {
      if (existing === undefined) continue;
      delete config.mcpServers.hindsight;
    }
    await plan(path, `${JSON.stringify(config, null, 2)}\n`);
  }

  // Validate every input before writing anything. Close clients while installing;
  // recheck snapshots to catch intervening edits instead of silently losing them.
  if (!check) for (const change of changes) {
    const { path, previous, text } = change;
    if (await snapshot(path) !== previous) throw new Error(`Configuration changed during install; rerun: ${path}`);
    await mkdir(dirname(path), { recursive: true });
    if (previous !== undefined) {
      try { await writeFile(`${path}.dotfiles-backup`, previous, { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  }
  return { profile, checked: check, changed: changes.map(change => change.path), messages };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      profile: { type: 'string' }, 'tunnel-id': { type: 'string' }, url: { type: 'string' }, check: { type: 'boolean' },
    } });
    const result = await configureAgents({ profile: values.profile, tunnelId: values['tunnel-id'], url: values.url, check: values.check });
    console.log(`${result.checked ? 'Preflight' : 'Configured'} ${result.profile}: ${result.changed.length} file(s).`);
    for (const path of result.changed) console.log(`  ${path}`);
    for (const message of result.messages) console.warn(message);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
