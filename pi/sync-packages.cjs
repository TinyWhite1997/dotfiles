const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
const settingsPath = path.join(agentDir, 'settings.json');
if (!fs.existsSync(settingsPath) || !fs.statSync(settingsPath).isFile()) process.exit(0);

const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
if (!Array.isArray(settings.packages)) process.exit(0);

const lines = [
  '# Generated from Pi settings. Use pi install / pi remove, then commit.',
  ...settings.packages,
];
fs.writeFileSync(path.join(__dirname, 'agent', 'packages'), `${lines.join('\n')}\n`);
