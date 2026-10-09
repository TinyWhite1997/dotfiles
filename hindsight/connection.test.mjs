import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readConnection } from './tunnel-auth.mjs';

const config = name => ({ tunnelId: `${name}.asse`, url: `https://${name}-8888.asse.devtunnels.ms/mcp/shared/` });

test('connection precedence: explicit path > local override > live Work defaults; fail closed on bad overrides', async t => {
  const home = await mkdtemp(join(tmpdir(), 'hindsight-connection-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const defaults = join(home, 'work.json');
  const local = join(home, '.hindsight/client.json');
  const explicit = join(home, 'explicit.json');
  const write = (path, value) => writeFile(path, JSON.stringify(value));
  await write(defaults, config('default'));
  assert.deepEqual(await readConnection({ home, defaults }), config('default'));
  await assert.rejects(lstat(local), { code: 'ENOENT' });
  await write(defaults, config('updated'));
  assert.deepEqual(await readConnection({ home, defaults }), config('updated')); // No installation/copy.
  await mkdir(join(home, '.hindsight'));
  await write(local, config('local'));
  assert.deepEqual(await readConnection({ home, defaults }), config('local'));
  await write(explicit, config('explicit'));
  assert.deepEqual(await readConnection({ path: explicit, home, defaults }), config('explicit'));
  await assert.rejects(readConnection({ path: join(home, 'missing.json'), home, defaults }), { code: 'ENOENT' });
  await writeFile(local, '{broken');
  await assert.rejects(readConnection({ home, defaults }), SyntaxError);
  await write(local, { tunnelId: 'invalid.asse', url: 'https://evil.test/mcp/shared/' });
  await assert.rejects(readConnection({ home, defaults }), /HTTPS/);
});
