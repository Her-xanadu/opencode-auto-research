#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GLOBAL_ROOT="$HOME/.config/opencode"
GLOBAL_COMMANDS="$GLOBAL_ROOT/commands"
GLOBAL_SKILLS="$GLOBAL_ROOT/skills"

mkdir -p "$GLOBAL_COMMANDS" "$GLOBAL_SKILLS"

cp "$ROOT/.opencode/global-commands/experiment-init.md" "$GLOBAL_COMMANDS/experiment-init.md"
cp "$ROOT/.opencode/global-commands/experiment-status.md" "$GLOBAL_COMMANDS/experiment-status.md"
cp "$ROOT/.opencode/global-commands/research-context.md" "$GLOBAL_COMMANDS/research-context.md"
cp "$ROOT/.opencode/global-commands/innovate-loop.md" "$GLOBAL_COMMANDS/innovate-loop.md"

rm -rf "$GLOBAL_SKILLS/research-brain"
cp -R "$ROOT/.opencode/skills/research-brain" "$GLOBAL_SKILLS/research-brain"

echo "Installed global OpenCode experiment commands to: $GLOBAL_COMMANDS"
echo "Installed global research-brain skill to: $GLOBAL_SKILLS/research-brain"
echo "You can now open plain 'opencode' anywhere and use:"
echo "  /experiment-init"
echo "  /experiment-status"
echo "  /research-context"
echo "  /innovate-loop"
