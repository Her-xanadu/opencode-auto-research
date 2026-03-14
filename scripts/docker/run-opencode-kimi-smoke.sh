#!/usr/bin/env bash
set -euo pipefail

cd /workspace

node scripts/docker/setup-opencode-config.mjs
npm test
npm run build

opencode --version >/tmp/opencode-version.txt
oh-my-opencode --version >/tmp/oh-my-opencode-version.txt

opencode agent list >/tmp/opencode-agents.txt
grep -q 'Sisyphus (Ultraworker)' /tmp/opencode-agents.txt
grep -q 'Prometheus (Plan Builder)' /tmp/opencode-agents.txt
grep -q 'sisyphus-junior' /tmp/opencode-agents.txt
grep -q 'Apollo' /tmp/opencode-agents.txt
grep -q 'Athena' /tmp/opencode-agents.txt
grep -q 'Hermes' /tmp/opencode-agents.txt

opencode debug agent "Sisyphus (Ultraworker)" >/tmp/sisyphus-agent.txt
grep -q '"providerID": "kimi-for-coding"' /tmp/sisyphus-agent.txt
grep -q '"modelID": "kimi-k2.5"' /tmp/sisyphus-agent.txt

opencode debug agent "Prometheus (Plan Builder)" >/tmp/prometheus-agent.txt
grep -q '"providerID": "kimi-for-coding"' /tmp/prometheus-agent.txt
grep -q '"modelID": "kimi-k2.5"' /tmp/prometheus-agent.txt

opencode run --dir /workspace -m kimi-for-coding/kimi-k2.5 "Reply with exactly KIMI_DOCKER_OK." >/tmp/kimi-default.txt
grep -q 'KIMI_DOCKER_OK' /tmp/kimi-default.txt

opencode run --dir /workspace --agent "Sisyphus (Ultraworker)" -m kimi-for-coding/kimi-k2.5 "Do not use any tools. Reply with exactly SISYPHUS_KIMI_OK." >/tmp/kimi-sisyphus.txt
grep -q 'SISYPHUS_KIMI_OK' /tmp/kimi-sisyphus.txt

grep -q '"Apollo": {' opencode.json
grep -q '"model": "kimi-for-coding/kimi-k2.5"' opencode.json

grep -q '"Athena": {' opencode.json

grep -q '"Hermes": {' opencode.json

printf '{\n  "opencode": "%s",\n  "oh_my_opencode": "%s",\n  "model": "kimi-for-coding/kimi-k2.5",\n  "agent": "Sisyphus (Ultraworker)",\n  "executor": "sisyphus-junior",\n  "planner": "Prometheus (Plan Builder)",\n  "status": "ok"\n}\n' "$(tr -d '\n' </tmp/opencode-version.txt)" "$(tr -d '\n' </tmp/oh-my-opencode-version.txt)"
