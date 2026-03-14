# Security

## Reporting

If you discover a security issue, please avoid opening a public issue with sensitive details.

Instead, contact the maintainer privately and include:

- affected component
- impact summary
- reproduction steps
- proposed mitigation if known

## Common sensitive areas

- `.env` and provider credentials
- local vault paths and private research notes
- scheduler definitions that may expose local workspace paths
- experiment artifacts that may contain environment-specific data

## Safe publishing checklist

- confirm `.env` is ignored
- confirm no credentials exist in committed config files
- confirm private vault content is not accidentally tracked
- confirm logs and transient experiment state are excluded as needed
