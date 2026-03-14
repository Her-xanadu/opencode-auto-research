# /research-context

Generate one research context snapshot for the current experiment goal without running a full loop tick.

Execution order:
1. Read `AGENTS.md`, `configs/goal.yaml`, and `configs/research_brain.yaml`.
2. Read the current controller state from `experiments/session.json`, `experiments/best.json`, and `experiments/attempts.jsonl` if they exist.
3. Use the local research-brain artifacts to rebuild the index only when needed.
4. Generate one retrieval result and one `evidence-round-XXXX.md` pack.
5. Summarize which papers were selected, why they were selected, and where the evidence pack was written.

Constraints:
- Do not start or continue the full experiment loop.
- Do not scan the vault directly from the agent; use repo-local research outputs and controller scripts.
- Keep the output focused on the current retrieval result, evidence pack path, and main grounding candidates.
