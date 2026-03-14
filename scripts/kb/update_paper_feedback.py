#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any, Dict, List

SCRIPTS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from ae_common import append_jsonl, emit_json, read_json


def load_input(args: argparse.Namespace) -> Dict[str, Any]:
    if args.input_json:
        return json.loads(args.input_json)
    if args.input:
        return read_json(pathlib.Path(args.input).resolve(), {})
    raise RuntimeError("either --input or --input-json is required")


def normalize_records(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    grounding = payload.get("paper_grounding") or []
    seen = set()
    records: List[Dict[str, Any]] = []
    for item in grounding:
        paper_id = str(item.get("paper_id") or "").strip()
        if not paper_id or paper_id in seen:
            continue
        seen.add(paper_id)
        records.append(
            {
                "round": int(payload.get("round", 0)),
                "paper_id": paper_id,
                "proposal_family": payload.get("proposal_family")
                or payload.get("family"),
                "decision": payload.get("decision"),
                "metric_gain": float(payload.get("metric_gain", 0.0)),
                "repo_fit": payload.get("repo_fit", "medium"),
                "failure_mode": payload.get("failure_mode"),
                "note": payload.get("note", ""),
                "evidence_pack_path": payload.get("evidence_pack_path"),
            }
        )
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--input-json")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    payload = load_input(args)
    records = normalize_records(payload)
    output_path = pathlib.Path(args.output).resolve()
    for record in records:
        append_jsonl(output_path, record)
    emit_json({"output": str(output_path), "count": len(records), "records": records})


if __name__ == "__main__":
    main()
