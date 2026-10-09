import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { readConnection } from './tunnel-auth.mjs';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const memoryCheck = process.argv.includes('--memory');
let configPath = process.argv.slice(2).find(arg => arg !== '--memory');
let temporary;
if (memoryCheck) {
  const config = await readConnection({ path: configPath });
  const url = new URL(config.url);
  url.pathname = `/mcp/setup-check-${randomUUID()}/`;
  temporary = await mkdtemp(join(tmpdir(), 'hindsight-check-'));
  configPath = join(temporary, 'client.json');
  await writeFile(configPath, JSON.stringify({ ...config, url: String(url) }));
}
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./stdio.mjs', import.meta.url)), ...(configPath ? [configPath] : [])],
  stderr: 'inherit',
});
const client = new Client({ name: 'hindsight-smoke', version: '1' });
try {
  await client.connect(transport, { timeout: 90_000 });
  const { tools } = await client.listTools();
  for (const name of ['retain', 'recall', 'reflect']) assert.ok(tools.some(tool => tool.name === name), `Missing ${name}`);
  console.log(`Private tunnel → stdio MCP OK: ${tools.length} tools, including retain/recall/reflect.`);
  if (memoryCheck) {
    const marker = `Hindsight-check-${randomUUID()}`;
    const retained = await client.callTool({ name: 'sync_retain', arguments: {
      content: `The integration test's unique verification code is ${marker}.`,
      document_id: 'setup-verification',
    } }, undefined, { timeout: 180_000 });
    assert.ok(!retained.isError, JSON.stringify(retained));
    console.log('sync_retain OK (real configured LLM).');
    const recalled = await client.callTool({ name: 'recall', arguments: {
      query: 'What is the integration test verification code?', budget: 'low',
    } }, undefined, { timeout: 120_000 });
    assert.ok(!recalled.isError, JSON.stringify(recalled));
    assert.ok(JSON.stringify(recalled).includes(marker), 'Recall did not return the retained verification code');
    console.log('recall OK (local embeddings + reranker).');
  }
} finally {
  if (temporary) {
    try {
      const deleted = await client.callTool({ name: 'delete_bank', arguments: {} });
      assert.ok(!deleted.isError, 'Test bank cleanup failed');
      console.log('Isolated test bank deleted.');
    } catch {
      console.error(`Test bank cleanup failed; inspect config at ${configPath}.`);
      process.exitCode = 1;
    }
  }
  await client.close();
  if (temporary && !process.exitCode) await rm(temporary, { recursive: true });
}
