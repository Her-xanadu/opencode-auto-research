# AGENTS

## Purpose

This repository implements the fixed `opencode-experiment-loop` workflow described in the Sisyphus plan.

## Routing Rules

1. `Sisyphus` is the only outer-loop orchestrator.
2. `sisyphus-junior` is the only agent allowed to execute code changes.
3. `Prometheus` appears only for bootstrap or `review_blocked` replanning.
4. `Apollo`, `Athena`, and `Hermes` are read-only specialists.

## Loop Rules

1. Read `configs/goal.yaml` before proposing or executing any change.
2. Keep exactly one primary hypothesis per round.
3. Reject parameter-only proposals as the main hypothesis.
4. Use structured metrics and persisted files as the source of truth.
5. Persist per-round proposals under `experiments/proposals/`.
6. Use `scripts/innovation_loop.py` as the Python controller entrypoint.
7. Reuse DVC/DVCLive for queued runs, metrics, checkpoints, and apply semantics whenever available.

## Important Paths

- `configs/goal.yaml`
- `experiments/session.json`
- `experiments/best.json`
- `experiments/attempts.jsonl`
- `experiments/proposals/`
- `experiments/runs/`
- `scripts/innovation_loop.py`
