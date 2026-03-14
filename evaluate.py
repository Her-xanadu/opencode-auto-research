#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import re
import time


ROOT = pathlib.Path(__file__).resolve().parent


def compute_score(config: dict, strategy: str, variant: int) -> float:
    score = 0.72
    objective_mode = str(config.get("objective_mode", "baseline"))
    if objective_mode == "stability_loss_v2":
        score += 0.14
    if strategy == "variant_2":
        score -= 0.03
    elif strategy == "variant_3":
        score += 0.01
    if variant >= 2:
        score += 0.06
    return min(0.99, round(score, 4))


def write_checkpoint(path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("checkpoint\n", encoding="utf-8")


def log_dvclive(
    score: float, stage: str, resume: bool, checkpoint: pathlib.Path
) -> None:
    try:
        from dvclive import Live  # type: ignore
    except Exception:
        return

    with Live(
        dir="dvclive",
        resume=resume,
        monitor_system=False,
        save_dvc_exp=False,
        dvcyaml=False,
    ) as live:
        live.log_param("stage", stage)
        live.log_metric("score", score)
        try:
            import psutil  # type: ignore

            live.log_metric("system_cpu_percent", psutil.cpu_percent(interval=None))
            live.log_metric(
                "system_memory_mb",
                round(psutil.virtual_memory().used / (1024 * 1024), 2),
            )
        except Exception:
            pass
        if checkpoint.exists():
            live.log_artifact(str(checkpoint), type="checkpoint")
        live.next_step()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", default="baseline")
    parser.add_argument("--resume-from")
    parser.add_argument("--sleep-seconds", type=float)
    args = parser.parse_args()

    config = json.loads((ROOT / "src" / "config.json").read_text(encoding="utf-8"))
    strategy = (ROOT / "src" / "strategy.txt").read_text(encoding="utf-8").strip()
    module_text = (ROOT / "src" / "module.ts").read_text(encoding="utf-8")
    match = re.search(r"(\d+)", module_text)
    variant = int(match.group(1)) if match else 0

    score = compute_score(config, strategy, variant)
    metrics_path = ROOT / "experiments" / "metrics.json"
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    checkpoint = ROOT / "experiments" / "checkpoints" / "last.ckpt"
    write_checkpoint(checkpoint)

    sleep_seconds = (
        args.sleep_seconds
        if args.sleep_seconds is not None
        else 1.0
        if args.stage == "full"
        else 0.0
    )
    if sleep_seconds > 0:
        time.sleep(sleep_seconds)

    metrics_path.write_text(
        json.dumps(
            {
                "score": score,
                "stage": args.stage,
                "resume_from": args.resume_from,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    if args.stage == "full":
        log_dvclive(score, args.stage, bool(args.resume_from), checkpoint)

    if args.stage == "full" and pathlib.Path(ROOT / ".force_full_failure").exists():
        raise RuntimeError("forced full-stage failure after checkpoint")

    print(score)


if __name__ == "__main__":
    main()
