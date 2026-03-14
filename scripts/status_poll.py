#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib

from ae_common import (
    append_run_event,
    checkpoint_path,
    dvc_command,
    emit_json,
    load_goal,
    load_pending_result,
    parse_queue_status,
    read_json,
    read_metric_file,
    save_pending_result,
    workspace_from_goal,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--workspace")
    parser.add_argument("--task-id")
    args = parser.parse_args()

    config_path = pathlib.Path(args.config).resolve()
    goal = load_goal(config_path)
    workspace = workspace_from_goal(config_path, args.workspace)

    status_result = dvc_command(["queue", "status", "--json"], workspace)
    if status_result.returncode != 0 or not status_result.stdout.strip():
        status_result = dvc_command(["queue", "status"], workspace)
    queue_state = parse_queue_status(status_result.stdout, args.task_id)
    log_task_id = queue_state.task_id or args.task_id
    logs_result = (
        dvc_command(["queue", "logs", log_task_id], workspace)
        if log_task_id
        else dvc_command(["queue", "logs"], workspace)
    )
    pending = (
        load_pending_result(workspace, queue_state.task_id or args.task_id or "")
        if (queue_state.task_id or args.task_id)
        else {}
    )
    checkpoint = read_json(checkpoint_path(workspace), None)
    metric = read_metric_file(
        workspace
        / goal.get("paths", {}).get("metrics_file", "experiments/metrics.json"),
        goal.get("paths", {}).get("metric_key", "score"),
    )
    if metric is not None and pending:
        pending["current_metric"] = metric
        save_pending_result(
            workspace, queue_state.task_id or args.task_id or "", pending
        )

    if queue_state.task_id:
        append_run_event(
            workspace,
            queue_state.task_id,
            queue_state.status,
            {"raw_output": queue_state.raw_output},
        )

    emit_json(
        {
            "task_id": queue_state.task_id,
            "status": queue_state.status,
            "queued": queue_state.status == "queued",
            "running": queue_state.status == "running",
            "finished": queue_state.status in {"success", "failed"},
            "checkpoint_available": bool(
                checkpoint and checkpoint.get("checkpoint_path")
            ),
            "metric_reported": bool(metric is not None),
            "current_metric": metric,
            "resume_from": checkpoint.get("checkpoint_path") if checkpoint else None,
            "logs_excerpt": (logs_result.stdout or logs_result.stderr).strip()[:500],
            "raw_output": queue_state.raw_output,
        }
    )


if __name__ == "__main__":
    main()
