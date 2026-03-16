---
description: Bootstrap the canonical opencode-auto-experiment workspace.
---
# /experiment-init

Operate on the fixed workspace:

- Workspace: `/Users/herxanadu/Desktop/opencode-auto-experiment`
- Authority path: `scripts/innovation_loop.py`

Execution rules:

1. Read `/Users/herxanadu/Desktop/opencode-auto-experiment/AGENTS.md`.
2. Run:

```bash
python3 scripts/innovation_loop.py bootstrap --config configs/goal.yaml --workspace . --mode mock
```

3. Summarize the bootstrap result and any follow-up needed.
