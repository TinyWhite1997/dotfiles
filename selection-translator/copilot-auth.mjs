import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

export async function readCredential(runtime) {
    const raw = await runtime.authGetLastLoggedInUserForContext({
        homeDirectory: homedir(),
        environment: process.env,
    });
    if (!raw) throw new Error('Sign in to Copilot CLI first.');
    const user = JSON.parse(raw);
    if (user.host !== 'https://github.com') throw new Error('Only github.com login is supported.');
    const token = await runtime.authGetTokenForAuthInfo(JSON.stringify({
        type: 'user', host: user.host, login: user.login,
    }));
    if (!token) throw new Error('Copilot CLI login is unavailable.');
    return token;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const runtime = createRequire(import.meta.url)(process.argv[2]);
        // stdout is a private pipe to the desktop process; never log this value.
        process.stdout.write(await readCredential(runtime));
    } catch {
        process.stderr.write('Unable to read the existing Copilot CLI login.\n');
        process.exitCode = 1;
    }
}
