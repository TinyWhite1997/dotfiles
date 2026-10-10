// Offline integration probe: node pi/goal-x-fabric-smoke.mjs <pi-dir> <fabric-dir> <goal-x-dir>
// Real extensions and SDK, scripted model only; no credentials or network requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [sdkDir, fabricDir, goalDir] = process.argv.slice(2).map(p => path.resolve(p));
assert(sdkDir && fabricDir && goalDir, 'Pass installed Pi, Fabric, and Goal-X package directories');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-x-fabric-smoke-'));
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
const agentDir = path.join(root, 'agent');
const cwd = path.join(root, 'workspace');
fs.mkdirSync(agentDir);
fs.mkdirSync(cwd);
process.env.PI_OFFLINE = '1';
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_GOAL_GLOBAL_SETTINGS_FILE = path.join(agentDir, 'pi-goal-x-settings.json');
process.env.PI_GOAL_SETTINGS_FILE = path.join(cwd, '.pi', 'pi-goal-x-settings.json');
process.env.PI_GOAL_ROOT = path.join(cwd, '.pi', 'goals');
fs.writeFileSync(path.join(cwd, 'evidence.txt'), 'compatibility evidence\n');
const goalSettings = JSON.parse(fs.readFileSync(new URL('./agent/pi-goal-x-settings.json', import.meta.url), 'utf8'));
assert(Number.isSafeInteger(goalSettings.maxAutonomousRuns) && goalSettings.maxAutonomousRuns > 0);
assert.equal(goalSettings.autoSelectSingleGoal, false);
assert.equal(goalSettings.auditorProjectResources, false);
fs.writeFileSync(process.env.PI_GOAL_GLOBAL_SETTINGS_FILE, JSON.stringify({ ...goalSettings, maxAutonomousRuns: 4 }));
fs.writeFileSync(path.join(agentDir, 'fabric.json'), JSON.stringify({
  configVersion: 4, fullCodeMode: true,
  prewalk: { enabled: false }, mcp: { enabled: false }, mesh: { enabled: false },
}));
const sdkRequire = createRequire(path.join(sdkDir, 'package.json'));
const aiEntry = sdkRequire.resolve.paths('@earendil-works/pi-ai')
  .map(p => path.join(p, '@earendil-works/pi-ai/dist/index.js')).find(p => fs.existsSync(p));
assert(aiEntry, 'Cannot locate the SDK pi-ai dependency');
const { createAssistantMessageEventStream, getCurrentTools } = await import(pathToFileURL(aiEntry));
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import(pathToFileURL(path.join(sdkDir, 'dist/index.js')));
let mainCalls = 0;
let auditCalls = 0;
const errors = [];
const events = [];
const modelRuntime = await ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: path.join(agentDir, 'models.json') });
modelRuntime.registerProvider('smoke', {
  api: 'smoke', apiKey: 'not-a-real-key', baseUrl: 'https://invalid.invalid',
  models: [{ id: 'scripted', name: 'Scripted offline model', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 }],
  streamSimple(model, context) {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: [], stopReason: 'stop', timestamp: Date.now(),
        usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      try {
        const names = getCurrentTools(context.messages).map(t => t.name);
        const auditor = !names.includes('fabric_exec');
        let call;
        let text;
        if (auditor) {
          auditCalls++;
          assert.deepEqual([...names].sort(), ['bash', 'find', 'grep', 'ls', 'read']);
          if (auditCalls % 2 === 1) call = { name: 'read', arguments: { path: 'evidence.txt' } };
          else {
            assert(auditCalls === 2 || auditCalls === 4, 'Unexpected audit loop');
            assert(JSON.stringify(context.messages).includes('compatibility evidence'));
            // Reject the first claim to verify it cannot archive the goal early.
            const archiveDir = path.join(cwd, '.pi/goals/archived');
            assert(!fs.existsSync(archiveDir) || fs.readdirSync(archiveDir).length === 0);
            text = auditCalls === 2
              ? 'Scripted rejection: retry the completion claim.\n<disapproved/>'
              : 'Scripted verdict after reading the fixture.\n<approved/>';
          }
        } else {
          mainCalls++;
          assert.deepEqual(names, ['fabric_exec'], 'Full-code tool declarations leaked');
          if (mainCalls === 1) call = { name: 'fabric_exec', arguments: {
            code: 'const goal = await extensions.get_goal({}); const evidence = await pi.read("evidence.txt"); return {goal, evidence};',
          } };
          else if (mainCalls === 2) text = 'Fixture inspected. Deliberately end this run to test automatic continuation.';
          else if (mainCalls === 3 || mainCalls === 4) call = { name: 'fabric_exec', arguments: {
            code: 'return await extensions.update_goal({status: "complete", completion_summary: "Read evidence.txt and verified compatibility evidence."});',
          } };
          else throw new Error('Unexpected request after completion/failed continuation');
        }
        stream.push({ type: 'start', partial: message });
        if (call) {
          const toolCall = { type: 'toolCall', id: `smoke-${mainCalls}-${auditCalls}`, ...call };
          message.content.push(toolCall);
          message.stopReason = 'toolUse';
          stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
          stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
        } else {
          message.content.push({ type: 'text', text });
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: message });
          stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: message });
        }
        stream.push({ type: 'done', reason: message.stopReason, message });
      } catch (error) {
        errors.push(String(error));
        message.stopReason = 'error';
        message.errorMessage = String(error);
        stream.push({ type: 'error', reason: 'error', error: message });
      }
      stream.end();
    });
    return stream;
  },
});
let session;
const deadline = setTimeout(() => {
  console.error(JSON.stringify({ error: 'Probe deadline exceeded', mainCalls, auditCalls, errors, events, root }));
  process.exit(1);
}, 60000);
try {
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: [path.join(fabricDir, 'dist/index.js'), path.join(goalDir, 'extensions/goal.ts')],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  ({ session } = await createAgentSession({ cwd, agentDir, resourceLoader, settingsManager, modelRuntime,
    model: modelRuntime.getModel('smoke', 'scripted'), sessionManager: SessionManager.inMemory(cwd) }));
  await session.bindExtensions({ onError: error => errors.push(JSON.stringify(error)) });
  const registered = session.getAllTools().map(t => t.name);
  for (const name of ['create_goal', 'get_goal', 'update_goal', 'set_goal_tasks', 'update_goal_task',
    'goal_question', 'goal_questionnaire', 'propose_goal_draft']) assert(registered.includes(name), `Missing ${name}`);
  for (const name of ['goal_complete', 'goal_blocked', 'goal_wait']) assert(!registered.includes(name));
  const finished = new Promise(resolve => session.subscribe(event => {
    if (event.type === 'tool_execution_end') events.push({ tool: event.toolName, error: event.isError, result: event.result });
    if (event.type === 'agent_settled' && mainCalls >= 4) resolve();
  }));
  await session.prompt('/goal-direct Read evidence.txt and verify it contains compatibility evidence.');
  await finished;
  assert.deepEqual(errors, []);
  assert.equal(mainCalls, 4);
  assert.equal(auditCalls, 4);
  assert(!events.some(e => e.error), JSON.stringify(events));
  const archiveDir = path.join(cwd, '.pi/goals/archived');
  const archived = fs.readdirSync(archiveDir).filter(name => name.endsWith('.md'));
  assert.equal(archived.length, 1, 'Expected exactly one archived goal');
  const saved = JSON.parse(fs.readFileSync(path.join(archiveDir, archived[0]), 'utf8').split('\n\n# Goal Prompt\n')[0]);
  assert.equal(saved.status, 'complete');
  assert.equal(saved.objective, 'Read evidence.txt and verify it contains compatibility evidence.');
  console.log(JSON.stringify({ ok: true, mainCalls, auditCalls, checks: ['exclusive Fabric declarations', 'captured get_goal + native read', 'automatic continuation', 'isolated auditor + shared provider', 'audit rejection keeps goal open', 'captured completion + archival'] }));
} catch (error) {
  console.error(JSON.stringify({ mainCalls, auditCalls, errors, events, root }));
  throw error;
} finally {
  clearTimeout(deadline);
  if (session) {
    await session.abort();
    await session.extensionRunner.emit({ type: 'session_shutdown' });
    session.dispose();
  }
}
