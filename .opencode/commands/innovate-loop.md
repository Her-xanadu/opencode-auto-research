# /innovate-loop

Run the fixed experiment-optimization loop through `Sisyphus`.

Execution order:
1. Read `AGENTS.md` and `configs/goal.yaml`.
2. If bootstrap facts are missing, call `Prometheus` only for that narrow bootstrap plan.
3. Consult exactly three read-only specialists:
   - `Apollo`
   - `Athena`
   - `Hermes`
4. Select exactly one primary hypothesis.
5. Delegate implementation only to `Sisyphus-Junior`.
6. Run the governed workflow and report best metric, latest decision, stop reason, and next primary change.

Constraints:
- Keep a single primary change per round.
- Treat tool output as the source of truth.
- `Prometheus` may appear only for bootstrap or `review-blocked` replanning.
- The three specialists are read-only.
- `Sisyphus-Junior` is the only code executor.
