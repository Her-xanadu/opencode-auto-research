# OpenCode Auto Research

OpenCode Auto Research is an engineering project that combines a governed autonomous experiment loop with a lightweight local innovation brain.

It is designed for research workflows where you want one outer orchestrator to:

- run baseline and candidate experiments,
- consult three read-only specialists,
- ground proposals in a local paper vault,
- learn from keep/discard outcomes,
- redirect the search when results underperform,
- and keep the whole process traceable through structured artifacts.

## Core Capabilities

- governed OpenCode experiment loop driven by `Sisyphus`
- three-specialist proposal workflow with `Apollo`, `Athena`, and `Hermes`
- Python controller for baseline, tick, resume, stop, and status
- local research brain with paper indexing, retrieval, evidence packs, and feedback reweighting
- session-level direction memory for multi-round pivot suggestions
- deterministic artifacts under `experiments/` for reproducibility

## System Roles

- `Sisyphus`: only outer-loop orchestrator
- `sisyphus-junior`: only code executor
- `Prometheus`: bootstrap and replanning only
- `Apollo`: exploit-oriented research proposal specialist
- `Hermes`: orthogonal divergence specialist
- `Athena`: attribution and validity guard

## Architecture

```text
goal + state + research brain
        |
        v
   Sisyphus orchestrator
        |
        +--> Apollo  (exploit route)
        +--> Hermes  (orthogonal route)
        +--> Athena  (guard + redirect)
        |
        v
  chosen proposal -> sisyphus-junior -> controller -> judge -> feedback
        ^                                                  |
        |                                                  v
        +---------------- research brain updates <---------+
```

## Repository Layout

```text
opencode-auto-research/
├── .opencode/                  # OpenCode commands and local skills
├── configs/                    # Goal and research-brain config
├── experiments/                # Session truth-source artifacts
├── fixtures/                   # Test fixtures, including KB fixtures
├── scripts/                    # Python controller and research-brain scripts
├── src/                        # TypeScript plugin, agents, tools, orchestration
├── tests/                      # Unit, integration, and E2E tests
├── AGENTS.md                   # Project rules and routing guidance
├── GUIDE.md                    # Full setup and operator guide
├── README.md
├── package.json
├── requirements.txt
└── .env.example
```

## Research Brain Workspace

One convenient local layout is:

```text
~/workspace/opencode-auto-research/
├── opencode-auto-research/     # this repository
└── vault/                      # local paper vault or symlink
```

The default `configs/research_brain.yaml` points to `../vault`, so the engineering repo stays publishable while the paper vault remains local.

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
- GitHub CLI (`gh`) for publication and release workflows

### Optional

- Remote training server
- GPU / ROCm / CUDA

## Quick Start

### 1. Clone

```bash
git clone <your-repo-url>
cd opencode-auto-research
```

### 2. Install JavaScript dependencies

```bash
npm ci
```

### 3. Install Python dependencies

```bash
python3 -m pip install -r requirements.txt
```

### 4. Configure environment variables

```bash
cp .env.example .env
```

Set at least:

- `KIMI_CODING_API_KEY`
- `KIMI_CODING_BASE_URL`
- optionally `INNOVATION_LOOP_AGENT_MODEL`

### 5. Build and verify

```bash
npm run build
npm test
```

## Day-to-Day Usage

### Run the controller in mock mode

```bash
python3 scripts/innovation_loop.py bootstrap --config configs/goal.yaml --workspace . --mode mock
python3 scripts/innovation_loop.py tick --config configs/goal.yaml --workspace . --mode mock
python3 scripts/innovation_loop.py status --config configs/goal.yaml --workspace . --mode mock
```

### Run research-brain maintenance manually

```bash
python3 scripts/kb/organize_vault.py --vault-root ../vault
python3 scripts/kb/standardize_vault_format.py --vault-root ../vault
python3 scripts/kb/fill_figure_notes.py --vault-root ../vault
python3 scripts/kb/build_index.py --vault-root ../vault --workspace-root . --config configs/research_brain.yaml --output-dir experiments/research/index --scaffold-missing --extract-claims
```

### Generate one evidence pack

```bash
python3 scripts/kb/retrieve_papers.py --goal configs/goal.yaml --session experiments/session.json --best experiments/best.json --attempts experiments/attempts.jsonl --workspace-root . --config configs/research_brain.yaml --round 1
python3 scripts/kb/make_evidence_pack.py --round 1 --retrieval experiments/research/retrieval-cache/retrieval-round-0001.json --workspace-root . --config configs/research_brain.yaml
```

### OpenCode commands

- `/innovate-loop`
- `/experiment-init`
- `/experiment-run`
- `/experiment-status`
- `/experiment-bootstrap`
- `/research-context`

## Scheduler

The current recommended daily maintenance job is `daily-research-brain`.

Its responsibilities are:

- organize the local vault
- standardize file naming
- fill missing figure notes
- rebuild the research-brain index
- generate one evidence context when controller state exists

See `GUIDE.md` for the full operator flow.

## Testing and Validation

### Full suite

```bash
npm test
```

### Build

```bash
npm run build
```

### Example focused suites

```bash
npm test -- tests/kb/make-evidence-pack.test.ts
npm test -- tests/e2e/research-brain-direction-memory.test.ts
```

## Publication Notes

- Do not commit `.env` or real provider credentials.
- Do not commit your full private paper vault unless you explicitly intend to publish it.
- Review `configs/research_brain.yaml` before publishing if your local vault path differs.
- Review `experiments/` and exclude transient artifacts you do not want in source control.
- For a public release, add `CONTRIBUTING.md` and `SECURITY.md` to clarify collaboration and disclosure expectations.

## What Is Already Verified

The packaged engineering version currently passes:

- `npm test`
- `npm run build`
- research-brain retrieval / evidence E2E flows
- redirect memory and multi-round pivot tests

## Next Reading

- `GUIDE.md` — full environment and operator guide
- `AGENTS.md` — project routing rules
- `configs/research_brain.yaml` — research-brain maintenance configuration
- `CONTRIBUTING.md` — contribution expectations
- `SECURITY.md` — safe disclosure and publishing guidance
