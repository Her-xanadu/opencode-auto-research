#!/usr/bin/env bash
set -euo pipefail

GLOBAL_COMMANDS="$HOME/.config/opencode/commands"
GLOBAL_SKILLS="$HOME/.config/opencode/skills"

rm -f "$GLOBAL_COMMANDS/experiment-init.md"
rm -f "$GLOBAL_COMMANDS/experiment-status.md"
rm -f "$GLOBAL_COMMANDS/research-context.md"
rm -f "$GLOBAL_COMMANDS/innovate-loop.md"
rm -rf "$GLOBAL_SKILLS/research-brain"

echo "Removed global OpenCode experiment commands and research-brain skill."
