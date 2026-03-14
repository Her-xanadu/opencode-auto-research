# Contributing

Thanks for your interest in improving OpenCode Auto Research.

## Development workflow

1. Fork the repository or create a feature branch.
2. Install dependencies:

```bash
npm ci
python3 -m pip install -r requirements.txt
```

3. Run validation before opening a pull request:

```bash
npm test
npm run build
```

4. Keep changes scoped and reproducible.

## Design expectations

- Preserve the governed experiment-loop architecture.
- Do not introduce external services, vector databases, graph databases, or a second agent runtime into the core research-brain path.
- Keep `Sisyphus` as the outer orchestrator and `sisyphus-junior` as the only code executor.
- Keep the local paper vault optional and configurable through `configs/research_brain.yaml`.

## Pull request guidelines

- Explain the motivation, not only the code diff.
- Mention whether your change affects:
  - experiment loop behavior
  - research-brain retrieval/evidence behavior
  - scheduler / maintenance workflow
  - tests or fixtures
- Add or update tests whenever behavior changes.

## Security and privacy

- Never commit real API keys or `.env` files.
- Do not commit private vault content unless you intentionally want to publish it.
- Avoid hard-coding user-specific absolute paths.
