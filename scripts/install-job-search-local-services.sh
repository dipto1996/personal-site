#!/bin/zsh
set -euo pipefail

ROOT="/Users/roydi/Desktop/personal_site"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/.diptopal-job-search/logs"
DOMAIN="gui/$(id -u)"

mkdir -p "$AGENTS" "$LOGS"
/usr/local/bin/node "$ROOT/scripts/install-job-search-runtime.mjs"

for name in llama worker collector; do
  label="com.diptopal.jobsearch.$name"
  source="$ROOT/infra/launchd/$label.plist"
  target="$AGENTS/$label.plist"
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  install -m 0644 "$source" "$target"
  plutil -lint "$target"
  launchctl bootstrap "$DOMAIN" "$target"
done

launchctl kickstart -k "$DOMAIN/com.diptopal.jobsearch.llama"
launchctl kickstart -k "$DOMAIN/com.diptopal.jobsearch.worker"
