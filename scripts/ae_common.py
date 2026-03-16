from __future__ import annotations

import json
import os
import pathlib
import shlex
import shutil
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional


ROOT = pathlib.Path(__file__).resolve().parent.parent


def ensure_parent(path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def read_text(path: pathlib.Path, default: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return default


def write_text(path: pathlib.Path, value: str) -> None:
    ensure_parent(path)
    path.write_text(value, encoding="utf-8")


def read_json(path: pathlib.Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def write_json(path: pathlib.Path, value: Any) -> None:
    ensure_parent(path)
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def append_jsonl(path: pathlib.Path, value: Any) -> None:
    ensure_parent(path)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, ensure_ascii=False) + "\n")


def read_jsonl(path: pathlib.Path) -> List[Any]:
    try:
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    except FileNotFoundError:
        return []


def parse_scalar(raw: str) -> Any:
    value = raw.strip()
    if not value:
        return ""
    if value in {"null", "Null", "NULL", "~"}:
        return None
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if value.startswith('"') and value.endswith('"'):
        return json.loads(value)
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1]
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        return value


def load_yaml_like(path: pathlib.Path) -> Dict[str, Any]:
    text = read_text(path).strip()
    if not text:
        return {}
    if text.startswith("{"):
        return json.loads(text)

    lines = [
        line.rstrip("\n")
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    index = 0

    def parse_block(indent: int) -> Any:
        nonlocal index
        result: Dict[str, Any] = {}
        while index < len(lines):
            line = lines[index]
            current_indent = len(line) - len(line.lstrip(" "))
            if current_indent < indent:
                break
            if current_indent > indent:
                raise ValueError(f"invalid indentation in {path}: {line}")
            stripped = line.strip()
            if stripped.startswith("- "):
                raise ValueError(f"list item cannot appear here in {path}: {line}")
            key, _, tail = stripped.partition(":")
            if not _:
                raise ValueError(f"invalid mapping line in {path}: {line}")
            index += 1
            if tail.strip():
                result[key] = parse_scalar(tail)
                continue
            if index >= len(lines):
                result[key] = {}
                continue
            next_line = lines[index]
            next_indent = len(next_line) - len(next_line.lstrip(" "))
            if next_indent <= indent:
                result[key] = {}
                continue
            if next_line.strip().startswith("- "):
                result[key] = parse_list(next_indent)
            else:
                result[key] = parse_block(next_indent)
        return result

    def parse_list(indent: int) -> List[Any]:
        nonlocal index
        items: List[Any] = []
        while index < len(lines):
            line = lines[index]
            current_indent = len(line) - len(line.lstrip(" "))
            if current_indent < indent:
                break
            if current_indent != indent:
                raise ValueError(f"invalid list indentation in {path}: {line}")
            stripped = line.strip()
            if not stripped.startswith("- "):
                break
            payload = stripped[2:]
            index += 1
            if payload:
                items.append(parse_scalar(payload))
            else:
                if (
                    index < len(lines)
                    and (len(lines[index]) - len(lines[index].lstrip(" "))) > indent
                ):
                    items.append(parse_block(indent + 2))
                else:
                    items.append(None)
        return items

    parsed = parse_block(0)
    if not isinstance(parsed, dict):
        raise ValueError(f"top-level object must be a mapping in {path}")
    return parsed


def dump_yaml_like(value: Any, indent: int = 0) -> str:
    prefix = " " * indent
    if isinstance(value, dict):
        lines: List[str] = []
        for key, item in value.items():
            if isinstance(item, (dict, list)):
                lines.append(f"{prefix}{key}:")
                lines.append(dump_yaml_like(item, indent + 2))
            else:
                scalar = (
                    json.dumps(item)
                    if isinstance(item, str) and (":" in item or item.strip() != item)
                    else str(item).lower()
                    if isinstance(item, bool)
                    else "null"
                    if item is None
                    else str(item)
                )
                lines.append(f"{prefix}{key}: {scalar}")
        return "\n".join(lines)
    if isinstance(value, list):
        lines = []
        for item in value:
            if isinstance(item, (dict, list)):
                lines.append(f"{prefix}-")
                lines.append(dump_yaml_like(item, indent + 2))
            else:
                scalar = (
                    json.dumps(item)
                    if isinstance(item, str) and (":" in item or item.strip() != item)
                    else str(item).lower()
                    if isinstance(item, bool)
                    else "null"
                    if item is None
                    else str(item)
                )
                lines.append(f"{prefix}- {scalar}")
        return "\n".join(lines)
    return f"{prefix}{value}"


def write_yaml_like(path: pathlib.Path, value: Dict[str, Any]) -> None:
    write_text(path, dump_yaml_like(value) + "\n")


def experiments_dir(workspace: pathlib.Path) -> pathlib.Path:
    return workspace / "experiments"


def runs_dir(workspace: pathlib.Path) -> pathlib.Path:
    return experiments_dir(workspace) / "runs"


def run_dir(workspace: pathlib.Path, run_id: str) -> pathlib.Path:
    return runs_dir(workspace) / run_id


def session_path(workspace: pathlib.Path) -> pathlib.Path:
    return experiments_dir(workspace) / "session.json"


def best_path(workspace: pathlib.Path) -> pathlib.Path:
    return experiments_dir(workspace) / "best.json"


def attempts_path(workspace: pathlib.Path) -> pathlib.Path:
    return experiments_dir(workspace) / "attempts.jsonl"


def result_packet_path(workspace: pathlib.Path) -> pathlib.Path:
    return experiments_dir(workspace) / "result_packet.json"


def proposals_dir(workspace: pathlib.Path) -> pathlib.Path:
    return experiments_dir(workspace) / "proposals"


def proposal_round_path(workspace: pathlib.Path, round_index: int) -> pathlib.Path:
    return proposals_dir(workspace) / f"round-{round_index:04d}.json"


def repo_detect_path(workspace: pathlib.Path) -> pathlib.Path:
    return experiments_dir(workspace) / "repo_detect.json"


def controller_pid_path(workspace: pathlib.Path) -> pathlib.Path:
    return experiments_dir(workspace) / "controller.pid"


def controller_stop_path(workspace: pathlib.Path) -> pathlib.Path:
    return experiments_dir(workspace) / "controller.stop"


def controller_status_path(workspace: pathlib.Path) -> pathlib.Path:
    return experiments_dir(workspace) / "controller_status.json"


def checkpoint_path(workspace: pathlib.Path) -> pathlib.Path:
    return experiments_dir(workspace) / "recovery_checkpoint.json"


def read_pid(path: pathlib.Path) -> Optional[int]:
    if not path.exists():
        return None
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except ValueError:
        path.unlink(missing_ok=True)
        return None


def pid_is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def clear_controller_artifacts(workspace: pathlib.Path) -> None:
    controller_pid_path(workspace).unlink(missing_ok=True)
    controller_stop_path(workspace).unlink(missing_ok=True)


def controller_is_running(workspace: pathlib.Path) -> bool:
    pid_file = controller_pid_path(workspace)
    pid = read_pid(pid_file)
    if pid is None:
        return False
    if pid_is_running(pid):
        return True
    clear_controller_artifacts(workspace)
    return False


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def run_shell(command: str, cwd: pathlib.Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.setdefault("GIT_AUTHOR_NAME", "Auto Experiment")
    env.setdefault("GIT_AUTHOR_EMAIL", "auto-experiment@example.invalid")
    env.setdefault("GIT_COMMITTER_NAME", env["GIT_AUTHOR_NAME"])
    env.setdefault("GIT_COMMITTER_EMAIL", env["GIT_AUTHOR_EMAIL"])
    return subprocess.run(
        command,
        cwd=str(cwd),
        shell=True,
        capture_output=True,
        text=True,
        env=env,
    )


def run_checked(command: str, cwd: pathlib.Path) -> subprocess.CompletedProcess[str]:
    result = run_shell(command, cwd)
    if result.returncode != 0:
        raise RuntimeError(
            f"command failed ({command}): {result.stderr.strip() or result.stdout.strip()}"
        )
    return result


def extract_metric(output: str, rule: str, metric_key: Optional[str] = None) -> float:
    if rule == "number":
        for token in output.replace(",", " ").split():
            try:
                return float(token)
            except ValueError:
                continue
        raise ValueError(f"no numeric metric found in output: {output}")
    if rule == "json":
        payload = json.loads(output)
        if metric_key and metric_key in payload:
            return float(payload[metric_key])
        raise ValueError(f"metric_key {metric_key!r} missing from JSON output")
    raise ValueError(f"unsupported metric extract rule: {rule}")


def load_goal(path: pathlib.Path) -> Dict[str, Any]:
    data = load_yaml_like(path)
    data.setdefault("commands", {})
    data.setdefault("paths", {})
    data.setdefault("budget", {})
    data.setdefault("innovation", {})
    data.setdefault("stop_rule", {})
    budget = data.get("budget", {})
    innovation = data.get("innovation", {})
    data.setdefault(
        "editable_paths", data.get("paths", {}).get("editable_paths", ["src/**"])
    )
    data.setdefault("read_only_paths", ["data/**"])
    data.setdefault("metric_extract_rule", data.get("eval_parser", "number"))
    data.setdefault("target_metric", data.get("primary_metric", "metric"))
    data.setdefault("metric_direction", "maximize")
    data.setdefault(
        "target_threshold", data.get("stop_rule", {}).get("metric_threshold")
    )
    data.setdefault(
        "max_rounds", budget.get("max_rounds", data.get("max_iterations", 3))
    )
    data.setdefault("max_full_runs", budget.get("max_full_runs", data["max_rounds"]))
    data.setdefault("max_hours", budget.get("max_hours", 1))
    data.setdefault("min_gain", 0.0)
    data.setdefault(
        "goal_text",
        f"Optimize {data.get('target_metric', 'metric')} within the governed loop.",
    )
    data["budget"].setdefault("max_rounds", data["max_rounds"])
    data["budget"].setdefault("max_full_runs", data["max_full_runs"])
    data["budget"].setdefault("max_hours", data["max_hours"])
    data["innovation"].setdefault("reject_parameter_only", True)
    data["innovation"].setdefault("max_family_failures", 2)
    data["innovation"].setdefault("cooldown_rounds", 2)
    return data


def save_goal(path: pathlib.Path, value: Dict[str, Any]) -> None:
    write_yaml_like(path, value)


def default_session() -> Dict[str, Any]:
    return {
        "loop_id": new_id("loop"),
        "round": 0,
        "state": "idle",
        "stage": "idle",
        "message": "idle",
        "active_dvc_task": None,
        "active_run_id": None,
        "best_metric": None,
        "best_exp_ref": None,
        "best_run_id": None,
        "family_cooldowns": {},
        "family_failures": {},
        "redirect_memory": {},
        "direction_memory": {},
        "direction_memory_v2": {},
        "budget_used": {"rounds": 0, "full_runs": 0},
        "stop_reason": None,
        "iteration_count": 0,
    }


def normalize_session(session: Dict[str, Any]) -> Dict[str, Any]:
    merged = {**default_session(), **session}
    merged["round"] = int(merged.get("round", merged.get("iteration_count", 0)) or 0)
    merged["iteration_count"] = int(
        merged.get("iteration_count", merged.get("round", 0)) or 0
    )
    merged.setdefault("budget_used", {"rounds": 0, "full_runs": 0})
    merged["budget_used"].setdefault("rounds", merged["iteration_count"])
    merged["budget_used"].setdefault("full_runs", merged["iteration_count"])
    merged.setdefault("family_cooldowns", {})
    merged.setdefault("family_failures", {})
    merged.setdefault("redirect_memory", {})
    merged.setdefault("direction_memory", {})
    merged.setdefault("direction_memory_v2", {})
    merged.setdefault("state", merged.get("stage", "idle"))
    merged.setdefault("stage", merged.get("state", "idle"))
    return merged


def set_session_stage(
    session: Dict[str, Any], stage: str, message: str
) -> Dict[str, Any]:
    session["stage"] = stage
    session["state"] = stage
    session["message"] = message
    return session


def decrement_family_cooldowns(session: Dict[str, Any]) -> Dict[str, Any]:
    updated: Dict[str, int] = {}
    for family, remaining in dict(session.get("family_cooldowns", {})).items():
        if int(remaining) > 1:
            updated[family] = int(remaining) - 1
    session["family_cooldowns"] = updated
    return session


def register_family_result(
    session: Dict[str, Any], family: Optional[str], status: str, goal: Dict[str, Any]
) -> Dict[str, Any]:
    if not family:
        return session
    failures = dict(session.get("family_failures", {}))
    cooldowns = dict(session.get("family_cooldowns", {}))
    if status == "keep":
        failures[family] = 0
        cooldowns.pop(family, None)
    elif status in {"discard", "crash"}:
        failures[family] = int(failures.get(family, 0)) + 1
        max_failures = int(goal.get("innovation", {}).get("max_family_failures", 2))
        if failures[family] >= max_failures:
            cooldowns[family] = int(
                goal.get("innovation", {}).get("cooldown_rounds", 2)
            )
            failures[family] = 0
    session["family_failures"] = failures
    session["family_cooldowns"] = cooldowns
    return session


def update_redirect_memory(
    session: Dict[str, Any],
    family: Optional[str],
    status: str,
    redirect: Optional[str],
    failure_signature: Optional[str] = None,
    causal_metric_path: Optional[Any] = None,
) -> Dict[str, Any]:
    memory = dict(session.get("redirect_memory", {}))
    direction_memory = dict(session.get("direction_memory", {}))
    direction_memory_v2 = dict(session.get("direction_memory_v2", {}))

    def family_from_redirect(text: str) -> Optional[str]:
        lowered = str(text or "").lower()
        if (
            "repr.feature" in lowered
            or "representation" in lowered
            or "表征" in lowered
        ):
            return "repr.feature"
        if "arch.backbone" in lowered or "architecture" in lowered or "结构" in lowered:
            return "arch.backbone"
        if (
            "objective.loss" in lowered
            or "objective" in lowered
            or "目标函数" in lowered
        ):
            return "objective.loss"
        return None

    def metric_path_signature(value: Any) -> str:
        if isinstance(value, list):
            return (
                "->".join(str(item).strip() for item in value if str(item).strip())
                or "generic-path"
            )
        if isinstance(value, str):
            return value.strip() or "generic-path"
        return "generic-path"

    def metric_path_match_bonus(stored: str, current: str) -> float:
        if stored == current:
            return 1.0
        stored_parts = [part for part in stored.split("->") if part]
        current_parts = [part for part in current.split("->") if part]
        overlap = len(set(stored_parts) & set(current_parts))
        return 0.2 * overlap

    def classify_failure_type(status: str, failure_signature: Optional[str]) -> str:
        lowered = str(failure_signature or "").lower()
        if status == "crash":
            return "runtime_crash"
        if any(token in lowered for token in ["repo", "path", "侵入", "workspace"]):
            return "repo_mismatch"
        if any(
            token in lowered for token in ["compute", "gpu", "oom", "timeout", "memory"]
        ):
            return "compute_mismatch"
        if any(
            token in lowered
            for token in ["stability", "loss", "中间指标", "metric", "stalled"]
        ):
            return "causal_path_failure"
        if any(token in lowered for token in ["bias", "shortcut", "捷径", "伪泛化"]):
            return "shortcut_failure"
        return "generic_underperform"

    if not family:
        session["redirect_memory"] = memory
        session["direction_memory"] = direction_memory
        session["direction_memory_v2"] = direction_memory_v2
        return session
    if status == "keep":
        memory.pop(family, None)
        direction_memory.pop(family, None)
        for key in list(direction_memory_v2.keys()):
            if key.startswith(f"{family}|"):
                direction_memory_v2.pop(key, None)
        for key, bucket_v2 in list(direction_memory_v2.items()):
            updated_bucket = dict(bucket_v2)
            changed = False
            for next_family, payload in list(updated_bucket.items()):
                entry = dict(payload)
                if next_family == family:
                    entry["success_count"] = int(entry.get("success_count", 0)) + 1
                    failures = int(entry.get("failure_count", 0)) + int(
                        entry.get("crash_count", 0)
                    )
                    entry["confidence"] = round(
                        (int(entry.get("success_count", 0)) + 1)
                        / max(1, int(entry.get("success_count", 0)) + 1 + failures),
                        2,
                    )
                    entry["last_round"] = int(session.get("iteration_count", 0)) + 1
                    updated_bucket[next_family] = entry
                    changed = True
            if changed:
                direction_memory_v2[key] = updated_bucket
    elif status in {"discard", "crash"} and redirect:
        bucket = list(memory.get(family, []))
        bucket.append({"redirect": str(redirect), "updated_at": now_iso()})
        memory[family] = bucket[-3:]
        next_family = family_from_redirect(redirect)
        if next_family:
            direction_memory[family] = {
                "next_family": next_family,
                "reason": str(redirect),
                "updated_at": now_iso(),
            }
            failure_key = str(failure_signature or "generic-underperform")
            failure_type = classify_failure_type(status, failure_signature)
            path_key = metric_path_signature(causal_metric_path)
            edge_key = f"{family}|{failure_type}|{path_key}"
            weight_step = 1.5 if status == "crash" else 1.0
            bucket_v2 = dict(direction_memory_v2.get(edge_key, {}))
            existing = dict(bucket_v2.get(next_family, {}))
            failure_count = int(existing.get("failure_count", 0)) + (
                1 if status == "discard" else 0
            )
            crash_count = int(existing.get("crash_count", 0)) + (
                1 if status == "crash" else 0
            )
            success_count = int(existing.get("success_count", 0))
            total = success_count + failure_count + crash_count
            bucket_v2[next_family] = {
                "weight": round(float(existing.get("weight", 0.0)) + weight_step, 2),
                "last_round": int(session.get("iteration_count", 0)) + 1,
                "reason": str(redirect),
                "metric_path_signature": path_key,
                "failure_signature": failure_key,
                "failure_type": failure_type,
                "success_count": success_count,
                "failure_count": failure_count,
                "crash_count": crash_count,
                "confidence": round(success_count / max(1, total), 2),
            }
            direction_memory_v2[edge_key] = bucket_v2
    session["redirect_memory"] = memory
    session["direction_memory"] = direction_memory
    session["direction_memory_v2"] = direction_memory_v2
    return session


def load_session(path: pathlib.Path) -> Dict[str, Any]:
    return normalize_session(read_json(path, default_session()))


def save_session(path: pathlib.Path, session: Dict[str, Any]) -> None:
    normalized = normalize_session(session)
    normalized["updated_at"] = now_iso()
    write_json(path, normalized)


def current_best_metric(workspace: pathlib.Path) -> Optional[float]:
    best = read_json(best_path(workspace), None)
    if not best:
        return None
    metric = best.get("metric")
    if metric is not None:
        return float(metric)
    current = best.get("current_best") or {}
    current_metric = current.get("metric")
    return float(current_metric) if current_metric is not None else None


def current_best_exp_ref(workspace: pathlib.Path) -> Optional[str]:
    best = read_json(best_path(workspace), None)
    if not best:
        return None
    if best.get("exp_ref"):
        return str(best["exp_ref"])
    current = best.get("current_best") or {}
    run_id = current.get("run_id")
    return str(run_id) if run_id else None


def read_metric_file(path: pathlib.Path, metric_key: str) -> Optional[float]:
    if not path.exists():
        return None
    payload = read_json(path, {})
    if metric_key in payload:
        return float(payload[metric_key])
    return None


def write_metric_file(path: pathlib.Path, metric_key: str, value: float) -> None:
    write_json(path, {metric_key: value, "updated_at": now_iso()})


def run_process(
    command: List[str],
    cwd: pathlib.Path,
    check: bool = True,
    timeout: Optional[float] = None,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.setdefault("GIT_AUTHOR_NAME", "Auto Experiment")
    env.setdefault("GIT_AUTHOR_EMAIL", "auto-experiment@example.invalid")
    env.setdefault("GIT_COMMITTER_NAME", env["GIT_AUTHOR_NAME"])
    env.setdefault("GIT_COMMITTER_EMAIL", env["GIT_AUTHOR_EMAIL"])
    result = subprocess.run(
        command,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        env=env,
        timeout=timeout,
    )
    if check and result.returncode != 0:
        rendered = " ".join(shlex.quote(part) for part in command)
        raise RuntimeError(
            f"command failed ({rendered}): {result.stderr.strip() or result.stdout.strip()}"
        )
    return result


def extract_json_payload(raw: str) -> Any:
    text = raw.strip()
    if not text:
        raise RuntimeError("empty JSON payload")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        first_object = text.find("{")
        last_object = text.rfind("}")
        if first_object != -1 and last_object != -1 and last_object > first_object:
            return json.loads(text[first_object : last_object + 1])
        first_array = text.find("[")
        last_array = text.rfind("]")
        if first_array != -1 and last_array != -1 and last_array > first_array:
            return json.loads(text[first_array : last_array + 1])
        raise


def opencode_repo_dir() -> pathlib.Path:
    raw = os.environ.get("INNOVATION_LOOP_OPENCODE_DIR")
    return pathlib.Path(raw).resolve() if raw else ROOT


def opencode_agent_model() -> str:
    env_override = os.environ.get("INNOVATION_LOOP_AGENT_MODEL")
    if env_override:
        return env_override
    repo = opencode_repo_dir()
    config = read_json(repo / "opencode.json", {})
    model = dict(config.get("agent", {})).get("Apollo", {}).get("model")
    return str(model or "kimi-for-coding/kimi-k2.5")


def run_opencode_agent(
    agent: str,
    prompt: str,
    *,
    model: Optional[str] = None,
    timeout: int = 240000,
    workspace: Optional[pathlib.Path] = None,
) -> Dict[str, Any]:
    repo_dir = opencode_repo_dir()
    command = [
        "opencode",
        "run",
        "--dir",
        str(repo_dir),
        "--format",
        "default",
    ]
    if os.environ.get("INNOVATION_LOOP_LIVE_TEST_MODE") != "1":
        command.extend(["--agent", agent])
    command.extend(["-m", model or opencode_agent_model()])
    command.append(prompt)
    result = run_process(
        command, repo_dir, check=False, timeout=max(timeout / 1000.0, 1.0)
    )
    if workspace is not None:
        artifact_dir = workspace / "experiments" / "live-specialist-failures"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        raw_path = artifact_dir / f"{agent.lower()}-{int(time.time() * 1000)}.json"
    else:
        raw_path = None
    if result.returncode != 0:
        if raw_path is not None:
            write_json(
                raw_path,
                {
                    "agent": agent,
                    "kind": "subprocess_error",
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "returncode": result.returncode,
                },
            )
        raise RuntimeError(
            result.stderr.strip()
            or result.stdout.strip()
            or f"opencode run failed for {agent}"
        )
    try:
        parsed = extract_json_payload(result.stdout)
    except Exception:
        if raw_path is not None:
            write_json(
                raw_path,
                {
                    "agent": agent,
                    "kind": "schema_parse_failure",
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "returncode": result.returncode,
                },
            )
        raise
    if not isinstance(parsed, dict):
        if raw_path is not None:
            write_json(
                raw_path,
                {
                    "agent": agent,
                    "kind": "schema_parse_failure",
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "returncode": result.returncode,
                },
            )
        raise RuntimeError(f"expected JSON object from {agent}")
    return parsed


def has_real_dvc(workspace: pathlib.Path) -> bool:
    if os.environ.get("INNOVATION_LOOP_DISABLE_REAL_DVC") == "1":
        return False
    return shutil.which("dvc") is not None and (workspace / ".dvc").exists()


def ensure_gitignore_patterns(workspace: pathlib.Path) -> None:
    path = workspace / ".gitignore"
    existing = read_text(path)
    lines = {line.strip() for line in existing.splitlines() if line.strip()}
    required = {
        "experiments/",
        "dvclive/",
        "__pycache__/",
        ".pytest_cache/",
    }
    if required.issubset(lines):
        return
    merged = existing.rstrip("\n")
    additions = [entry for entry in sorted(required) if entry not in lines]
    if merged:
        merged += "\n"
    merged += "\n".join(additions) + "\n"
    write_text(path, merged)


def ensure_repo_bootstrap_for_dvc(workspace: pathlib.Path) -> bool:
    if os.environ.get("INNOVATION_LOOP_DISABLE_REAL_DVC") == "1":
        return False
    if shutil.which("dvc") is None:
        return False
    if not (workspace / ".git").exists():
        run_process(["git", "init"], workspace)
    ensure_gitignore_patterns(workspace)
    if not (workspace / ".dvc").exists():
        run_process(["dvc", "init", "--quiet"], workspace)
    head = run_process(["git", "rev-parse", "--verify", "HEAD"], workspace, check=False)
    if head.returncode != 0:
        run_process(["git", "add", "."], workspace)
        run_process(
            [
                "git",
                "-c",
                "user.name=Auto Experiment",
                "-c",
                "user.email=auto-experiment@example.invalid",
                "commit",
                "-m",
                "bootstrap workspace",
            ],
            workspace,
        )
    return True


def start_dvc_queue_worker(workspace: pathlib.Path) -> None:
    if not has_real_dvc(workspace):
        dvc_command(["queue", "start"], workspace)
        return
    subprocess.Popen(
        ["dvc", "queue", "start", "--jobs", "1"],
        cwd=str(workspace),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={
            **os.environ,
            "GIT_AUTHOR_NAME": os.environ.get("GIT_AUTHOR_NAME", "Auto Experiment"),
            "GIT_AUTHOR_EMAIL": os.environ.get(
                "GIT_AUTHOR_EMAIL", "auto-experiment@example.invalid"
            ),
            "GIT_COMMITTER_NAME": os.environ.get(
                "GIT_COMMITTER_NAME", "Auto Experiment"
            ),
            "GIT_COMMITTER_EMAIL": os.environ.get(
                "GIT_COMMITTER_EMAIL", "auto-experiment@example.invalid"
            ),
        },
    )


def dvc_command(
    args: Iterable[str], cwd: pathlib.Path
) -> subprocess.CompletedProcess[str]:
    if not has_real_dvc(cwd):
        return _fake_dvc_command(list(args), cwd)
    command = ["dvc", *args]
    env = os.environ.copy()
    env.setdefault("GIT_AUTHOR_NAME", "Auto Experiment")
    env.setdefault("GIT_AUTHOR_EMAIL", "auto-experiment@example.invalid")
    env.setdefault("GIT_COMMITTER_NAME", env["GIT_AUTHOR_NAME"])
    env.setdefault("GIT_COMMITTER_EMAIL", env["GIT_AUTHOR_EMAIL"])
    return subprocess.run(
        command, cwd=str(cwd), capture_output=True, text=True, env=env
    )


def fake_dvc_state_path(workspace: pathlib.Path) -> pathlib.Path:
    return experiments_dir(workspace) / "fake_dvc_queue.json"


def load_fake_dvc_state(workspace: pathlib.Path) -> Dict[str, Any]:
    return read_json(
        fake_dvc_state_path(workspace), {"workers_started": False, "tasks": []}
    )


def save_fake_dvc_state(workspace: pathlib.Path, state: Dict[str, Any]) -> None:
    write_json(fake_dvc_state_path(workspace), state)


def _fake_dvc_command(
    args: List[str], cwd: pathlib.Path
) -> subprocess.CompletedProcess[str]:
    state = load_fake_dvc_state(cwd)
    stdout = ""
    if args[:2] == ["exp", "run"] and "--queue" in args:
        name = args[args.index("--name") + 1] if "--name" in args else new_id("queued")
        task = {"task_id": name, "status": "queued", "created_at": now_iso()}
        state.setdefault("tasks", []).append(task)
        save_fake_dvc_state(cwd, state)
        stdout = name + "\n"
    elif args[:2] == ["queue", "start"]:
        state["workers_started"] = True
        save_fake_dvc_state(cwd, state)
        stdout = "queue worker started\n"
    elif args[:2] == ["queue", "status"]:
        tasks = state.get("tasks", [])
        if state.get("workers_started"):
            for task in tasks:
                if task["status"] == "queued":
                    task["status"] = "running"
                    break
                if task["status"] == "running":
                    task["status"] = "success"
                    break
            save_fake_dvc_state(cwd, state)
        if "--json" in args:
            stdout = json.dumps(tasks)
        else:
            stdout = "\n".join(
                f"{task['task_id']} {task['status']}" for task in tasks
            ) + ("\n" if tasks else "")
    elif args[:2] == ["queue", "logs"]:
        stdout = "fake dvc logs\n"
    elif args[:2] == ["exp", "apply"]:
        stdout = f"applied {args[-1]}\n"
    elif args[:2] == ["exp", "show"]:
        tasks = state.get("tasks", [])
        if "--json" in args:
            stdout = json.dumps(
                {
                    "workspace": {
                        "baseline": {
                            "data": {
                                "timestamp": now_iso(),
                                "status": "success",
                            }
                        },
                        **{
                            task["task_id"]: {
                                "data": {
                                    "timestamp": task.get("created_at"),
                                    "status": task.get("status"),
                                }
                            }
                            for task in tasks
                        },
                    }
                }
            )
        else:
            stdout = (
                "\n".join(["workspace"] + [task["task_id"] for task in tasks]) + "\n"
            )
    return subprocess.CompletedProcess(["dvc", *args], 0, stdout=stdout, stderr="")


def ensure_controller_not_running(workspace: pathlib.Path) -> None:
    pid = read_pid(controller_pid_path(workspace))
    if pid is None:
        controller_stop_path(workspace).unlink(missing_ok=True)
        return
    if pid_is_running(pid):
        raise RuntimeError(f"controller already running with pid {pid}")
    clear_controller_artifacts(workspace)


@dataclass
class QueueState:
    task_id: Optional[str]
    status: str
    raw_output: str


def parse_queue_status(stdout: str, task_id: Optional[str]) -> QueueState:
    stripped = stdout.strip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            payload = json.loads(stripped)
            entries: List[Dict[str, Any]] = []

            def collect(value: Any) -> None:
                if isinstance(value, list):
                    for item in value:
                        collect(item)
                    return
                if isinstance(value, dict):
                    if any(key in value for key in ["task_id", "name", "id"]) and any(
                        key in value for key in ["status", "state"]
                    ):
                        entries.append(value)
                    for item in value.values():
                        collect(item)

            collect(payload)
            for entry in entries:
                candidate_id = str(
                    entry.get("task_id") or entry.get("name") or entry.get("id")
                )
                candidate_status = str(
                    entry.get("status") or entry.get("state")
                ).lower()
                if task_id is None or candidate_id == task_id:
                    return QueueState(candidate_id, candidate_status, stdout)
        except json.JSONDecodeError:
            pass
    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    if not lines:
        return QueueState(task_id, "unknown", stdout)
    for line in lines:
        parts = line.split()
        if len(parts) >= 2:
            candidate_id = parts[0]
            candidate_status = parts[1].lower()
            if task_id is None or candidate_id == task_id:
                return QueueState(candidate_id, candidate_status, stdout)
    return QueueState(task_id, "unknown", stdout)


def save_parent_snapshot(
    workspace: pathlib.Path, run_id: str, touched_files: List[str]
) -> Dict[str, Dict[str, Any]]:
    snapshot: Dict[str, Dict[str, Any]] = {}
    for relative in touched_files:
        absolute = workspace / relative
        snapshot[relative] = {
            "exists": absolute.exists(),
            "content": read_text(absolute) if absolute.exists() else "",
        }
    write_json(run_dir(workspace, run_id) / "parent_snapshot.json", snapshot)
    return snapshot


def restore_parent_snapshot(workspace: pathlib.Path, run_id: str) -> None:
    manifest = read_json(run_dir(workspace, run_id) / "meta.json", {})
    required = ["touched_files", "created_files", "deleted_files", "artifact_files"]
    if manifest and not all(key in manifest for key in required):
        raise RuntimeError(f"incomplete run manifest for {run_id}")
    snapshot = read_json(run_dir(workspace, run_id) / "parent_snapshot.json", {})
    for relative in manifest.get("artifact_files", []) if manifest else []:
        (workspace / relative).unlink(missing_ok=True)
    for relative in manifest.get("created_files", []) if manifest else []:
        (workspace / relative).unlink(missing_ok=True)
    for relative, entry in snapshot.items():
        absolute = workspace / relative
        if isinstance(entry, dict):
            if entry.get("exists", False):
                write_text(absolute, str(entry.get("content", "")))
            else:
                absolute.unlink(missing_ok=True)
        else:
            write_text(absolute, str(entry))


def save_run_manifest(
    workspace: pathlib.Path, run_id: str, payload: Dict[str, Any]
) -> None:
    manifest = dict(payload)
    manifest.setdefault("touched_files", [])
    manifest.setdefault("created_files", [])
    manifest.setdefault("deleted_files", [])
    manifest.setdefault("artifact_files", [])
    write_json(run_dir(workspace, run_id) / "meta.json", manifest)


def load_pending_result(workspace: pathlib.Path, run_id: str) -> Dict[str, Any]:
    return read_json(run_dir(workspace, run_id) / "pending_result.json", {})


def save_pending_result(
    workspace: pathlib.Path, run_id: str, payload: Dict[str, Any]
) -> None:
    write_json(run_dir(workspace, run_id) / "pending_result.json", payload)


def append_run_event(
    workspace: pathlib.Path, run_id: str, event_type: str, payload: Dict[str, Any]
) -> None:
    append_jsonl(
        run_dir(workspace, run_id) / "events.jsonl",
        {
            "type": event_type,
            "timestamp": now_iso(),
            "payload": payload,
        },
    )


def candidate_mutation_templates() -> List[Dict[str, Any]]:
    return [
        {
            "change_class": "objective",
            "family": "objective.loss",
            "proposal_id": "template-objective",
            "change_unit": "objective-stability-loss-v2",
            "files_to_touch": ["src/config.json"],
            "target_file": "src/config.json",
            "params": {"key": "objective_mode", "value": "stability_loss_v2"},
            "minimal_ablation": "keep the model fixed and revert only objective_mode",
            "why_not_parameter_only": "changes the training objective family rather than a scalar hyperparameter",
        },
        {
            "change_class": "representation",
            "family": "repr.feature",
            "proposal_id": "template-representation",
            "change_unit": "strategy-variant-2",
            "files_to_touch": ["src/strategy.txt"],
            "target_file": "src/strategy.txt",
            "params": {"search": "baseline", "replace": "variant_2"},
            "minimal_ablation": "keep objective and architecture fixed while reverting only strategy",
            "why_not_parameter_only": "changes a representation toggle rather than only a scalar",
        },
        {
            "change_class": "architecture",
            "family": "arch.backbone",
            "proposal_id": "template-architecture",
            "change_unit": "module-variant-2",
            "files_to_touch": ["src/module.ts"],
            "target_file": "src/module.ts",
            "params": {"content": "export const variant = 2;\n"},
            "minimal_ablation": "keep objective and representation fixed while reverting only module variant",
            "why_not_parameter_only": "changes the module implementation marker",
        },
    ]


def select_candidate_mutation(
    workspace: pathlib.Path, goal: Dict[str, Any]
) -> Dict[str, Any]:
    def family_from_redirect(text: str) -> Optional[str]:
        lowered = str(text or "").lower()
        if (
            "repr.feature" in lowered
            or "representation" in lowered
            or "表征" in lowered
        ):
            return "repr.feature"
        if "arch.backbone" in lowered or "architecture" in lowered or "结构" in lowered:
            return "arch.backbone"
        if (
            "objective.loss" in lowered
            or "objective" in lowered
            or "目标函数" in lowered
        ):
            return "objective.loss"
        return None

    def metric_path_signature(value: Any) -> str:
        if isinstance(value, list):
            return (
                "->".join(str(item).strip() for item in value if str(item).strip())
                or "generic-path"
            )
        if isinstance(value, str):
            return value.strip() or "generic-path"
        return "generic-path"

    def metric_path_match_bonus(stored: str, current: str) -> float:
        if stored == current:
            return 1.0
        stored_parts = [part for part in stored.split("->") if part]
        current_parts = [part for part in current.split("->") if part]
        overlap = len(set(stored_parts) & set(current_parts))
        return 0.2 * overlap

    def classify_failure_type(failure_signature: str) -> str:
        lowered = str(failure_signature or "").lower()
        if any(token in lowered for token in ["repo", "path", "侵入", "workspace"]):
            return "repo_mismatch"
        if any(
            token in lowered for token in ["compute", "gpu", "oom", "timeout", "memory"]
        ):
            return "compute_mismatch"
        if any(
            token in lowered
            for token in ["stability", "loss", "中间指标", "metric", "stalled"]
        ):
            return "causal_path_failure"
        if any(token in lowered for token in ["bias", "shortcut", "捷径", "伪泛化"]):
            return "shortcut_failure"
        return "generic_underperform"

    session = load_session(session_path(workspace))
    cooldowns = {
        family: int(remaining)
        for family, remaining in dict(session.get("family_cooldowns", {})).items()
        if int(remaining) > 0
    }
    history = [
        item
        for item in read_jsonl(attempts_path(workspace))
        if item.get("kind") == "candidate"
    ]
    round_index = len(history) + 1
    templates = candidate_mutation_templates()
    available = [
        mutation for mutation in templates if mutation["family"] not in cooldowns
    ]
    if not available:
        return {
            "review_blocked": True,
            "reason": "all_candidate_families_on_cooldown",
            "cooldowns": cooldowns,
        }
    redirect_family = None
    if history:
        last = history[-1]
        if str(last.get("decision") or "") in {"discard", "crash"}:
            redirect_family = family_from_redirect(
                str(last.get("redirect_if_underperforming") or "")
            )
    if redirect_family is None:
        direction_memory_v2 = dict(session.get("direction_memory_v2", {}))
        current_round = int(session.get("iteration_count", 0)) + 1
        last_failure_signature = (
            str(history[-1].get("failure_signature") or "generic-underperform")
            if history
            else "generic-underperform"
        )
        last_failure_type = classify_failure_type(last_failure_signature)
        last_metric_path = (
            metric_path_signature(history[-1].get("causal_metric_path"))
            if history
            else "generic-path"
        )
        last_family = str(history[-1].get("family") or "") if history else ""
        candidate_keys = (
            [
                f"{last_family}|{last_failure_type}|{last_metric_path}",
                f"{last_family}|{last_failure_type}|generic-path",
                f"{last_family}|generic_underperform|{last_metric_path}",
                f"{last_family}|generic_underperform|generic-path",
            ]
            if last_family
            else []
        )
        for key in candidate_keys:
            edges = dict(direction_memory_v2.get(key, {}))
            if not edges:
                continue
            ranked = []
            for next_family, payload in edges.items():
                entry = dict(payload)
                last_round = int(entry.get("last_round", current_round))
                effective = max(
                    0.0,
                    float(entry.get("weight", 0.0))
                    - 0.25 * max(0, current_round - last_round),
                )
                confidence = float(entry.get("confidence", 0.5))
                effective *= max(0.2, confidence + 0.5)
                effective += metric_path_match_bonus(
                    str(entry.get("metric_path_signature", "generic-path")),
                    last_metric_path,
                )
                ranked.append((effective, next_family))
            ranked.sort(reverse=True)
            if ranked and ranked[0][0] > 0:
                redirect_family = ranked[0][1]
                break
    if redirect_family is None:
        direction_memory = dict(session.get("direction_memory", {}))
        for source_family, payload in direction_memory.items():
            if source_family in cooldowns:
                continue
            redirect_family = family_from_redirect(
                str(payload.get("reason") or payload.get("next_family") or "")
            )
            if redirect_family:
                break
    if redirect_family is None:
        memory = dict(session.get("redirect_memory", {}))
        for bucket in memory.values():
            if not bucket:
                continue
            redirect_family = family_from_redirect(
                str(bucket[-1].get("redirect") or "")
            )
            if redirect_family:
                break
    mutation = None
    if redirect_family:
        for candidate in available:
            if candidate["family"] == redirect_family:
                mutation = dict(candidate)
                break
    if mutation is None:
        mutation = dict(available[(round_index - 1) % len(available)])
    mutation["proposal_id"] = (
        f"proposal-round-{round_index:04d}-{mutation['change_class']}"
    )
    return mutation


def evaluate_command(
    goal: Dict[str, Any], workspace: pathlib.Path, command: str
) -> float:
    result = run_checked(command, workspace)
    metric = extract_metric(
        result.stdout.strip() or result.stderr.strip(),
        goal.get("metric_extract_rule", "number"),
        goal.get("paths", {}).get("metric_key"),
    )
    metric_file = workspace / goal.get("paths", {}).get(
        "metrics_file", "experiments/metrics.json"
    )
    metric_key = goal.get("paths", {}).get("metric_key", "score")
    write_metric_file(metric_file, metric_key, metric)
    return metric


def run_stage(goal: Dict[str, Any], workspace: pathlib.Path, stage: str) -> float:
    command = goal.get("commands", {}).get(stage) or goal.get("eval_command")
    if not command:
        raise RuntimeError(f"missing command for stage {stage}")
    return evaluate_command(goal, workspace, command)


def load_run_events(workspace: pathlib.Path, run_id: str) -> List[Dict[str, Any]]:
    return read_jsonl(run_dir(workspace, run_id) / "events.jsonl")


def workspace_from_goal(
    path: pathlib.Path, explicit_workspace: Optional[str]
) -> pathlib.Path:
    goal = load_goal(path)
    if explicit_workspace:
        return pathlib.Path(explicit_workspace).resolve()
    raw = goal.get("workspace_root")
    if raw:
        candidate = pathlib.Path(str(raw))
        if not candidate.is_absolute():
            candidate = (path.parent / candidate).resolve()
        else:
            candidate = candidate.resolve()
        return candidate
    return path.parent.parent.resolve()


def emit_json(value: Any) -> None:
    json.dump(value, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
