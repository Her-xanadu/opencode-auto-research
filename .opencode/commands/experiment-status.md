# /experiment-status

Show the structured experiment session, best state, run ledger, and current loop status.

Read from:
- `experiments/session.json`
- `experiments/best.json`
- `experiments/attempts.jsonl`

Rules:
- Report state as `Sisyphus` would summarize it.
- Do not invent controller state beyond structured files.
