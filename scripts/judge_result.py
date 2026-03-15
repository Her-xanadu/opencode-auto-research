#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib

from ae_common import (
    append_jsonl,
    attempts_path,
    best_path,
    current_best_metric,
    current_best_exp_ref,
    dvc_command,
    emit_json,
    load_pending_result,
    load_goal,
    load_session,
    now_iso,
    restore_parent_snapshot,
    save_session,
    set_session_stage,
    register_family_result,
    update_redirect_memory,
    session_path,
    workspace_from_goal,
    write_json,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--workspace")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--monitor-state", required=True)
    args = parser.parse_args()

    config_path = pathlib.Path(args.config).resolve()
    goal = load_goal(config_path)
    workspace = workspace_from_goal(config_path, args.workspace)
    pending = load_pending_result(workspace, args.run_id)
    session_file = session_path(workspace)
    session = load_session(session_file)
    baseline_metric = (
        current_best_metric(workspace) or pending.get("baseline_metric") or 0.0
    )
    current_metric = pending.get("current_metric")
    family = pending.get("family")
    previous_exp_ref = current_best_exp_ref(workspace)

    if args.monitor_state == "failed" or current_metric is None:
        status = "crash"
        reason = "missing metric or failed DVC task"
    else:
        improved = (
            float(current_metric) > float(baseline_metric)
            if goal.get("metric_direction", "maximize") == "maximize"
            else float(current_metric) < float(baseline_metric)
        )
        status = "keep" if improved else "discard"
        reason = "improved metric" if improved else "did not beat current best"

    if status == "keep":
        dvc_command(["exp", "apply", args.run_id], workspace)
        write_json(
            best_path(workspace),
            {
                "metric": current_metric,
                "exp_ref": args.run_id,
                "parent_ref": previous_exp_ref,
                "family": family,
                "accepted_at": now_iso(),
                "current_best": {
                    "run_id": args.run_id,
                    "metric": current_metric,
                    "commit": "local",
                    "checkpoint": None,
                },
                "updated_at": now_iso(),
            },
        )
    else:
        restore_parent_snapshot(workspace, args.run_id)

    record = {
        "round": pending.get("round", int(session.get("iteration_count", 0)) + 1),
        "run_id": args.run_id,
        "kind": "candidate",
        "family": family,
        "proposal_id": pending.get("proposal_id"),
        "created_at": now_iso(),
        "baseline_metric": baseline_metric,
        "current_metric": current_metric,
        "metric": current_metric,
        "change_manifest": {
            "primary_object": pending.get("change_unit"),
            "secondary_objects": [],
        },
        "changed_files": pending.get("touched_files", []),
        "touched_files": pending.get("touched_files", []),
        "diff_summary": pending.get("diff_summary"),
        "stage_reached": pending.get("stage_reached", "full"),
        "decision": status,
        "reject_reason": None if status == "keep" else reason,
        "dvc_exp_ref": pending.get("dvc_exp_ref", args.run_id),
        "status": status,
        "paper_grounding": pending.get("paper_grounding", []),
        "evidence_pack_path": pending.get("evidence_pack_path"),
        "research_context_id": pending.get("research_context_id"),
        "redirect_if_underperforming": pending.get("redirect_if_underperforming"),
        "causal_metric_path": pending.get("causal_metric_path"),
        "failure_signature": pending.get("failure_signature"),
        "pivot_after_failure": pending.get("pivot_after_failure"),
    }
    append_jsonl(attempts_path(workspace), record)

    session["active_dvc_task"] = None
    session["active_run_id"] = None
    session["iteration_count"] = int(session.get("iteration_count", 0)) + 1
    session["round"] = session["iteration_count"]
    session["budget_used"] = {
        "rounds": session["iteration_count"],
        "full_runs": int(session.get("budget_used", {}).get("full_runs", 0)) + 1,
    }
    if status == "keep":
        session["best_metric"] = current_metric
        session["best_exp_ref"] = args.run_id
        session["best_run_id"] = args.run_id
    session = register_family_result(session, family, status, goal)
    session = update_redirect_memory(
        session,
        family,
        status,
        record.get("redirect_if_underperforming"),
        record.get("failure_signature"),
        record.get("causal_metric_path"),
    )
    next_stage = "crash_recoverable" if status == "crash" else "ready_to_execute"
    set_session_stage(session, next_stage, f"judged {args.run_id} as {status}")
    save_session(session_file, session)
    emit_json({"status": status, "reason": reason, "record": record})


if __name__ == "__main__":
    main()
