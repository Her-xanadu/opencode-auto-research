# Installation and Upgrade Guide

This project is designed to work with a local OpenCode + oh-my-opencode setup while keeping the experiment controller as the stable authority path.

## Fastest Local Install

### 1. Install JavaScript dependencies

```bash
npm ci
```

### 2. Install Python dependencies for controller and DVC path

```bash
python3 -m pip install "dvc>=3,<4" "dvclive>=3,<4"
```

### 3. Install OpenCode and oh-my-opencode

```bash
npm install -g opencode-ai oh-my-opencode
```

### 4. Configure environment variables

```bash
cp .env.example .env
```

Fill in:

- `KIMI_CODING_API_KEY`
- `KIMI_CODING_BASE_URL`
- optionally `INNOVATION_LOOP_AGENT_MODEL`

### 5. Verify installation

```bash
npm run build
npm test
npm run test:smoke
```

## Recommended Local Usage

### Mock controller path

```bash
python3 scripts/innovation_loop.py bootstrap --config configs/goal.yaml --workspace . --mode mock
python3 scripts/innovation_loop.py tick --config configs/goal.yaml --workspace . --mode mock
python3 scripts/innovation_loop.py status --config configs/goal.yaml --workspace . --mode mock
```

### Research-brain daily maintenance

```bash
python3 scripts/kb/run_maintenance_cycle.py --vault-root ../vault --workspace-root . --config configs/research_brain.yaml
```

### Research context generation

```bash
python3 scripts/kb/run_inference_cycle.py --workspace-root . --config configs/research_brain.yaml --round 1
```

## Stable Upgrade Strategy

To keep the research system stable when OpenCode or oh-my-opencode changes, use this policy:

1. Treat `scripts/innovation_loop.py` as the authority path.
2. Keep plugin-facing TS code as a bridge layer, not a second controller.
3. After every OpenCode / oh-my-opencode upgrade, run:

```bash
npm run build
npm test
npm run test:smoke
```

4. If real DVC is available, also run:

```bash
npm test -- tests/e2e/python-controller-real-dvc.test.ts
```

5. Do not change `opencode.json` and agent model wiring casually during the same upgrade as controller logic.

## Safe Upgrade Workflow

```bash
# 1. update tools
npm install -g opencode-ai oh-my-opencode

# 2. refresh local JS deps if needed
npm ci

# 3. rebuild and test
npm run build
npm test
npm run test:smoke
```

If any of those fail, do not continue with experiments until the controller path is green again.

## Compatibility Rule of Thumb

- OpenCode / oh-my-opencode may change outer surfaces.
- This repository stays stable by keeping:
  - Python controller as truth source
  - structured artifacts in `experiments/`
  - research-brain scripts under `scripts/kb/`
  - TypeScript tools as adapters

As long as those boundaries remain intact, upgrades are usually manageable.
