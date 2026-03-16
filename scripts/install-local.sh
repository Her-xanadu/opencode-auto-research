#!/usr/bin/env bash
set -euo pipefail

echo "[1/4] Installing JavaScript dependencies"
npm ci

echo "[2/4] Installing Python controller dependencies"
python3 -m pip install "dvc>=3,<4" "dvclive>=3,<4"

echo "[3/4] Checking OpenCode toolchain"
if ! command -v opencode >/dev/null 2>&1; then
  echo "OpenCode CLI not found. Install with: npm install -g opencode-ai"
fi
if ! command -v oh-my-opencode >/dev/null 2>&1; then
  echo "oh-my-opencode not found. Install with: npm install -g oh-my-opencode"
fi

echo "[4/4] Verifying local build/test baseline"
npm run build
npm test
npm run test:smoke

echo "Done. If needed, copy .env.example to .env and add credentials."
