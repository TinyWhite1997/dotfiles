import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Optional real-host integration without installing duplicate core services in dotfiles.
// DSH_INSTALL_ROOT points at the installed @deepseek-ai/dsh package directory.
const root = process.env.DSH_INSTALL_ROOT;
test('loads in real Cordis, pins search, respects caps and disposes with its fiber', { skip: !root }, async t => {
  const anchor = pathToFileURL(path.join(root, 'package.json')).href;
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@deepseek-ai/')) {
        return nextResolve(specifier, { ...context, parentURL: anchor });
      }
      return nextResolve(specifier, context);
    },
  });
  t.after(() => hook.deregister());
  const { Context } = await import('@deepseek-ai/cordis');
  const { WebRuntime } = await import('@deepseek-ai/dsh-web');
  const plugin = await import('../index.js');
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(WebRuntime, { searchProvider: 'github-copilot', fetchProvider: 'http' });
  let captured;
  // Capture the registration without removing the real seam or its disposer.
  const register = ctx.web.registerSearchProvider.bind(ctx.web);
  const fake = {
    web: { registerSearchProvider(provider) { captured = provider; return register(provider); } },
    get() { return { async readRecord(key) {
      assert.equal(key, 'llm-pi-ai/github-copilot');
      return { kind: 'grant', payload: { type: 'oauth', access: 'fake-token', expires: Date.now() + 300_000 } };
    } }; },
  };
  // Validate real schema defaults and the actual entrypoint, but avoid the real credential store.
  const config = plugin.Config({ piAuthFile: path.join(root, 'nonexistent-test-auth.json') });
  assert.equal(config.model, 'gpt-6-luna');
  assert.equal(config.timeoutMs, 55_000);
  assert.equal(config.effort, 'low');
  plugin.apply(fake, config);
  assert.equal(await ctx.web.searchReady('any-chat-route'), true);
  captured.transport = async () => Response.json({ status: 'completed', output: [
    { type: 'web_search_call', status: 'completed' },
    { type: 'message', content: [{ type: 'output_text', text: 'Grounded answer', annotations: [
      { type: 'url_citation', url: 'https://one.example/', title: 'One' },
      { type: 'url_citation', url: 'https://two.example/', title: 'Two' },
    ] }] },
  ] });
  ctx.web.registerSearchProvider({ id: 'other', available: () => true, search() { throw new Error('wrong provider'); } });
  const result = await ctx.web.search({ query: 'question', maxResults: 1 });
  assert.equal(result.content, 'Grounded answer');
  assert.equal(result.sources.length, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.sources[0].url, 'https://one.example/');
  assert.throws(() => plugin.apply(fake, config), { code: 'WEB_DUPLICATE_PROVIDER' });

  // A second context mounts the actual plugin fiber, proving schema + DI + cleanup.
  const scoped = new Context();
  t.after(() => scoped.fiber.dispose());
  await scoped.plugin(WebRuntime, { searchProvider: 'github-copilot' });
  const fiber = scoped.plugin(plugin, { piAuthFile: path.join(root, 'nonexistent-test-auth.json') });
  await fiber;
  // No credential service: missing pi auth makes ready false, without touching home.
  assert.equal(await scoped.web.searchReady(), false);
  await fiber.dispose();
  await assert.rejects(scoped.web.search({ query: 'question' }), { code: 'WEB_PROVIDER_CONFIGURED_MISSING' });
});
