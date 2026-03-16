---
description: Show the current status of the canonical opencode-auto-experiment workspace.
---
# /experiment-status

Operate on the fixed workspace:

- Workspace: `/Users/herxanadu/Desktop/opencode-auto-experiment`

Run:

```bash
python3 scripts/innovation_loop.py status --config configs/goal.yaml --workspace . --mode live
```

If live status is empty or stale, also inspect `experiments/session.json`, `experiments/best.json`, and `experiments/attempts.jsonl` and summarize the current system state.
