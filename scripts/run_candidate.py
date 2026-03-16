#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import pathlib

from ae_common import (
    append_jsonl,
    attempts_path,
    append_run_event,
    current_best_metric,
    current_best_exp_ref,
    dvc_command,
    emit_json,
    load_goal,
    load_session,
    new_id,
    run_opencode_agent,
    run_dir,
    run_stage,
    restore_parent_snapshot,
    read_json,
    save_parent_snapshot,
    save_run_manifest,
    save_pending_result,
    session_path,
    start_dvc_queue_worker,
    workspace_from_goal,
    write_json,
    read_text,
    write_text,
    checkpoint_path,
    now_iso,
)


def apply_mutation(workspace: pathlib.Path, mutation: dict) -> dict:
    target = workspace / mutation["target_file"]
    params = mutation["params"]
    change_class = mutation["change_class"]
    if change_class == "objective":
        payload = json.loads(read_text(target, "{}"))
        payload[params["key"]] = params["value"]
        write_text(target, json.dumps(payload, indent=2) + "\n")
        return {
            "touched_files": mutation.get("files_to_touch")
            or [mutation["target_file"]],
            "diff_summary": mutation.get("change_unit"),
            "change_manifest": {
                "primary_object": mutation.get("change_unit"),
                "secondary_objects": [],
            },
        }
    if change_class == "representation":
        write_text(
            target, read_text(target).replace(params["search"], params["replace"])
        )
        return {
            "touched_files": mutation.get("files_to_touch")
            or [mutation["target_file"]],
            "diff_summary": mutation.get("change_unit"),
            "change_manifest": {
                "primary_object": mutation.get("change_unit"),
                "secondary_objects": [],
            },
        }
    if change_class == "architecture":
        write_text(target, params["content"])
        return {
            "touched_files": mutation.get("files_to_touch")
            or [mutation["target_file"]],
            "diff_summary": mutation.get("change_unit"),
            "change_manifest": {
                "primary_object": mutation.get("change_unit"),
                "secondary_objects": [],
            },
        }
    raise RuntimeError(f"unsupported change_class: {change_class}")


def apply_mutation_live(workspace: pathlib.Path, mutation: dict) -> dict:
    if os.environ.get("INNOVATION_LOOP_LIVE_TEST_MODE") == "1":
        return apply_mutation(workspace, mutation)
    prompt = f"""
Return exactly one JSON object and nothing else.

You are sisyphus-junior. Call experiment_controller_apply_mutation exactly once.

Required JSON fields:
- touched_files
- diff_summary
- change_manifest

WORKSPACE_ROOT: {workspace}
MUTATION_JSON: {json.dumps(mutation, ensure_ascii=False)}
""".strip()
    return run_opencode_agent("sisyphus-junior", prompt, workspace=workspace)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--workspace")
    parser.add_argument("--run-id")
    parser.add_argument("--proposal-json")
    parser.add_argument("--resume-from")
    parser.add_argument(
        "--mode",
        choices=["mock", "live"],
        default=os.environ.get("INNOVATION_LOOP_MODE", "mock"),
    )
    args = parser.parse_args()

    config_path = pathlib.Path(args.config).resolve()
    goal = load_goal(config_path)
    workspace = workspace_from_goal(config_path, args.workspace)
    mutation = json.loads(args.proposal_json) if args.proposal_json else {}
    run_id = args.run_id or new_id("candidate")
    session = load_session(session_path(workspace))
    round_index = int(session.get("iteration_count", 0)) + 1
    touched_files = (
        mutation.get("files_to_touch")
        or mutation.get("touched_files")
        or [mutation.get("target_file")]
    )
    touched_files = [path for path in touched_files if path]
    save_parent_snapshot(workspace, run_id, touched_files)
    execution_result = (
        apply_mutation_live(workspace, mutation)
        if args.mode == "live"
        else apply_mutation(workspace, mutation)
    )
    touched_files = execution_result.get("touched_files", touched_files)

    checkpoint = workspace / "experiments" / "checkpoints" / f"{run_id}.ckpt"
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    checkpoint.write_text("checkpoint\n", encoding="utf-8")
    write_json(
        checkpoint_path(workspace),
        {
            "run_id": run_id,
            "checkpoint_path": str(checkpoint),
            "parent_run_id": current_best_exp_ref(workspace) or "baseline",
        },
    )
    parent_snapshot = read_json(
        workspace / "experiments" / "runs" / run_id / "parent_snapshot.json", {}
    )
    created_files = [
        relative
        for relative, entry in parent_snapshot.items()
        if isinstance(entry, dict)
        and not entry.get("exists", False)
        and (workspace / relative).exists()
    ]
    deleted_files = [
        relative
        for relative, entry in parent_snapshot.items()
        if isinstance(entry, dict)
        and entry.get("exists", False)
        and not (workspace / relative).exists()
    ]
    save_run_manifest(
        workspace,
        run_id,
        {
            "run_id": run_id,
            "proposal_id": mutation.get("proposal_id"),
            "family": mutation.get("family"),
            "touched_files": touched_files,
            "created_files": created_files,
            "deleted_files": deleted_files,
            "checkpoint_path": str(checkpoint),
            "dvc_exp_ref": run_id,
            "resume_from": args.resume_from,
        },
    )

    try:
        smoke_metric = run_stage(goal, workspace, "smoke")
        proxy_metric = run_stage(goal, workspace, "proxy")
    except RuntimeError as error:
        restore_parent_snapshot(workspace, run_id)
        record = {
            "round": round_index,
            "run_id": run_id,
            "kind": "candidate",
            "family": mutation.get("family"),
            "proposal_id": mutation.get("proposal_id"),
            "created_at": now_iso(),
            "baseline_metric": current_best_metric(workspace) or 0.0,
            "current_metric": None,
            "metric": None,
            "change_manifest": {
                "primary_object": mutation.get("change_unit"),
                "secondary_objects": [],
            },
            "changed_files": touched_files,
            "touched_files": touched_files,
            "diff_summary": execution_result.get(
                "diff_summary", mutation.get("change_unit")
            ),
            "stage_reached": "smoke_or_proxy_failed",
            "decision": "discard",
            "reject_reason": str(error),
            "dvc_exp_ref": None,
            "status": "discard",
            "paper_grounding": mutation.get("paper_grounding", []),
            "evidence_pack_path": mutation.get("evidence_pack_path"),
            "research_context_id": mutation.get("research_context_id"),
            "redirect_if_underperforming": mutation.get("redirect_if_underperforming"),
            "causal_metric_path": mutation.get("causal_metric_path"),
            "failure_signature": mutation.get("failure_signature"),
            "pivot_after_failure": mutation.get("pivot_after_failure"),
        }
        append_jsonl(attempts_path(workspace), record)
        append_run_event(
            workspace,
            run_id,
            "discarded_before_full",
            {"reason": str(error), "mutation": mutation},
        )
        emit_json(
            {
                "run_id": run_id,
                "queued": False,
                "status": "discard",
                "reason": str(error),
                "stage_reached": "smoke_or_proxy_failed",
            }
        )
        return

    pending = {
        "round": round_index,
        "run_id": run_id,
        "baseline_metric": current_best_metric(workspace) or smoke_metric,
        "current_metric": None,
        "change_class": mutation.get("change_class"),
        "change_unit": mutation.get("change_unit"),
        "proposal_id": mutation.get("proposal_id"),
        "family": mutation.get("family"),
        "target_file": mutation.get("target_file"),
        "files_to_touch": touched_files,
        "params": mutation.get("params", {}),
        "why_not_parameter_only": mutation.get("why_not_parameter_only"),
        "minimal_ablation": mutation.get("minimal_ablation"),
        "touched_files": touched_files,
        "diff_summary": execution_result.get(
            "diff_summary", mutation.get("change_unit")
        ),
        "resume_from": args.resume_from,
        "parent_exp_ref": current_best_exp_ref(workspace),
        "dvc_exp_ref": run_id,
        "paper_grounding": mutation.get("paper_grounding", []),
        "evidence_pack_path": mutation.get("evidence_pack_path"),
        "research_context_id": mutation.get("research_context_id"),
        "redirect_if_underperforming": mutation.get("redirect_if_underperforming"),
        "causal_metric_path": mutation.get("causal_metric_path"),
        "failure_signature": mutation.get("failure_signature"),
        "pivot_after_failure": mutation.get("pivot_after_failure"),
        "stage_reached": "queued",
        "stage_results": {
            "smoke": smoke_metric,
            "proxy": proxy_metric,
        },
    }
    save_pending_result(workspace, run_id, pending)
    append_run_event(
        workspace,
        run_id,
        "queued",
        {"resume_from": args.resume_from, "mutation": mutation},
    )
    dvc_command(["exp", "run", "--queue", "--name", run_id], workspace)
    start_dvc_queue_worker(workspace)

    emit_json(
        {
            "run_id": run_id,
            "queued": True,
            "status": "queued",
            "resume_from": args.resume_from,
            "stage_reached": "queued",
            "dvc_exp_ref": run_id,
            "stage_results": pending["stage_results"],
        }
    )


if __name__ == "__main__":
    main()
