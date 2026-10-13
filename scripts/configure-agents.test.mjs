import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { mkdtemp, readFile, writeFile, mkdir, rm, lstat, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { clients, configureAgents } from './configure-agents.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const connection = { tunnelId: 'test-memory.asse', url: 'https://opaque-id-8888.asse.devtunnels.ms/mcp/shared/' };
const json = path => readFile(path, 'utf8').then(JSON.parse);
async function clientConfig(path, client) {
  if (!client.toml) return json(path);
  const config = parseToml(await readFile(path, 'utf8'));
  return { ...config, mcpServers: config.mcp_servers };
}
async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof content === 'string' ? content : path.endsWith('.toml') ? stringifyToml(content) : JSON.stringify(content));
}
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'dotfiles-profile-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

test('MCP injection does not create guidance or work configuration on a fresh personal home', async t => {
  const home = await fixture(t);
  await configureAgents({ profile: 'personal', home });
  for (const target of [...clients.map(c => c.file), '.cursor/mcp.json', '.hindsight/client.json', '.pi/agent/AGENTS.md', '.copilot/copilot-instructions.md']) {
    await assert.rejects(lstat(join(home, target)), { code: 'ENOENT' });
  }
});

test('new Work machine registers four clients without local connection file or copied defaults', async t => {
  const home = await fixture(t);
  const result = await configureAgents({ profile: 'work', home });
  assert.equal(result.changed.length, 4);
  assert.deepEqual(clients.map(c => c.name), ['Claude Code', 'Codex', 'Copilot', 'Pi']);
  await assert.rejects(lstat(join(home, '.cursor/mcp.json')), { code: 'ENOENT' });
  for (const client of clients) {
    const entry = (await clientConfig(join(home, client.file), client)).mcpServers.hindsight;
    assert.deepEqual(entry.args, [join(repo, 'hindsight/stdio.mjs')]);
  }
  await assert.rejects(lstat(join(home, '.hindsight/client.json')), { code: 'ENOENT' });
  assert.deepEqual((await configureAgents({ profile: 'work', home })).changed, []);
});

test('work configures all four clients, preserves unrelated data, backs up, and is idempotent', async t => {
  const home = await fixture(t);
  for (const client of clients) await put(join(home, client.file), {
    [client.toml ? 'mcp_servers' : 'mcpServers']: { existing: { command: 'existing-tool', args: ['keep'] } }, projects: { 'C:/repo': { trust: true } }, preference: 42,
  });
  const options = { profile: 'work', home, ...{ tunnelId: connection.tunnelId, url: connection.url } };
  const preflight = await configureAgents({ ...options, check: true });
  assert.equal(preflight.changed.length, 5);
  await assert.rejects(lstat(join(home, '.hindsight/client.json')), { code: 'ENOENT' });
  await configureAgents(options);
  assert.deepEqual(await json(join(home, '.hindsight/client.json')), connection);
  for (const client of clients) {
    const path = join(home, client.file);
    const config = await clientConfig(path, client);
    assert.equal(config.preference, 42);
    assert.equal(config.projects['C:/repo'].trust, true);
    assert.equal(config.mcpServers.existing.command, 'existing-tool');
    assert.equal(config.mcpServers.hindsight.command, process.execPath);
    assert.deepEqual(config.mcpServers.hindsight.args, [join(repo, 'hindsight/stdio.mjs')]);
    assert.equal((await clientConfig(`${path}.dotfiles-backup`, client)).mcpServers.hindsight, undefined);
  }
  assert.equal((await json(join(home, '.pi/agent/mcp.json'))).mcpServers.hindsight.timeout, 180);
  assert.equal((await json(join(home, '.copilot/mcp-config.json'))).mcpServers.hindsight.timeout, 180000);
  assert.deepEqual((await configureAgents({ profile: 'work', home })).changed, []);

  await configureAgents({ profile: 'personal', home });
  for (const client of clients) {
    const config = await clientConfig(join(home, client.file), client);
    assert.equal(config.mcpServers.hindsight, undefined);
    assert.equal(config.mcpServers.existing.command, 'existing-tool');
    assert.equal(config.preference, 42);
  }
  assert.deepEqual(await json(join(home, '.hindsight/client.json')), connection); // Don't delete data/config.
  assert.deepEqual((await configureAgents({ profile: 'personal', home })).changed, []);
  await configureAgents({ profile: 'work', home }); // Switching back reuses private local config.
  assert.ok((await json(join(home, '.claude.json'))).mcpServers.hindsight);
});

test('missing/invalid connection and malformed/conflicting client config fail before writes', async t => {
  for (const bad of ['missing', 'url', 'pair', 'json', 'shape', 'collision', 'toml', 'toml-shape', 'toml-collision']) {
    const home = await fixture(t);
    let options = { profile: 'work', home };
    if (bad === 'missing') options.repo = join(home, 'missing-checkout');
    else Object.assign(options, { tunnelId: connection.tunnelId, url: connection.url });
    if (bad === 'url') options.url = 'https://evil.test/mcp/shared/';
    if (bad === 'pair') delete options.url;
    if (bad === 'json') await put(join(home, '.pi/agent/mcp.json'), '{broken');
    if (bad === 'shape') await put(join(home, '.pi/agent/mcp.json'), { mcpServers: [] });
    if (bad === 'collision') await put(join(home, '.pi/agent/mcp.json'), { mcpServers: { hindsight: { command: 'unrelated' } } });
    if (bad === 'toml') await put(join(home, '.codex/config.toml'), '[broken');
    if (bad === 'toml-shape') await put(join(home, '.codex/config.toml'), 'mcp_servers = []');
    if (bad === 'toml-collision') await put(join(home, '.codex/config.toml'), { mcp_servers: { hindsight: { command: 'unrelated' } } });
    await assert.rejects(configureAgents(options));
    for (const target of ['.hindsight/client.json', '.pi/agent/AGENTS.md', '.claude.json']) {
      await assert.rejects(lstat(join(home, target)), { code: 'ENOENT' });
    }
  }
});

test('personal preserves another hindsight server and rejects accidental tunnel arguments', async t => {
  const home = await fixture(t);
  await put(join(home, '.claude.json'), { mcpServers: { hindsight: { url: 'https://other.example/mcp' } } });
  const result = await configureAgents({ profile: 'personal', home });
  assert.equal(result.messages.length, 1);
  assert.equal((await json(join(home, '.claude.json'))).mcpServers.hindsight.url, 'https://other.example/mcp');
  await assert.rejects(configureAgents({ profile: 'personal', home, tunnelId: connection.tunnelId, url: connection.url }));
});

test('migrate manual registration while retaining user env and tool controls', async t => {
  const home = await fixture(t);
  await put(join(home, '.hindsight/client.json'), connection);
  await put(join(home, '.pi/agent/mcp.json'), { mcpServers: { hindsight: {
    command: 'node', args: ['Q:/old-checkout/hindsight/stdio.mjs'], env: { HINDSIGHT_API_KEY: '${PRIVATE_KEY}' }, toolExposure: { 'delete_*': 'hidden' },
  } } });
  await configureAgents({ profile: 'work', home });
  const entry = (await json(join(home, '.pi/agent/mcp.json'))).mcpServers.hindsight;
  assert.equal(entry.env.HINDSIGHT_API_KEY, '${PRIVATE_KEY}');
  assert.equal(entry.toolExposure['delete_*'], 'hidden');
});

test('MCP injection leaves instruction symlinks alone and rejects symlinked JSON', async t => {
  const home = await fixture(t);
  const shared = join(home, 'shared.md');
  await put(shared, 'original shared guide');
  const guide = join(home, '.pi/agent/AGENTS.md');
  await mkdir(dirname(guide), { recursive: true });
  try { await symlink(shared, guide, 'file'); } catch (error) {
    if (error.code === 'EPERM') { t.skip('OS does not allow creating symlinks'); return; }
    throw error;
  }
  await configureAgents({ profile: 'personal', home });
  assert.equal(await readFile(shared, 'utf8'), 'original shared guide');
  assert.equal((await lstat(guide)).isSymbolicLink(), true);
  const sharedJson = join(home, 'shared.json');
  await put(sharedJson, { mcpServers: {} });
  await symlink(sharedJson, join(home, '.pi/agent/mcp.json'), 'file');
  await assert.rejects(configureAgents({ profile: 'work', home, tunnelId: connection.tunnelId, url: connection.url }), /Refusing/);
  assert.deepEqual(await json(sharedJson), { mcpServers: {} });
  const codex = join(home, '.codex/config.toml');
  const sharedToml = join(home, 'shared.toml');
  await put(sharedToml, 'model = "keep"\n');
  await mkdir(dirname(codex), { recursive: true });
  await symlink(sharedToml, codex, 'file');
  await assert.rejects(configureAgents({ profile: 'work', home }), /Refusing/);
  assert.equal(await readFile(sharedToml, 'utf8'), 'model = "keep"\n');
});

test('Codex migrates an old checkout while preserving env, tool controls and model settings', async t => {
  const home = await fixture(t);
  const path = join(home, '.codex/config.toml');
  await put(path, {
    model: 'keep-model', model_reasoning_effort: 'high',
    mcp_servers: { hindsight: {
      command: 'node', args: ['Q:/old checkout/hindsight/stdio.mjs'],
      env: { PRIVATE_KEY: '${PRIVATE_KEY}' }, enabled: false, disabled_tools: ['delete_bank'],
    } },
  });
  const options = { profile: 'work', home, repo: join(home, 'new checkout'), ...connection };
  await configureAgents(options);
  const config = parseToml(await readFile(path, 'utf8'));
  const entry = config.mcp_servers.hindsight;
  assert.equal(config.model, 'keep-model');
  assert.equal(config.model_reasoning_effort, 'high');
  assert.equal(entry.command, process.execPath);
  assert.deepEqual(entry.args, [join(options.repo, 'hindsight/stdio.mjs')]);
  assert.equal(entry.env.PRIVATE_KEY, '${PRIVATE_KEY}');
  assert.equal(entry.enabled, false);
  assert.deepEqual(entry.disabled_tools, ['delete_bank']);
  assert.equal(entry.startup_timeout_sec, 180);
  assert.equal(entry.tool_timeout_sec, 180);
  assert.deepEqual((await configureAgents(options)).changed, []);
});

test('both profiles remove only the managed legacy Cursor entry, and preserve unrelated Cursor servers', async t => {
  for (const profile of ['work', 'personal']) {
    const home = await fixture(t);
    const path = join(home, '.cursor/mcp.json');
    const config = { preference: 42, mcpServers: {
      existing: { command: 'keep' }, hindsight: { command: 'node', args: ['Q:/old/hindsight/stdio.mjs'] },
    } };
    await put(path, config);
    await configureAgents({ profile, home });
    assert.deepEqual(await json(path), { preference: 42, mcpServers: { existing: { command: 'keep' } } });
    assert.deepEqual(await json(`${path}.dotfiles-backup`), config);
    assert.deepEqual((await configureAgents({ profile, home })).changed, []);
    const unrelated = '{"mcpServers":{"hindsight":{"url":"https://other.example/mcp"}}}';
    await put(path, unrelated);
    await configureAgents({ profile, home });
    assert.equal(await readFile(path, 'utf8'), unrelated);
  }
});

test('Personal preserves unrelated Codex hindsight entries byte-for-byte', async t => {
  const home = await fixture(t);
  const path = join(home, '.codex/config.toml');
  const original = '# keep this comment\n[mcp_servers.hindsight]\nurl = "https://other.example/mcp"\n';
  await put(path, original);
  const result = await configureAgents({ profile: 'personal', home });
  assert.equal(result.messages.length, 1);
  assert.equal(await readFile(path, 'utf8'), original);
});

test('configuration CLI honors CODEX_HOME during preflight, Work and Personal', async t => {
  const home = await fixture(t);
  const codexHome = join(home, 'custom codex');
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome };
  const run = (...args) => execFileSync(process.execPath, [join(repo, 'scripts/configure-agents.mjs'), ...args], {
    env, encoding: 'utf8', timeout: 30_000,
  });
  run('--profile', 'work', '--check');
  await assert.rejects(lstat(codexHome), { code: 'ENOENT' });
  run('--profile', 'work');
  const path = join(codexHome, 'config.toml');
  assert.equal(parseToml(await readFile(path, 'utf8')).mcp_servers.hindsight.command, process.execPath);
  await assert.rejects(lstat(join(home, '.codex')), { code: 'ENOENT' });
  run('--profile', 'personal');
  assert.equal(parseToml(await readFile(path, 'utf8')).mcp_servers.hindsight, undefined);
});

test('real Codex CLI recognizes the generated MCP config', { skip: !process.env.DOTFILES_TEST_CODEX }, async t => {
  const home = await fixture(t);
  await configureAgents({ profile: 'work', home });
  const result = execFileSync(process.env.DOTFILES_TEST_CODEX, ['mcp', 'get', 'hindsight', '--json'], {
    cwd: home, env: { ...process.env, CODEX_HOME: join(home, '.codex') },
    encoding: 'utf8', timeout: 30_000,
  });
  const entry = JSON.parse(result);
  assert.equal(entry.transport.type, 'stdio');
  assert.equal(entry.transport.command, process.execPath);
  assert.deepEqual(entry.transport.args, [join(repo, 'hindsight/stdio.mjs')]);
  assert.equal(entry.startup_timeout_sec, 180);
  assert.equal(entry.tool_timeout_sec, 180);
});
