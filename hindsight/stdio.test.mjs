import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { bridge } from './stdio.mjs';
import { createTokenSource, createTunnelFetch, validateConfig } from './tunnel-auth.mjs';

const jwt = (exp, serial = 0) => `test.${Buffer.from(JSON.stringify({ exp, serial })).toString('base64url')}.signature`;
const endpoint = new URL('https://memory-8888.asse.devtunnels.ms/mcp/shared/');

test('only HTTPS single-bank URLs in the tunnel cluster are accepted', () => {
  assert.equal(validateConfig({ tunnelId: 'memory.asse', url: String(endpoint) }).href, endpoint.href);
  assert.equal(validateConfig({ tunnelId: 'friendly-name.asse', url: String(endpoint) }).href, endpoint.href);
  for (const url of [
    'http://memory-8888.asse.devtunnels.ms/mcp/shared/',
    'https://memory-8888.asse.devtunnels.ms.evil.test/mcp/shared/',
    'https://memory-8888.usw2.devtunnels.ms/mcp/shared/',
    'https://user:pass@memory-8888.asse.devtunnels.ms/mcp/shared/',
    `${endpoint}?redirect=evil`, `${endpoint}#fragment`,
  ]) assert.throws(() => validateConfig({ tunnelId: 'memory.asse', url }));
  assert.throws(() => validateConfig({ tunnelId: '--help', url: String(endpoint) }));
});

test('cache, single-flight refresh, actual exp, sleep/wake, and stale invalidation', async () => {
  let time = 1_000_000;
  let calls = 0;
  const tokens = createTokenSource('memory.asse', {
    now: () => time,
    issue: async () => jwt((time + 3_600_000) / 1000, ++calls),
  });
  const first = await Promise.all(Array.from({ length: 8 }, () => tokens.get()));
  assert.equal(calls, 1);
  assert.ok(first.every(token => token === first[0]));
  time += 3_400_000; // Within five minutes of expiry.
  const next = await Promise.all([tokens.get(), tokens.get()]);
  assert.equal(calls, 2);
  assert.notEqual(next[0], first[0]);
  tokens.invalidate(first[0]);
  assert.equal(await tokens.get(), next[0]);
  assert.equal(calls, 2);
  time += 86_400_000; // A sleeping laptop needs no refresh daemon.
  await tokens.get();
  assert.equal(calls, 3);
});

test('issuance failure is recoverable; malformed/expired tokens fail closed', async () => {
  let calls = 0;
  const tokens = createTokenSource('memory.asse', {
    now: () => 0,
    issue: async () => { if (++calls === 1) throw new Error('login required'); return jwt(3600); },
  });
  await assert.rejects(tokens.get(), /login required/);
  assert.equal(await tokens.get(), jwt(3600));
  for (const value of ['secret-not-jwt', jwt(100), jwt('3600'), undefined]) {
    const invalid = createTokenSource('memory.asse', { now: () => 0, issue: async () => value });
    await assert.rejects(invalid.get(), /invalid|expired/);
  }
});

test('refresh and retry once on 401/403; preserve MCP and application headers', async () => {
  for (const status of [401, 403]) {
    let issued = 0;
    const tokens = createTokenSource('memory.asse', { now: () => 0, issue: async () => jwt(3600, ++issued) });
    const requests = [];
    const request = createTunnelFetch(endpoint, tokens, {
      apiKey: 'test-app-key',
      fetchImpl: async (_, init) => {
        requests.push(init);
        return requests.length === 1 ? new Response('denied', { status }) : new Response('ok');
      },
    });
    assert.equal((await request(endpoint, { method: 'POST', body: 'same-body', headers: { 'Mcp-Session-Id': 'session' } })).status, 200);
    assert.equal(issued, 2);
    assert.notEqual(requests[0].headers.get('X-Tunnel-Authorization'), requests[1].headers.get('X-Tunnel-Authorization'));
    assert.equal(requests[1].headers.get('Mcp-Session-Id'), 'session');
    assert.equal(requests[1].headers.get('Authorization'), 'Bearer test-app-key');
    assert.equal(requests[1].body, 'same-body');
    assert.equal(requests[1].redirect, 'manual');
  }
});

test('no credential redirects, no ambiguous write retries, bounded auth retry', async () => {
  for (const status of [302, 403, 500, 'network']) {
    let calls = 0;
    const tokens = createTokenSource('memory.asse', { now: () => 0, issue: async () => jwt(3600) });
    const request = createTunnelFetch(endpoint, tokens, { fetchImpl: async () => {
      calls++;
      if (status === 'network') throw new Error('network');
      return new Response('', { status });
    } });
    if (status === 500) assert.equal((await request(endpoint)).status, 500);
    else await assert.rejects(request(endpoint));
    assert.equal(calls, status === 403 ? 2 : 1);
    await assert.rejects(request('https://evil.test/'), /another URL/);
  }
});

test('real SDK stdio/HTTP bridge preserves SSE, protocol version, and sessions through refresh', { timeout: 10_000 }, async t => {
  let issued = 0;
  let clock = 0;
  const tokens = createTokenSource('memory.asse', { now: () => clock, issue: async () => jwt((clock + 3600000) / 1000, ++issued) });
  const seen = [];
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') { res.writeHead(405).end(); return; }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    seen.push({ message, headers: req.headers });
    if (!('id' in message)) { res.writeHead(202).end(); return; }
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } }
      : { tools: [{ name: 'recall', inputSchema: { type: 'object' } }] };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 'same-session' });
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp/shared/`);
  const remote = new StreamableHTTPClientTransport(url, { fetch: createTunnelFetch(url, tokens) });
  const input = new PassThrough();
  const output = new PassThrough();
  const local = new StdioServerTransport(input, output);
  t.after(async () => { await remote.close(); await local.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await bridge(remote, local, () => {});
  async function rpc(message) {
    const data = once(output, 'data');
    input.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    return JSON.parse((await data)[0]);
  }
  const initialized = await rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(initialized.result.serverInfo.name, 'mock');
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  clock += 3_400_000;
  const tools = await rpc({ id: 2, method: 'tools/list', params: {} });
  assert.equal(tools.result.tools[0].name, 'recall');
  const list = seen.find(item => item.message.method === 'tools/list');
  assert.equal(list.headers['mcp-session-id'], 'same-session');
  assert.equal(list.headers['mcp-protocol-version'], '2025-03-26');
  assert.notEqual(list.headers['x-tunnel-authorization'], seen[0].headers['x-tunnel-authorization']);
  assert.equal(issued, 2);
});
