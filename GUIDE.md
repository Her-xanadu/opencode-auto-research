# Operator Guide

## 1. Workspace Layout

Recommended local layout:

```text
~/Desktop/opencode auto research/
├── opencode-auto-research/
└── vault -> ~/Desktop/加密流量
```

`opencode-auto-research/` is the engineering repository.
`vault/` is your local Obsidian-compatible paper vault.

## 2. Environment Setup

### JavaScript

```bash
npm ci
```

### Python

```bash
python3 -m pip install -r requirements.txt
```

### OpenCode Tooling

```bash
npm install -g opencode-ai oh-my-opencode
```

### Optional infrastructure

```bash
python3 -m pip install "dvc>=3,<4" "dvclive>=3,<4"
brew install gh
```

## 3. Environment Variables

Copy the template:

```bash
cp .env.example .env
```

Minimum variables:

- `KIMI_CODING_API_KEY`
- `KIMI_CODING_BASE_URL`
- `INNOVATION_LOOP_AGENT_MODEL` (optional override)

## 4. Main Workflows

### A. Automated experiment loop

Mock mode:

```bash
python3 scripts/innovation_loop.py bootstrap --config configs/goal.yaml --workspace . --mode mock
python3 scripts/innovation_loop.py tick --config configs/goal.yaml --workspace . --mode mock
python3 scripts/innovation_loop.py status --config configs/goal.yaml --workspace . --mode mock
```

Live mode:

```bash
python3 scripts/innovation_loop.py bootstrap --config configs/goal.yaml --workspace . --mode live
python3 scripts/innovation_loop.py tick --config configs/goal.yaml --workspace . --mode live
python3 scripts/innovation_loop.py status --config configs/goal.yaml --workspace . --mode live
```

### B. Research brain maintenance

```bash
python3 scripts/kb/organize_vault.py --vault-root ../vault
python3 scripts/kb/standardize_vault_format.py --vault-root ../vault
python3 scripts/kb/fill_figure_notes.py --vault-root ../vault
python3 scripts/kb/daily_tracker_lite.py --vault-root ../vault --workspace-root . --config configs/research_brain.yaml
```

### C. Index and evidence generation

```bash
python3 scripts/kb/build_index.py --vault-root ../vault --workspace-root . --config configs/research_brain.yaml --output-dir experiments/research/index --scaffold-missing --extract-claims
python3 scripts/kb/retrieve_papers.py --goal configs/goal.yaml --session experiments/session.json --best experiments/best.json --attempts experiments/attempts.jsonl --workspace-root . --config configs/research_brain.yaml --round 1
python3 scripts/kb/make_evidence_pack.py --round 1 --retrieval experiments/research/retrieval-cache/retrieval-round-0001.json --workspace-root . --config configs/research_brain.yaml
```

## 5. Scheduler Workflow

Recommended daily job: `daily-research-brain`

The daily job should:

1. organize the vault
2. standardize vault file naming
3. fill figure notes
4. rebuild the research-brain index
5. generate evidence context when controller state exists

## 6. Innovation Brain Workflow

The research brain adds six layers before the loop proposes code changes:

1. machine-friendly paper layer (`paper.meta.yaml`, `claims.jsonl`)
2. global paper / claim / method index
3. evidence retrieval (`retrieve_papers.py`)
4. evidence pack (`make_evidence_pack.py`)
5. three-specialist grounding
6. post-hoc feedback reweighting

Important artifacts:

- `experiments/research/index/paper-index.jsonl`
- `experiments/research/index/claim-index.jsonl`
- `experiments/research/evidence-round-0001.md`
- `experiments/research/paper-feedback.jsonl`

## 7. Testing and Build

```bash
npm test
npm run build
```

Focused checks:

```bash
npm test -- tests/e2e/research-brain-direction-memory.test.ts
npm test -- tests/kb/make-evidence-pack.test.ts
```

## 8. Publishing Checklist

Before pushing publicly:

- remove or ignore `.env`
- verify no secrets in `opencode.json`, `configs/`, or notes
- verify `vault/` is not unintentionally committed
- verify `experiments/` contains only intended project artifacts
- run `npm test && npm run build`

## 9. Post-Publish Verification

After push:

```bash
gh repo view --web
git ls-files
```

And recheck:

- README renders correctly
- GUIDE is present
- configs and scripts are uploaded
- tests and source directories are present
