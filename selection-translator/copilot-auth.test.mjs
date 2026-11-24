import assert from 'node:assert/strict';
import test from 'node:test';
import { readCredential } from './copilot-auth.mjs';

test('reads only the selected GitHub login using the native credential store', async () => {
    const calls = [];
    const token = await readCredential({
        async authGetLastLoggedInUserForContext(context) {
            assert.ok(context.homeDirectory);
            assert.equal(context.environment, process.env);
            return JSON.stringify({ host: 'https://github.com', login: 'test-user' });
        },
        async authGetTokenForAuthInfo(raw) {
            calls.push(JSON.parse(raw));
            return 'test-oauth';
        },
    });
    assert.equal(token, 'test-oauth');
    assert.deepEqual(calls, [{ type: 'user', host: 'https://github.com', login: 'test-user' }]);
});

test('missing login or token fails rather than falling back to another account', async () => {
    for (const raw of [null, JSON.stringify({ host: 'https://github.com', login: 'test-user' })]) {
        await assert.rejects(readCredential({
            async authGetLastLoggedInUserForContext() { return raw; },
            async authGetTokenForAuthInfo() { return null; },
        }));
    }
});

test('does not read credentials for an unsupported GitHub host', async () => {
    await assert.rejects(readCredential({
        async authGetLastLoggedInUserForContext() {
            return JSON.stringify({ host: 'https://other.invalid', login: 'test-user' });
        },
        async authGetTokenForAuthInfo() { assert.fail('must not read this credential'); },
    }), /Only github.com/);
});
