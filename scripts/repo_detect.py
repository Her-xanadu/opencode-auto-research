#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib

from ae_common import emit_json, repo_detect_path, save_goal, write_json, write_text


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--write-config", required=True)
    args = parser.parse_args()

    workspace = pathlib.Path(args.workspace).resolve()
    config_path = pathlib.Path(args.write_config).resolve()

    train_entry = "python3 evaluate.py"
    eval_entry = "python3 evaluate.py"
    test_entry = "python3 evaluate.py"
    metrics_file = "experiments/metrics.json"
    metric_key = "score"
    editable_paths = ["src/**"]
    unresolved = (
        []
        if (workspace / "evaluate.py").exists()
        else [
            "commands.baseline",
            "commands.full",
            "paths.metrics_file",
            "paths.metric_key",
        ]
    )

    payload = {
        "train_entry": train_entry,
        "eval_entry": eval_entry,
        "test_entry": test_entry,
        "metrics_path_candidates": [metrics_file],
        "editable_path_candidates": editable_paths,
        "unresolved_fields": unresolved,
    }
    write_json(repo_detect_path(workspace), payload)

    dvc_yaml_path = workspace / "dvc.yaml"
    if not dvc_yaml_path.exists():
        write_text(
            dvc_yaml_path,
            """stages:
  full:
    cmd: python3 evaluate.py --stage full
    deps:
      - evaluate.py
      - src/config.json
      - src/strategy.txt
      - src/module.ts
    metrics:
      - experiments/metrics.json
    outs:
      - dvclive
      - experiments/checkpoints
""",
        )

    params_yaml_path = workspace / "params.yaml"
    if not params_yaml_path.exists():
        write_text(
            params_yaml_path,
            """experiment:
  target_metric: surrogate_validation_accuracy
  metric_direction: maximize
  max_rounds: 3
  max_full_runs: 3
  max_hours: 1
""",
        )

    goal = {
        "workspace_root": str(workspace),
        "goal_text": "Optimize surrogate_validation_accuracy with the fixed Sisyphus experiment loop.",
        "target_metric": "surrogate_validation_accuracy",
        "primary_metric": "surrogate_validation_accuracy",
        "metric_direction": "maximize",
        "target_threshold": 0.9,
        "min_gain": 0.01,
        "budget": {
            "max_rounds": 3,
            "max_full_runs": 3,
            "max_hours": 1,
        },
        "max_rounds": 3,
        "max_iterations": 3,
        "max_hours": 1,
        "metric_extract_rule": "number",
        "eval_command": eval_entry,
        "editable_paths": editable_paths,
        "read_only_paths": ["data/**"],
        "commands": {
            "baseline": "python3 evaluate.py --stage baseline",
            "smoke": "python3 evaluate.py --stage smoke",
            "proxy": "python3 evaluate.py --stage proxy",
            "full": "python3 evaluate.py --stage full",
        },
        "paths": {
            "metrics_file": metrics_file,
            "metric_key": metric_key,
            "editable_paths": editable_paths,
        },
        "innovation": {
            "reject_parameter_only": True,
            "max_family_failures": 2,
            "cooldown_rounds": 2,
        },
        "stop_rule": {
            "metric_threshold": 0.9,
            "max_no_improvement_rounds": 2,
        },
    }
    save_goal(config_path, goal)
    emit_json(
        {
            "workspace": str(workspace),
            "goal_config": str(config_path),
            "repo_detect": str(repo_detect_path(workspace)),
            "unresolved_fields": unresolved,
        }
    )


if __name__ == "__main__":
    main()
