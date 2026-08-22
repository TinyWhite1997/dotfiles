#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
settings="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/settings.json"
out="$root/agent/packages"

[ -f "$settings" ] || exit 0

node -e '
const fs = require("fs");
const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(settings.packages)) process.exit(0);
const lines = [
  "# Generated from Pi settings. Use pi install / pi remove, then commit.",
  ...settings.packages,
];
fs.writeFileSync(process.argv[2], `${lines.join("\n")}\n`);
' "$settings" "$out"
