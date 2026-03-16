---
description: Start or continue the canonical opencode-auto-experiment loop.
---
# /innovate-loop

Operate on the fixed workspace:

- Workspace: `/Users/herxanadu/Desktop/opencode-auto-experiment`

Execution order:

1. Read `/Users/herxanadu/Desktop/opencode-auto-experiment/AGENTS.md` and `/Users/herxanadu/Desktop/opencode-auto-experiment/configs/goal.yaml`.
2. Check the current controller state.
3. If the controller is not running, run:

```bash
python3 scripts/innovation_loop.py start --config configs/goal.yaml --workspace . --mode live --detached
```

4. If the controller is already running, do not start a second one. Report current status instead.
5. Summarize what was started or what state already exists.
