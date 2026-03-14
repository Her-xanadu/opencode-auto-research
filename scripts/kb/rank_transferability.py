#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Any, Dict

SCRIPTS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from ae_common import emit_json, read_json, read_jsonl, write_json
from common import (
    frontier_map_output_path,
    load_research_config,
    resolve_workspace_root,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--feedback", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--workspace-root")
    parser.add_argument("--config")
    parser.add_argument("--frontier-map")
    args = parser.parse_args()

    workspace_root = resolve_workspace_root(args.workspace_root)
    config = load_research_config(
        pathlib.Path(args.config).resolve() if args.config else None
    )
    feedback_rows = [
        row
        for row in read_jsonl(pathlib.Path(args.feedback).resolve())
        if isinstance(row, dict)
    ]
    ranking: Dict[str, Any] = {}
    for row in feedback_rows:
        paper_id = str(row.get("paper_id") or "").strip()
        if not paper_id:
            continue
        bucket = ranking.setdefault(
            paper_id,
            {"paper_id": paper_id, "keep": 0, "discard": 0, "metric_gain": 0.0},
        )
        decision = row.get("decision")
        if decision == "keep":
            bucket["keep"] += 1
        elif decision == "discard":
            bucket["discard"] += 1
        bucket["metric_gain"] += float(row.get("metric_gain", 0.0))

    for bucket in ranking.values():
        keep = float(bucket["keep"])
        discard = float(bucket["discard"])
        gain = float(bucket["metric_gain"])
        bucket["posterior_usefulness"] = round(keep * 1.5 - discard * 1.0 + gain, 4)
        bucket["transferability"] = round(
            max(0.0, 1.0 + keep * 0.5 - discard * 0.25), 4
        )

    output_path = pathlib.Path(args.output).resolve()
    write_json(output_path, ranking)

    frontier_map_path = (
        pathlib.Path(args.frontier_map).resolve()
        if args.frontier_map
        else frontier_map_output_path(workspace_root, config)
    )
    frontier = read_json(frontier_map_path, {})
    topics = frontier.get("topics", {}) if isinstance(frontier, dict) else {}
    for families in topics.values():
        for items in families.values():
            if not isinstance(items, list):
                continue
            for item in items:
                if isinstance(item, dict):
                    rank = ranking.get(str(item.get("paper_id")))
                    if rank:
                        item["recommended_weight"] = round(
                            1.0 + float(rank["posterior_usefulness"]), 4
                        )
    write_json(frontier_map_path, {"topics": topics})
    emit_json(
        {
            "output": str(output_path),
            "frontier_map": str(frontier_map_path),
            "paper_count": len(ranking),
        }
    )


if __name__ == "__main__":
    main()
