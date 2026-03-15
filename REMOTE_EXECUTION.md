# Remote Execution Contract

This repository treats remote execution as a contract, not as a separate controller.

## Authority Path

- Outer-loop authority remains `scripts/innovation_loop.py`
- Remote execution is only a backend choice for stage commands inside `goal.yaml`

## Contract Requirements

Any remote wrapper must preserve these behaviors:

1. return a non-zero exit code on failure
2. write metrics to the expected metrics artifact path
3. write a checkpoint path when resume is possible
4. accept `--resume-from <checkpoint>` without changing semantic meaning
5. keep stdout/stderr useful enough for judge and recovery diagnostics

## Recommended Pattern

- local orchestrator calls stage commands from `goal.yaml`
- stage commands may internally wrap:
  - local python execution
  - remote SSH execution
  - scheduler submission
- but they must still obey the same metric/checkpoint contract

## Minimum Validation

Before using a real remote backend, validate:

```bash
npm test -- tests/e2e/python-controller-real-dvc.test.ts
```

Then run one environment-specific smoke where your wrapper:

- launches a remote baseline
- launches a remote candidate
- writes metrics
- writes checkpoint
- resumes from checkpoint
- returns status cleanly to the local controller

## What Not To Do

- do not create a second remote-specific outer controller
- do not bypass `experiments/` artifacts as truth source
- do not change the meaning of keep/discard based on transport layer
