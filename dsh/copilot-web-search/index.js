import z from '@deepseek-ai/schemastery';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { WebError } from '@deepseek-ai/dsh-web';
import { CopilotSearchProvider, piAuthPath, resolveAuth } from './search.js';

export const name = 'web-search-copilot';
export const inject = ['web'];
export const Config = z.object({
  model: z.string().default('gpt-6-luna'),
  effort: z.union(['none', 'low', 'medium', 'high']).default('low'),
  timeoutMs: z.number().default(55_000),
  piAuthFile: z.string().default(piAuthPath()),
  allowedDomains: z.array(z.string()).default([]),
  blockedDomains: z.array(z.string()).default([]),
});

export function apply(ctx, config) {
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1) throw new Error('web-search-copilot: timeoutMs must be a positive integer');
  if (!config.model.trim()) throw new Error('web-search-copilot: model must not be blank');
  const auth = () => resolveAuth(async () => {
    const record = await ctx.get('credentials')?.readRecord(credentialKey('llm-pi-ai', 'github-copilot'));
    return record?.kind === 'grant' ? record.payload : undefined;
  }, config.piAuthFile);
  ctx.web.registerSearchProvider(new CopilotSearchProvider(() => config, auth, { ErrorType: WebError }));
}
