#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib

from ae_common import (
    attempts_path,
    best_path,
    emit_json,
    load_goal,
    read_json,
    read_jsonl,
    result_packet_path,
    session_path,
    workspace_from_goal,
    write_json,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--workspace")
    args = parser.parse_args()

    config_path = pathlib.Path(args.config).resolve()
    goal = load_goal(config_path)
    workspace = workspace_from_goal(config_path, args.workspace)

    payload = {
        "goal": {
            "target_metric": goal.get("target_metric"),
            "metric_direction": goal.get("metric_direction"),
        },
        "session": read_json(session_path(workspace), {}),
        "best": read_json(best_path(workspace), {}),
        "attempts": read_jsonl(attempts_path(workspace))[-5:],
    }
    write_json(result_packet_path(workspace), payload)
    emit_json(payload)


if __name__ == "__main__":
    main()
