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
    parser.add_argument("--workspace-root", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--round", type=int, default=1)
    args = parser.parse_args()

    workspace_root = pathlib.Path(args.workspace_root).resolve()
    session = workspace_root / "experiments" / "session.json"
    best = workspace_root / "experiments" / "best.json"
    attempts = workspace_root / "experiments" / "attempts.jsonl"
    result_packet = workspace_root / "experiments" / "result_packet.json"
    if not result_packet.exists():
        fallback_result_packet = workspace_root / "experiments" / "result-packet.json"
        result_packet = (
            fallback_result_packet if fallback_result_packet.exists() else result_packet
        )
    if not (session.exists() and best.exists() and attempts.exists()):
        emit_json(
            {
                "mode": "inference",
                "skipped": True,
                "reason": "missing_controller_state_files",
                "required": [str(session), str(best), str(attempts)],
            }
        )
        return

    retrieval = run_step(
        "retrieve_papers.py",
        "--goal",
        str(workspace_root / "configs" / "goal.yaml"),
        "--session",
        str(session),
        "--best",
        str(best),
        "--attempts",
        str(attempts),
        "--result-packet",
        str(result_packet),
        "--workspace-root",
        args.workspace_root,
        "--config",
        args.config,
        "--round",
        str(args.round),
        cwd=workspace_root,
    )
    evidence = run_step(
        "make_evidence_pack.py",
        "--round",
        str(args.round),
        "--retrieval",
        retrieval["output"],
        "--workspace-root",
        args.workspace_root,
        "--config",
        args.config,
        cwd=workspace_root,
    )
    emit_json(
        {
            "mode": "inference",
            "skipped": False,
            "retrieval": retrieval,
            "evidence": evidence,
            "summary": {
                "selected_count": retrieval.get("selected")
                and len(retrieval.get("selected"))
                or 0,
                "evidence_pack_path": evidence.get("output"),
            },
        }
    )


if __name__ == "__main__":
    main()
