# research-brain

This skill defines the lightweight local research-brain rules for the experiment loop.

Hard rules:
- Use the Python controller path as the authority path.
- Build or refresh the local index before retrieval only when the index is missing or stale.
- Generate one shared evidence pack per round and feed the same pack to `Apollo`, `Athena`, and `Hermes`.
- Main proposals must include `paper_grounding` with at least two unique local `paper_id` values.
- `Athena` may veto weakly grounded ideas, but the controller must also run deterministic hard validation.
- Feedback must be written to `experiments/research/paper-feedback.jsonl` and then reweighted into posterior ranking artifacts.
- Do not introduce vector databases, graph databases, external services, or a second agent runtime.

Recommended workflow:
1. Read `configs/research_brain.yaml`.
2. Read `experiments/research/index/paper-index.jsonl` and related index files.
3. Read the latest retrieval cache and evidence pack.
4. Ground proposals in the current evidence pack before proposing any change.
5. After judging a run, write paper feedback and refresh posterior ranking.
