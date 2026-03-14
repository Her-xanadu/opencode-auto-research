#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib

from ae_common import (
    append_jsonl,
    attempts_path,
    best_path,
    current_best_exp_ref,
    emit_json,
    load_goal,
    load_session,
    now_iso,
    run_stage,
    save_session,
    set_session_stage,
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

    metric = run_stage(goal, workspace, "baseline")
    session_file = session_path(workspace)
    session = load_session(session_file)
    session["best_metric"] = metric
    session["best_exp_ref"] = "baseline"
    session["best_run_id"] = "baseline"
    session["active_dvc_task"] = None
    session["active_run_id"] = None
    session["round"] = 0
    session["iteration_count"] = 0
    session["budget_used"] = {"rounds": 0, "full_runs": 0}
    set_session_stage(session, "baseline_completed", "baseline completed")

    record = {
        "round": 0,
        "run_id": "baseline",
        "kind": "baseline",
        "family": "baseline",
        "proposal_id": None,
        "created_at": now_iso(),
        "baseline_metric": metric,
        "current_metric": metric,
        "metric": metric,
        "changed_files": [],
        "stage_reached": "baseline",
        "decision": "keep",
        "reject_reason": None,
        "dvc_exp_ref": "baseline",
        "status": "keep",
        "stage_results": {"baseline": metric},
    }
    append_jsonl(attempts_path(workspace), record)
    write_json(
        best_path(workspace),
        {
            "metric": metric,
            "exp_ref": "baseline",
            "parent_ref": current_best_exp_ref(workspace),
            "family": "baseline",
            "accepted_at": now_iso(),
            "current_best": {
                "run_id": "baseline",
                "metric": metric,
                "commit": "local",
                "checkpoint": None,
            },
            "updated_at": now_iso(),
        },
    )
    save_session(session_file, session)
    emit_json(record)


if __name__ == "__main__":
    main()
