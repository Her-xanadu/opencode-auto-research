# innovation-loop

This skill defines the fixed experiment loop rules.

Hard rules:
- `Sisyphus` is the sole outer orchestrator.
- `Sisyphus-Junior` is the sole code executor.
- `Prometheus` appears only during bootstrap or `review-blocked` replanning.
- Each round consults exactly three read-only specialists.
- Only one primary hypothesis may enter implementation.
- Reject parameter-only proposals as the main hypothesis.
- Keep or discard decisions must use structured metrics only.
- Require minimal ablation and family-aware reasoning for every proposal.
