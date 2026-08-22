#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"

if ! command -v pi >/dev/null 2>&1; then
	echo "pi not on PATH; skip third-party packages"
	exit 0
fi

while IFS= read -r pkg || [ -n "$pkg" ]; do
	case "$pkg" in
	'' | \#*) continue ;;
	esac
	pi install "$pkg"
done <"$root/agent/packages"

"$root/sync-packages.sh"
