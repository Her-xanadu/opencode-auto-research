#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
from typing import Any, Dict

SCRIPTS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from ae_common import emit_json


def run_step(script_name: str, *args: str, cwd: pathlib.Path) -> Dict[str, Any]:
    result = subprocess.run(
        ["python3", str(pathlib.Path(__file__).resolve().parent / script_name), *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout or f"{script_name} failed")
    return json.loads(result.stdout)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault-root", required=True)
    parser.add_argument("--workspace-root", required=True)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    workspace_root = pathlib.Path(args.workspace_root).resolve()
    steps = {
        "organize": run_step(
            "organize_vault.py", "--vault-root", args.vault_root, cwd=workspace_root
        ),
        "standardize": run_step(
            "standardize_vault_format.py",
            "--vault-root",
            args.vault_root,
            cwd=workspace_root,
        ),
        "fill_figure_notes": run_step(
            "fill_figure_notes.py", "--vault-root", args.vault_root, cwd=workspace_root
        ),
        "daily_tracker": run_step(
            "daily_tracker_lite.py",
            "--vault-root",
            args.vault_root,
            "--workspace-root",
            args.workspace_root,
            "--config",
            args.config,
            cwd=workspace_root,
        ),
        "build_index": run_step(
            "build_index.py",
            "--vault-root",
            args.vault_root,
            "--workspace-root",
            args.workspace_root,
            "--config",
            args.config,
            "--output-dir",
            str(workspace_root / "experiments" / "research" / "index"),
            "--scaffold-missing",
            "--extract-claims",
            cwd=workspace_root,
        ),
    }
    emit_json(
        {
            "mode": "maintenance",
            "workspace_root": str(workspace_root),
            "vault_root": args.vault_root,
            "steps": steps,
            "summary": {
                "organized_files": steps["organize"].get("moved_count", 0),
                "standardized_papers": steps["standardize"].get("paper_count", 0),
                "filled_figure_notes": steps["fill_figure_notes"].get(
                    "updated_count", 0
                ),
                "paper_count": steps["build_index"].get("paper_count", 0),
                "claim_count": steps["build_index"].get("claim_count", 0),
                "method_count": steps["build_index"].get("method_count", 0),
            },
        }
    )


if __name__ == "__main__":
    main()
