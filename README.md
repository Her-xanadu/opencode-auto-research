# OpenCode Auto Experiment

OpenCode Auto Experiment is an experiment-optimization loop for OpenCode + oh-my-opencode.

It is designed for research and engineering workflows where you want an outer orchestrator to:

- run a baseline experiment,
- consult three read-only specialists,
- choose one primary hypothesis,
- let a single executor change code,
- rerun experiments,
- keep or discard the result,
- and stop automatically when the target metric is reached.

The current implementation uses:

- `Sisyphus (Ultraworker)` as the only outer orchestrator,
- `sisyphus-junior` as the only code executor,
- `Prometheus (Plan Builder)` only for bootstrap or `review_blocked` replanning,
- `Apollo`, `Athena`, and `Hermes` as the three read-only specialists,
- a Python controller for baseline, DVC, DVCLive, resume, stop, and status.

For the current release, all three specialists are configured to use `kimi-for-coding/kimi-k2.5`. The role names are now decoupled from the underlying model, so you can later remap them to GPT / Claude / Gemini without rewriting the orchestration layer.

## What This Project Does

This repository provides a governed experiment loop with these core pieces:

- OpenCode plugin registration for commands, tools, and agents
- role-based multi-agent orchestration
- a Python experiment controller with structured state files
- DVC + DVCLive integration for experiment bookkeeping
- Docker-based smoke tests for scientific workflows and OpenCode/Kimi wiring

## Architecture

Authority-path note:

- `scripts/innovation_loop.py` is the only outer-loop authority path.
- TypeScript legacy orchestration remains only as internal/test-only compatibility code.
- `experiment_run_governed_workflow` now bridges into the Python controller instead of running a competing TS outer loop.

The control flow is:

1. `Sisyphus` reads the goal and current state.
2. `Sisyphus` invokes the three read-only specialists:
   - `Apollo`: exploit-oriented proposal generation
   - `Athena`: validity and attribution guard
   - `Hermes`: orthogonal divergence proposal
3. `Sisyphus` selects one primary hypothesis.
4. `sisyphus-junior` is the only agent allowed to execute code changes.
5. The Python controller runs baseline / smoke / proxy / full stages and records results.
6. DVC / DVCLive / truth-source files are updated.
7. The loop continues until:
   - target threshold is reached,
   - budget is exhausted,
   - or the system becomes `review_blocked`.

Important files:

- `AGENTS.md`
- `opencode.json`
- `src/commands/index.ts`
- `src/agents/`
- `src/tools/index.ts`
- `scripts/innovation_loop.py`
- `configs/goal.yaml`
- `experiments/session.json`
- `experiments/best.json`
- `experiments/attempts.jsonl`
- `experiments/proposals/`

## Repository Layout

```text
opencode-auto-experiment/
├── .opencode/                  # OpenCode command and agent docs
├── configs/                    # Goal and experiment config
├── dist/                       # Built TypeScript output
├── experiments/                # Truth-source artifacts and skeleton files
├── fixtures/                   # Test fixtures
├── scripts/                    # Python controller and Docker smoke scripts
├── src/                        # TypeScript plugin, agents, tools, orchestration
├── tests/                      # Unit, integration, and E2E tests
├── AGENTS.md                   # Routing rules and project-level guidance
├── docker-compose.yml
├── Dockerfile
├── Dockerfile.opencode
├── dvc.yaml
├── evaluate.py                 # Local toy evaluation task
├── opencode.json               # Agent model mapping
├── package.json
├── params.yaml
└── README.md
```

## Runtime Requirements

### Required

- Node.js 22+
- npm 10+
- Python 3.10+

### Recommended

- Docker + Docker Compose
- DVC 3.x
- DVCLive 3.x
- OpenCode CLI
- oh-my-opencode plugin

### Optional

- a remote training server for real long-running experiments
- GPU / ROCm / CUDA depending on your research environment

## Installation

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd opencode-auto-experiment
```

### 2. Install JavaScript dependencies

```bash
npm ci
```

### 3. Install Python dependencies

If you want local controller execution with real DVC support:

```bash
python3 -m pip install "dvc>=3,<4" "dvclive>=3,<4"
```

### 4. Install OpenCode tooling

```bash
npm install -g opencode-ai oh-my-opencode
```

Or use the local bootstrap script:

```bash
bash scripts/install-local.sh
```

To make the experiment system available from any plain `opencode` session, also install the global command set:

```bash
bash scripts/install-opencode-global.sh
```

### 5. Configure environment variables

Copy the example file:

```bash
cp .env.example .env
```

Then set the required values for your model provider. For the current default Kimi setup, you need:

- `KIMI_CODING_API_KEY`
- `KIMI_CODING_BASE_URL`

For a fuller setup and upgrade workflow, including global slash-command installation, see `INSTALL.md`.

## Configuration

### Agent models

Agent model mapping lives in `opencode.json`.

Current defaults:

- `Sisyphus (Ultraworker)` -> `kimi-for-coding/kimi-k2.5`
- `Prometheus (Plan Builder)` -> `kimi-for-coding/kimi-k2.5`
- `sisyphus-junior` -> `kimi-for-coding/kimi-k2.5`
- `Apollo` -> `kimi-for-coding/kimi-k2.5`
- `Athena` -> `kimi-for-coding/kimi-k2.5`
- `Hermes` -> `kimi-for-coding/kimi-k2.5`

You can later remap the three specialists independently without changing the architecture.

### Goal configuration

Experiment goals are defined in `configs/goal.yaml`.

Important fields include:

- target metric
- metric direction
- target threshold
- round budget
- full-run budget
- innovation constraints
- command definitions for baseline / smoke / proxy / full

### Truth-source artifacts

The controller persists state under `experiments/`:

- `session.json`
- `best.json`
- `attempts.jsonl`
- `proposals/round-xxxx.json`

## Usage

### Build the project

```bash
npm run build
```

### Run the test suite

```bash
npm test
```

### Run the main Docker scientific smoke test

```bash
npm run docker:test:scientific
```

### Run the OpenCode + Kimi Docker smoke test

```bash
npm run docker:test:opencode
```

### Run the Python controller smoke directly

```bash
python3 scripts/innovation_loop.py bootstrap --config configs/goal.yaml --workspace . --mode mock
python3 scripts/innovation_loop.py tick --config configs/goal.yaml --workspace . --mode mock
python3 scripts/innovation_loop.py status --config configs/goal.yaml --workspace . --mode mock
```

### OpenCode command usage

The main OpenCode-facing commands are:

- `/innovate-loop`
- `/experiment-init`
- `/experiment-run`
- `/experiment-status`
- `/experiment-bootstrap`

The intended automatic path is `/innovate-loop` driven by `Sisyphus`.

## Docker Usage

Two main services exist in `docker-compose.yml`:

- `app`: general test environment
- `opencode-kimi`: OpenCode + oh-my-opencode + Kimi smoke environment

Useful commands:

```bash
docker compose run --rm app npm test
docker compose run --rm opencode-kimi bash /workspace/scripts/docker/run-opencode-kimi-smoke.sh
```

## What Has Been Verified

The current implementation has already passed:

- local `npm test`
- local `npm run build`
- Docker `app` full tests
- Docker scientific smoke
- Docker OpenCode + Kimi smoke

The current toy automatic experiment loop has also been verified to:

- run a baseline
- invoke `Apollo`, `Athena`, and `Hermes`
- route code execution through `sisyphus-junior`
- keep successful changes
- stop automatically on `goal_reached`

## Limitations

This repository is already usable as a governed experiment-loop prototype, but a few limitations should be documented clearly:

- The current public default still uses one underlying model (`kimi-k2.5`) for all specialists.
- Real multi-hour training on a remote server is not the main validated path yet.
- Docker scientific smoke uses toy research tasks for fast validation.
- The full production path for "local OpenCode -> remote server training" should be validated separately in your final environment.
- You must never commit real secrets or provider keys into the repository.

## Open-Source Caveats

- Do not commit `.env` or any real API keys.
- Review `opencode.json` and environment variables before publishing.
- If you publish this repository publicly, add a license before release.
- Document whether your real training environment depends on CUDA, ROCm, or remote SSH access.

## Remote Execution

Remote execution is supported as a contract pattern rather than a separate controller.

- The outer loop still runs locally through `scripts/innovation_loop.py`
- `goal.yaml` stage commands may wrap remote execution
- Metrics, checkpoints, and resume semantics must remain stable

See `REMOTE_EXECUTION.md` for the exact contract.

Validation paths:

- `npm test -- tests/e2e/python-controller-real-dvc.test.ts`
- `npm test -- tests/e2e/remote-contract.test.ts`

## Daily Scheduler Split

The previous monolithic `daily-research-brain` job has been split into two clearer chains:

- `daily-research-maintenance`
  - vault organization
  - file standardization
  - figure-note filling
  - index refresh
- `daily-research-context`
  - retrieval generation
  - evidence pack generation
  - controller-state-aware inference only

This split makes maintenance failures easier to diagnose and keeps inference generation separate from vault cleanup.

## Recommended Next Steps

- Add a `LICENSE` file before public release.
- Decide whether to keep Kimi as the default public model or provide a provider-agnostic example config.
- Add a `CONTRIBUTING.md` if you want outside contributions.
- Add a dedicated remote-server guide once your final local-to-remote path is stable.
