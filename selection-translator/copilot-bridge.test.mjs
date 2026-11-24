import assert from 'node:assert/strict';
import test from 'node:test';
import { translate } from './copilot-bridge.mjs';

test('isolated CLI session streams only translation and deletes its history', async () => {
    const events = [];
    let delta, deleted = false;
    const client = {
        async createSession(config) {
            assert.equal(config.model, 'gpt-6-luna');
            assert.equal(config.reasoningEffort, 'low');
            assert.deepEqual(config.availableTools, []);
            assert.equal(config.streaming, true);
            assert.equal(config.enableConfigDiscovery, false);
            assert.equal(config.enableSkills, false);
            assert.equal(config.enableFileHooks, false);
            assert.equal(config.enableHostGitOperations, false);
            assert.equal(config.enableSessionStore, false);
            assert.deepEqual(config.memory, { enabled: false });
            assert.equal(config.systemMessage.mode, 'replace');
            assert.match(config.systemMessage.content, /into Simplified Chinese/);
            assert.match(config.onPermissionRequest().kind, /^denied/);
            return {
                sessionId: 'translation-test',
                on(type, handler) {
                    assert.equal(type, 'assistant.message_delta');
                    delta = handler;
                },
                async sendAndWait({ prompt }) {
                    assert.equal(prompt, 'Hello\nworld');
                    delta({ data: { deltaContent: '你好\n' } });
                    assert.deepEqual(events, [{ type: 'delta', text: '你好\n' }]);
                    delta({ data: { deltaContent: '世界' } });
                    return { data: { content: '你好\n世界' } };
                },
            };
        },
        async deleteSession(id) {
            assert.equal(id, 'translation-test');
            deleted = true;
        },
    };
    await translate(client, { model: 'gpt-6-luna', text: 'Hello\nworld' }, event => events.push(event));
    assert.equal(deleted, true);
    assert.deepEqual(events.map(event => event.text), ['你好\n', '世界']);
});

test('non-streamed final message is emitted once', async () => {
    const events = [];
    const client = {
        async createSession() {
            return { sessionId: 'test', on() {}, async sendAndWait() { return { data: { content: '你好' } }; } };
        },
        async deleteSession() {},
    };
    await translate(client, { model: 'gpt-6-luna', text: 'Hello' }, event => events.push(event));
    assert.deepEqual(events, [{ type: 'delta', text: '你好' }]);
});

test('failed or empty translation fails visibly and still deletes its session', async () => {
    for (const fail of [false, true]) {
        let deleted = false;
        const client = {
            async createSession() {
                return {
                    sessionId: 'test', on() {},
                    async sendAndWait() {
                        if (fail) throw new Error('test failure');
                        return { data: { content: '' } };
                    },
                };
            },
            async deleteSession() { deleted = true; },
        };
        await assert.rejects(translate(client, { model: 'gpt-6-luna', text: 'Hello' }, () => {}));
        assert.equal(deleted, true);
    }
});
