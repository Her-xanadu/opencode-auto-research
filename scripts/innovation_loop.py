#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import pathlib
import signal
import subprocess
import sys
import time

from kb.common import (
    experiments_research_dir,
    feedback_output_path,
    frontier_map_output_path,
    index_output_dir,
    load_research_config,
    posterior_rank_output_path,
)

from ae_common import (
    attempts_path,
    best_path,
    candidate_mutation_templates,
    clear_controller_artifacts,
    controller_is_running,
    controller_pid_path,
    controller_status_path,
    controller_stop_path,
    current_best_metric,
    decrement_family_cooldowns,
    emit_json,
    ensure_repo_bootstrap_for_dvc,
    ensure_controller_not_running,
    load_goal,
    load_yaml_like,
    opencode_agent_model,
    proposal_round_path,
    read_json,
    read_jsonl,
    result_packet_path,
    run_opencode_agent,
    load_session,
    now_iso,
    save_session,
    select_candidate_mutation,
    set_session_stage,
    session_path,
    workspace_from_goal,
    write_json,
)


def run_python(script: str, *args: str, cwd: pathlib.Path) -> dict:
    command = [
        sys.executable,
        str((pathlib.Path(__file__).resolve().parent / script).resolve()),
        *args,
    ]
    result = subprocess.run(command, cwd=str(cwd), capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout or f"{script} failed")
    return json.loads(result.stdout)


def research_config_path(workspace: pathlib.Path) -> pathlib.Path:
    candidate = workspace / "configs" / "research_brain.yaml"
    return (
        candidate
        if candidate.exists()
        else pathlib.Path(__file__).resolve().parent.parent
        / "configs"
        / "research_brain.yaml"
    )


def ensure_research_index(
    workspace: pathlib.Path, config_path: pathlib.Path, config: dict
) -> pathlib.Path:
    output_dir = index_output_dir(workspace, config)
    paper_index = output_dir / "paper-index.jsonl"
    if paper_index.exists() and paper_index.stat().st_size > 0:
        return output_dir
    run_python(
        "kb/build_index.py",
        "--vault-root",
        str(config.get("vault_root")),
        "--workspace-root",
        str(workspace),
        "--config",
        str(config_path),
        "--output-dir",
        str(output_dir),
        "--scaffold-missing",
        "--extract-claims",
        cwd=workspace,
    )
    return output_dir


def collect_round_research_context(
    workspace: pathlib.Path, goal: dict, round_index: int
) -> dict:
    config_path = research_config_path(workspace)
    config = load_research_config(config_path)
    ensure_research_index(workspace, config_path, config)
    inference = run_python(
        "kb/run_inference_cycle.py",
        "--workspace-root",
        str(workspace),
        "--config",
        str(config_path),
        "--round",
        str(round_index),
        cwd=workspace,
    )
    if inference.get("skipped"):
        selected = []
        retrieval = {"output": None, "innovation_briefs": {}}
        evidence = {"output": None}
    else:
        retrieval = dict(inference.get("retrieval", {}))
        evidence = dict(inference.get("evidence", {}))
        selected = retrieval.get("selected", [])
    return {
        "research_context_id": f"research-round-{round_index:04d}",
        "retrieval_path": retrieval.get("output"),
        "evidence_pack_path": evidence.get("output"),
        "selected": selected,
        "innovation_briefs": retrieval.get("innovation_briefs", {}),
        "config_path": str(config_path),
        "config": config,
    }


def build_paper_grounding(research_context: dict, role: str) -> list[dict]:
    selected = list(research_context.get("selected", []))
    relevant = [paper for paper in selected if paper.get("slot") == "relevant"]
    orthogonal = [paper for paper in selected if paper.get("slot") == "orthogonal"]
    cautionary = [paper for paper in selected if paper.get("slot") == "cautionary"]
    if role == "Hermes":
        ordered = (orthogonal or []) + relevant + cautionary
    else:
        ordered = relevant + orthogonal + cautionary
    role_brief = dict(research_context.get("innovation_briefs", {})).get(
        role.lower(), {}
    )
    lead_paper_id = role_brief.get("lead_paper_id")
    support_paper_id = role_brief.get("support_paper_id")
    guard_paper_id = role_brief.get("guard_paper_id")
    semantic_order = []
    for preferred_id in [lead_paper_id, support_paper_id, guard_paper_id]:
        if preferred_id:
            matched = next(
                (
                    paper
                    for paper in ordered
                    if str(paper.get("paper_id") or "") == str(preferred_id)
                ),
                None,
            )
            if matched is not None:
                semantic_order.append(matched)
    for paper in ordered:
        if paper not in semantic_order:
            semantic_order.append(paper)
    grounding = []
    seen = set()
    for paper in semantic_order:
        paper_id = str(paper.get("paper_id") or "").strip()
        if not paper_id or paper_id in seen:
            continue
        seen.add(paper_id)
        grounding.append(
            {
                "paper_id": paper_id,
                "title": paper.get("title_zh") or paper.get("title_en"),
                "slot": paper.get("slot"),
                "why_relevant": role_brief.get("hypothesis_seed")
                or f"slot={paper.get('slot')} score={paper.get('score', 0)}",
                "grounding_role": (
                    "lead"
                    if paper_id == str(lead_paper_id)
                    else "support"
                    if paper_id == str(support_paper_id)
                    else "guard"
                    if paper_id == str(guard_paper_id)
                    else str(paper.get("slot") or "fallback")
                ),
                "mechanism_transfer": "；".join(
                    (
                        paper.get("mechanism_claims")
                        or paper.get("transfer_hints")
                        or [str(paper.get("summary") or "")]
                    )[:2]
                )[:220],
                "risk_guardrail": "；".join(
                    (
                        paper.get("negative_lessons")
                        or paper.get("limitation_claims")
                        or []
                    )[:2]
                )[:160],
                "mechanism_unit": (paper.get("mechanism_units") or [{}])[0],
                "metric_path": (paper.get("metric_paths") or [[]])[0],
                "grounding_confidence": paper.get("grounding_confidence"),
            }
        )
        if len(grounding) >= 2:
            break
    return grounding


def prompt_ready_research_context(research_context: dict, role: str) -> dict:
    selected = list(research_context.get("selected", []))
    papers = []
    for paper in selected[:4]:
        papers.append(
            {
                "paper_id": paper.get("paper_id"),
                "slot": paper.get("slot"),
                "title": paper.get("title_zh") or paper.get("title_en"),
                "family_tags": paper.get("family_tags", []),
                "mechanism_claims": (paper.get("mechanism_claims") or [])[:2],
                "transfer_hints": (paper.get("transfer_hints") or [])[:2],
                "negative_lessons": (paper.get("negative_lessons") or [])[:2],
                "mechanism_units": (paper.get("mechanism_units") or [])[:3],
                "innovation_potential": paper.get("innovation_potential"),
                "cautionary_score": paper.get("cautionary_score"),
            }
        )
    return {
        "research_context_id": research_context.get("research_context_id"),
        "evidence_pack_path": research_context.get("evidence_pack_path"),
        "innovation_brief": dict(research_context.get("innovation_briefs", {})).get(
            role.lower(), {}
        ),
        "selected_papers": papers,
    }


def enrich_mutation_with_research(
    mutation: dict, research_context: dict, role: str
) -> dict:
    enriched = dict(mutation)
    enriched["paper_grounding"] = build_paper_grounding(research_context, role)
    enriched["evidence_pack_path"] = research_context.get("evidence_pack_path")
    enriched["research_context_id"] = research_context.get("research_context_id")
    return enriched


def proposal_validation_error(proposal: dict, goal: dict) -> str | None:
    grounding = proposal.get("paper_grounding") or []
    unique_paper_ids = {
        str(item.get("paper_id") or "").strip()
        for item in grounding
        if str(item.get("paper_id") or "").strip()
    }
    if len(unique_paper_ids) < 2:
        return "proposal_missing_two_unique_paper_ids"
    if not proposal.get("family"):
        return "proposal_missing_family"
    minimal_ablation = proposal.get("minimal_ablation")
    if isinstance(minimal_ablation, list):
        if not any(str(item).strip() for item in minimal_ablation):
            return "proposal_missing_minimal_ablation"
    elif not str(minimal_ablation or "").strip():
        return "proposal_missing_minimal_ablation"
    files_to_touch = proposal.get("files_to_touch") or []
    if not files_to_touch:
        return "proposal_missing_files_to_touch"
    if (
        goal.get("innovation", {}).get("reject_parameter_only", True)
        and not str(proposal.get("why_not_parameter_only") or "").strip()
    ):
        return "proposal_missing_non_parameter_justification"
    return None


def record_research_feedback(
    workspace: pathlib.Path, research_context: dict, judged: dict
) -> None:
    record = judged.get("record") or {}
    config = research_context.get("config") or load_research_config(
        research_config_path(workspace)
    )
    feedback_path = feedback_output_path(workspace, config)
    feedback_input = {
        "round": record.get("round"),
        "proposal_family": record.get("family"),
        "decision": record.get("decision"),
        "metric_gain": float(record.get("current_metric") or 0.0)
        - float(record.get("baseline_metric") or 0.0),
        "repo_fit": "high" if record.get("decision") == "keep" else "medium",
        "failure_mode": record.get("reject_reason"),
        "note": f"research_context_id={record.get('research_context_id')}",
        "paper_grounding": record.get("paper_grounding", []),
        "evidence_pack_path": record.get("evidence_pack_path"),
    }
    run_python(
        "kb/update_paper_feedback.py",
        "--input-json",
        json.dumps(feedback_input, ensure_ascii=False),
        "--output",
        str(feedback_path),
        cwd=workspace,
    )
    run_python(
        "kb/rank_transferability.py",
        "--feedback",
        str(feedback_path),
        "--output",
        str(posterior_rank_output_path(workspace, config)),
        "--workspace-root",
        str(workspace),
        "--config",
        str(research_context.get("config_path")),
        "--frontier-map",
        str(frontier_map_output_path(workspace, config)),
        cwd=workspace,
    )


def proposal_payload_from_mutation(mutation: dict, mechanism: str, risk: str) -> dict:
    change_class = str(mutation.get("change_class") or "objective")
    tags = {
        "objective": ["objective"],
        "representation": ["representation"],
        "architecture": ["architecture"],
    }.get(change_class, ["objective"])
    return {
        "title": mutation.get("change_unit"),
        "family": mutation.get("family"),
        "innovation_tags": tags,
        "mechanism": mechanism,
        "files_to_touch": mutation.get("files_to_touch", []),
        "expected_gain": 0.02,
        "risk": risk,
        "why_not_parameter_only": mutation.get("why_not_parameter_only"),
        "smoke_checks": ["syntax_check", "smoke_eval", "proxy_eval"],
        "proxy_plan": {"epochs": 1, "data_fraction": 0.2},
        "minimal_ablation": [mutation.get("minimal_ablation")],
        "proposal_id": mutation.get("proposal_id"),
        "change_class": mutation.get("change_class"),
        "change_unit": mutation.get("change_unit"),
        "target_file": mutation.get("target_file"),
        "params": mutation.get("params", {}),
        "paper_grounding": mutation.get("paper_grounding", []),
        "evidence_pack_path": mutation.get("evidence_pack_path"),
        "research_context_id": mutation.get("research_context_id"),
        "redirect_if_underperforming": mutation.get("redirect_if_underperforming"),
        "causal_metric_path": mutation.get("causal_metric_path"),
        "failure_signature": mutation.get("failure_signature"),
        "pivot_after_failure": mutation.get("pivot_after_failure"),
    }


def family_from_redirect_hint(text: str) -> str | None:
    lowered = str(text or "").lower()
    if "repr.feature" in lowered or "representation" in lowered or "表征" in lowered:
        return "repr.feature"
    if "arch.backbone" in lowered or "architecture" in lowered or "结构" in lowered:
        return "arch.backbone"
    if "objective.loss" in lowered or "objective" in lowered or "目标函数" in lowered:
        return "objective.loss"
    return None


def first_guardrail(research_context: dict) -> str | None:
    guardrails = (
        dict(research_context.get("innovation_briefs", {}))
        .get("athena", {})
        .get("guardrails", [])
    )
    return (
        guardrails[0]
        if guardrails
        else "若中间指标不变、归因不清或重复同一路线仍无增益，则应立即改向。"
    )


def write_round_proposals(
    workspace: pathlib.Path, round_index: int, mutation: dict, research_context: dict
) -> dict:
    change_class = str(mutation.get("change_class") or "objective")
    fallback_mutations = {
        "objective": {
            "change_class": "architecture",
            "family": "arch.backbone",
            "proposal_id": f"proposal-round-{round_index:04d}-fallback-architecture",
            "change_unit": "module-variant-1",
            "files_to_touch": ["src/module.ts"],
            "target_file": "src/module.ts",
            "params": {"content": "export const variant = 1;\n"},
            "minimal_ablation": "revert only the module variant",
            "why_not_parameter_only": "changes the architecture marker",
        },
        "representation": {
            "change_class": "objective",
            "family": "objective.loss",
            "proposal_id": f"proposal-round-{round_index:04d}-fallback-objective",
            "change_unit": "objective-stability-loss-v2",
            "files_to_touch": ["src/config.json"],
            "target_file": "src/config.json",
            "params": {"key": "objective_mode", "value": "stability_loss_v2"},
            "minimal_ablation": "revert only objective_mode",
            "why_not_parameter_only": "changes the objective family",
        },
        "architecture": {
            "change_class": "representation",
            "family": "repr.feature",
            "proposal_id": f"proposal-round-{round_index:04d}-fallback-representation",
            "change_unit": "strategy-variant-3",
            "files_to_touch": ["src/strategy.txt"],
            "target_file": "src/strategy.txt",
            "params": {"search": "baseline", "replace": "variant_3"},
            "minimal_ablation": "revert only strategy",
            "why_not_parameter_only": "changes the representation path",
        },
    }
    fallback = fallback_mutations.get(change_class, fallback_mutations["objective"])
    grounded_mutation = enrich_mutation_with_research(
        mutation, research_context, "Apollo"
    )
    grounded_mutation["redirect_if_underperforming"] = (
        dict(research_context.get("innovation_briefs", {}))
        .get("apollo", {})
        .get("composed_hypothesis")
    )
    grounded_mutation["causal_metric_path"] = (
        dict(research_context.get("innovation_briefs", {}))
        .get("apollo", {})
        .get("falsifiable_prediction")
    )
    grounded_mutation["failure_signature"] = first_guardrail(research_context)
    grounded_mutation["pivot_after_failure"] = grounded_mutation[
        "redirect_if_underperforming"
    ]
    grounded_fallback = enrich_mutation_with_research(
        fallback, research_context, "Hermes"
    )
    grounded_fallback["redirect_if_underperforming"] = (
        dict(research_context.get("innovation_briefs", {}))
        .get("hermes", {})
        .get("composed_hypothesis")
    )
    grounded_fallback["causal_metric_path"] = (
        dict(research_context.get("innovation_briefs", {}))
        .get("hermes", {})
        .get("falsifiable_prediction")
    )
    grounded_fallback["failure_signature"] = first_guardrail(research_context)
    grounded_fallback["pivot_after_failure"] = grounded_fallback[
        "redirect_if_underperforming"
    ]
    proposals = {
        "Apollo": proposal_payload_from_mutation(
            grounded_mutation,
            "Exploit the current best family with a single attributable structural change.",
            "low",
        ),
        "Athena": proposal_payload_from_mutation(
            grounded_mutation,
            "Accept only a measurable, single-family change with clean attribution.",
            "low",
        ),
        "Hermes": proposal_payload_from_mutation(
            grounded_fallback,
            "Offer one orthogonal but still testable alternative family.",
            "medium",
        ),
    }
    payload = {
        "round": round_index,
        "created_at": now_iso(),
        "proposals": proposals,
        "next_primary_hypothesis": proposals["Apollo"],
        "fallback_hypothesis": proposals["Hermes"],
        "research_context_id": research_context.get("research_context_id"),
        "evidence_pack_path": research_context.get("evidence_pack_path"),
        "retrieval_path": research_context.get("retrieval_path"),
        "reject_reasons": {
            "Athena": "used as the validity gate, not the primary exploit proposal",
            "Hermes": "kept as fallback because the exploit proposal is lower risk",
        },
    }
    write_json(proposal_round_path(workspace, round_index), payload)
    return payload


def build_live_proposal_prompt(
    agent: str,
    workspace: pathlib.Path,
    goal: dict,
    round_index: int,
    recent_attempts: list,
    cooldowns: dict,
    result_packet: dict,
    research_context: dict,
) -> str:
    if os.environ.get("INNOVATION_LOOP_LIVE_TEST_MODE") == "1":
        scripted_choice = "objective" if agent == "Apollo" else "architecture"
        grounding = build_paper_grounding(research_context, agent)
        return json.dumps(
            {
                "choice": scripted_choice,
                "title": f"scripted-{scripted_choice}",
                "family": "objective.loss"
                if scripted_choice == "objective"
                else "arch.backbone",
                "innovation_tags": [scripted_choice],
                "mechanism": f"scripted smoke choice for round {round_index}",
                "files_to_touch": ["src/config.json"]
                if scripted_choice == "objective"
                else ["src/module.ts"],
                "expected_gain": 0.02,
                "risk": "low",
                "why_not_parameter_only": "changes the method family",
                "minimal_ablation": ["revert the single scripted change"],
                "paper_grounding": grounding,
                "redirect_if_underperforming": "切换到正交机制轴并停止重复当前主路线",
                "causal_metric_path": "若该动作有效，中间稳定性指标应先改善，再传导到目标指标。",
                "failure_signature": "若中间指标不变而目标指标波动，则说明当前机制解释站不住。",
                "pivot_after_failure": "切换到正交机制轴并停止重复当前主路线",
            },
            ensure_ascii=False,
        )
    role = "strongest exploit" if agent == "Apollo" else "orthogonal fallback"
    latest_metric = None
    if recent_attempts:
        latest_metric = recent_attempts[-1].get("metric") or recent_attempts[-1].get(
            "current_metric"
        )
    context = {
        "round": round_index,
        "target_threshold": goal.get("target_threshold"),
        "current_best_metric": result_packet.get("best", {}).get("metric"),
        "latest_metric": latest_metric,
        "latest_decision": recent_attempts[-1].get("decision")
        if recent_attempts
        else None,
        "cooldowns": cooldowns,
        "allowed_choices": [
            item["change_class"] for item in candidate_mutation_templates()
        ],
        "research_context": prompt_ready_research_context(research_context, agent),
        "paper_grounding_seed": build_paper_grounding(research_context, agent),
    }
    return f"""
Return exactly one JSON object and nothing else.

You are {agent}. Pick the {role} choice.

Required JSON fields:
- choice
- title
- family
- mechanism
- files_to_touch
- expected_gain
- risk
- why_not_parameter_only
- minimal_ablation
- paper_grounding
- redirect_if_underperforming
- causal_metric_path
- failure_signature
- pivot_after_failure

Rules:
- choice must be exactly one of: objective, representation, architecture
- avoid cooldown families when possible
- keep the reply short
- paper_grounding must contain at least two unique paper_id values from the evidence pack

Context: {json.dumps(context, ensure_ascii=False)}
""".strip()


def build_guard_prompt(
    workspace: pathlib.Path, primary: dict, backup: dict | None, research_context: dict
) -> str:
    if os.environ.get("INNOVATION_LOOP_LIVE_TEST_MODE") == "1":
        return 'Return exactly {"verdict":"approve","validity_risks":[],"smallest_repair":"","single_change_ok":true,"paper_support_ok":true,"redirect_if_underperforming":"切换到正交机制轴并停止重复当前主路线","failure_signature":"若中间指标不变而目标指标波动，则说明当前机制解释站不住。"}.'
    context = {
        "primary_choice": primary.get("choice"),
        "backup_choice": backup.get("choice") if backup else None,
        "research_context": prompt_ready_research_context(research_context, "Athena"),
        "primary_grounding": primary.get("paper_grounding", []),
        "latest_redirect_hint": primary.get("redirect_if_underperforming"),
    }
    return f"""
Return exactly one JSON object and nothing else.

Evaluate whether the primary choice should be approved.

Required JSON fields:
- verdict (approve|veto)
- validity_risks
- smallest_repair
- single_change_ok
- paper_support_ok
- redirect_if_underperforming
- failure_signature

Keep the reply short.
Context:
{json.dumps(context, ensure_ascii=False)}
""".strip()


def materialize_live_choice(
    raw: dict, round_index: int, research_context: dict, role: str
) -> dict:
    choice = str(raw.get("choice", "objective"))
    templates = {item["change_class"]: item for item in candidate_mutation_templates()}
    if choice not in templates:
        raise RuntimeError(f"unsupported live choice: {choice}")
    template = dict(templates[choice])
    template["proposal_id"] = f"proposal-round-{round_index:04d}-{choice}"
    template["title"] = raw.get("title") or template["change_unit"]
    template["innovation_tags"] = raw.get("innovation_tags") or [choice]
    template["mechanism"] = raw.get("mechanism") or "selected exploit recipe"
    template["expected_gain"] = float(raw.get("expected_gain", 0.02))
    template["risk"] = str(raw.get("risk", "low"))
    template["why_not_parameter_only"] = raw.get(
        "why_not_parameter_only"
    ) or template.get("why_not_parameter_only")
    template["minimal_ablation"] = raw.get("minimal_ablation") or [
        template.get("minimal_ablation")
    ]
    template["paper_grounding"] = raw.get("paper_grounding") or build_paper_grounding(
        research_context, role
    )
    default_redirect = (
        dict(research_context.get("innovation_briefs", {}))
        .get(role.lower(), {})
        .get("composed_hypothesis")
    )
    template["redirect_if_underperforming"] = (
        raw.get("redirect_if_underperforming") or default_redirect
    )
    template["causal_metric_path"] = raw.get("causal_metric_path") or dict(
        research_context.get("innovation_briefs", {})
    ).get(role.lower(), {}).get("falsifiable_prediction")
    template["failure_signature"] = raw.get("failure_signature") or first_guardrail(
        research_context
    )
    template["pivot_after_failure"] = raw.get("pivot_after_failure") or template.get(
        "redirect_if_underperforming"
    )
    template["evidence_pack_path"] = research_context.get("evidence_pack_path")
    template["research_context_id"] = research_context.get("research_context_id")
    template["smoke_checks"] = ["syntax_check", "smoke_eval", "proxy_eval"]
    template["proxy_plan"] = {"epochs": 1, "data_fraction": 0.2}
    return template


def collect_live_round_proposals(
    workspace: pathlib.Path, goal: dict, round_index: int, research_context: dict
) -> dict:
    session = load_session(session_path(workspace))
    cooldowns = {
        family: int(remaining)
        for family, remaining in dict(session.get("family_cooldowns", {})).items()
        if int(remaining) > 0
    }
    recent_attempts = read_jsonl(attempts_path(workspace))[-5:]
    result_packet = read_json(result_packet_path(workspace), {})
    exploit_raw = run_opencode_agent(
        "Apollo",
        build_live_proposal_prompt(
            "Apollo",
            workspace,
            goal,
            round_index,
            recent_attempts,
            cooldowns,
            result_packet,
            research_context,
        ),
    )
    divergence_raw = run_opencode_agent(
        "Hermes",
        build_live_proposal_prompt(
            "Hermes",
            workspace,
            goal,
            round_index,
            recent_attempts,
            cooldowns,
            result_packet,
            research_context,
        ),
    )
    guard = run_opencode_agent(
        "Athena",
        build_guard_prompt(workspace, exploit_raw, divergence_raw, research_context),
    )

    exploit = materialize_live_choice(
        exploit_raw, round_index, research_context, "Apollo"
    )
    divergence = materialize_live_choice(
        divergence_raw, round_index, research_context, "Hermes"
    )

    chosen = exploit
    reject_reasons = {
        "Athena": "approved the exploit proposal",
        "Hermes": "kept as fallback while exploit remained valid",
    }
    if str(guard.get("verdict", "approve")).lower() != "approve" or not bool(
        guard.get("single_change_ok", False)
    ):
        chosen = divergence
        reject_reasons = {
            "Apollo": (
                guard.get("smallest_repair")
                or "; ".join(guard.get("validity_risks", []))
                or "vetoed by Athena"
            ),
            "Athena": "vetoed the exploit proposal",
        }

    if recent_attempts:
        last_attempt = recent_attempts[-1]
        if str(last_attempt.get("decision") or "") in {"discard", "crash"} and str(
            last_attempt.get("family") or ""
        ) == str(chosen.get("family") or ""):
            if divergence.get("family") != chosen.get("family"):
                chosen = divergence
                reject_reasons["controller_redirect"] = (
                    last_attempt.get("redirect_if_underperforming")
                    or "previous direction underperformed; pivoting to orthogonal route"
                )

    if chosen.get("family") in cooldowns:
        return {
            "review_blocked": True,
            "reason": "all_candidate_families_on_cooldown",
            "cooldowns": cooldowns,
        }

    payload = {
        "round": round_index,
        "created_at": now_iso(),
        "execution_mode": "live",
        "model": opencode_agent_model(),
        "research_context_id": research_context.get("research_context_id"),
        "evidence_pack_path": research_context.get("evidence_pack_path"),
        "retrieval_path": research_context.get("retrieval_path"),
        "proposals": {
            "Apollo": exploit,
            "Athena": {
                **guard,
                "family": guard.get("family", exploit.get("family")),
                "redirect_if_underperforming": guard.get("redirect_if_underperforming"),
            },
            "Hermes": divergence,
        },
        "next_primary_hypothesis": chosen,
        "fallback_hypothesis": divergence if chosen is exploit else exploit,
        "reject_reasons": reject_reasons,
    }
    write_json(proposal_round_path(workspace, round_index), payload)
    return {"mutation": chosen, "proposals": payload}


def select_round_mutation(
    workspace: pathlib.Path,
    goal: dict,
    round_index: int,
    mode: str,
    research_context: dict,
) -> dict:
    if mode == "live":
        return collect_live_round_proposals(
            workspace, goal, round_index, research_context
        )
    mutation = select_candidate_mutation(workspace, goal)
    if mutation.get("review_blocked"):
        return mutation
    return {
        "mutation": enrich_mutation_with_research(mutation, research_context, "Apollo"),
        "proposals": write_round_proposals(
            workspace, round_index, mutation, research_context
        ),
    }


def tick(config_path: pathlib.Path, workspace: pathlib.Path, mode: str) -> dict:
    goal = load_goal(config_path)
    session_file = session_path(workspace)
    session = load_session(session_file)
    status_file = controller_status_path(workspace)

    if session.get("best_run_id") is None:
        baseline = run_python(
            "run_baseline.py",
            "--config",
            str(config_path),
            "--workspace",
            str(workspace),
            cwd=workspace,
        )
        session = load_session(session_file)
        save_session(session_file, session)
        write_json(
            status_file,
            {"phase": "baseline", "updated_at": now_iso(), "baseline": baseline},
        )
        return {"phase": "baseline", "baseline": baseline}

    active = session.get("active_dvc_task")
    if active:
        polled = run_python(
            "status_poll.py",
            "--config",
            str(config_path),
            "--workspace",
            str(workspace),
            "--task-id",
            active,
            cwd=workspace,
        )
        if polled["status"] in {"queued", "running"}:
            session["active_run_id"] = active
            set_session_stage(
                session, polled["status"], f"dvc task {active} is {polled['status']}"
            )
            save_session(session_file, session)
            write_json(
                status_file, {"phase": "poll", "updated_at": now_iso(), "poll": polled}
            )
            return {"phase": "poll", "poll": polled}
        if polled["status"] == "failed":
            session["active_run_id"] = active
            set_session_stage(session, "crash_recoverable", f"dvc task {active} failed")
            save_session(session_file, session)
            write_json(
                status_file,
                {"phase": "failed", "updated_at": now_iso(), "poll": polled},
            )
            return {"phase": "failed", "poll": polled}
        judged = run_python(
            "judge_result.py",
            "--config",
            str(config_path),
            "--workspace",
            str(workspace),
            "--run-id",
            active,
            "--monitor-state",
            polled["status"],
            cwd=workspace,
        )
        research_context = {
            "config_path": str(research_config_path(workspace)),
            "config": load_research_config(research_config_path(workspace)),
        }
        record_research_feedback(workspace, research_context, judged)
        session = load_session(session_file)
        if judged["status"] == "keep" and current_best_metric(workspace) is not None:
            if float(current_best_metric(workspace) or 0.0) >= float(
                goal.get("target_threshold") or 0.0
            ):
                session["stop_reason"] = "goal_reached"
                set_session_stage(session, "completed", "target threshold reached")
                save_session(session_file, session)
                write_json(
                    status_file,
                    {
                        "phase": "done",
                        "updated_at": now_iso(),
                        "poll": polled,
                        "judge": judged,
                        "reason": "goal_reached",
                    },
                )
                return {
                    "phase": "done",
                    "reason": "goal_reached",
                    "poll": polled,
                    "judge": judged,
                }
        save_session(session_file, session)
        write_json(
            status_file,
            {
                "phase": "judge",
                "updated_at": now_iso(),
                "poll": polled,
                "judge": judged,
            },
        )
        return {"phase": "judge", "poll": polled, "judge": judged}

    if int(session.get("iteration_count", 0)) >= int(goal.get("max_rounds", 3)):
        session["stop_reason"] = "budget_exhausted"
        set_session_stage(session, "completed", "budget exhausted")
        save_session(session_file, session)
        write_json(
            status_file,
            {"phase": "done", "updated_at": now_iso(), "reason": "budget_exhausted"},
        )
        return {"phase": "done", "reason": "budget_exhausted"}

    session = decrement_family_cooldowns(session)
    save_session(session_file, session)
    run_python(
        "repo_snapshot.py",
        "--config",
        str(config_path),
        "--workspace",
        str(workspace),
        cwd=workspace,
    )
    round_index = int(session.get("iteration_count", 0)) + 1
    research_context = collect_round_research_context(workspace, goal, round_index)
    round_selection = select_round_mutation(
        workspace, goal, round_index, mode, research_context
    )
    mutation = round_selection.get("mutation", round_selection)
    if mutation.get("review_blocked"):
        session["stop_reason"] = "review_blocked"
        set_session_stage(
            session,
            "review_blocked",
            str(mutation.get("reason") or "review blocked"),
        )
        save_session(session_file, session)
        write_json(
            status_file,
            {
                "phase": "done",
                "updated_at": now_iso(),
                "reason": "review_blocked",
                "cooldowns": mutation.get("cooldowns", {}),
            },
        )
        return {
            "phase": "done",
            "reason": "review_blocked",
            "cooldowns": mutation.get("cooldowns", {}),
        }
    proposals = round_selection.get("proposals")
    validation_error = proposal_validation_error(mutation, goal)
    if validation_error:
        if isinstance(proposals, dict):
            proposals.setdefault("reject_reasons", {})["controller"] = validation_error
            write_json(proposal_round_path(workspace, round_index), proposals)
        session["stop_reason"] = "review_blocked"
        set_session_stage(session, "review_blocked", validation_error)
        save_session(session_file, session)
        write_json(
            status_file,
            {
                "phase": "done",
                "updated_at": now_iso(),
                "reason": "review_blocked",
                "reject_reason": validation_error,
                "evidence_pack_path": research_context.get("evidence_pack_path"),
            },
        )
        return {
            "phase": "done",
            "reason": "review_blocked",
            "reject_reason": validation_error,
            "proposals": proposals,
        }
    run_id = f"round-{round_index:04d}"
    candidate = run_python(
        "run_candidate.py",
        "--config",
        str(config_path),
        "--workspace",
        str(workspace),
        "--run-id",
        run_id,
        "--proposal-json",
        json.dumps(mutation),
        "--mode",
        mode,
        cwd=workspace,
    )

    if candidate.get("queued"):
        session["active_dvc_task"] = run_id
        session["active_run_id"] = run_id
        set_session_stage(session, "queued", f"queued {run_id}")
        save_session(session_file, session)
        write_json(
            status_file,
            {
                "phase": "candidate",
                "updated_at": now_iso(),
                "candidate": candidate,
                "mutation": mutation,
                "proposals": proposals,
                "research_context": research_context,
            },
        )
        return {
            "phase": "candidate",
            "candidate": candidate,
            "mutation": mutation,
            "proposals": proposals,
            "research_context": research_context,
        }

    session = load_session(session_file)
    save_session(session_file, session)
    write_json(
        status_file,
        {
            "phase": "candidate_rejected",
            "updated_at": now_iso(),
            "candidate": candidate,
            "mutation": mutation,
            "proposals": proposals,
            "research_context": research_context,
        },
    )
    return {
        "phase": "candidate_rejected",
        "candidate": candidate,
        "mutation": mutation,
        "proposals": proposals,
        "research_context": research_context,
    }


def run_controller(
    config_path: pathlib.Path, workspace: pathlib.Path, poll_interval: float, mode: str
) -> None:
    write_json(
        controller_status_path(workspace),
        {"phase": "starting", "updated_at": now_iso()},
    )

    stop_requested = False

    def handle_stop(_signum: int, _frame: object) -> None:
        nonlocal stop_requested
        stop_requested = True
        controller_stop_path(workspace).write_text("stop\n", encoding="utf-8")

    previous_sigterm = signal.signal(signal.SIGTERM, handle_stop)
    previous_sigint = signal.signal(signal.SIGINT, handle_stop)
    try:
        while not stop_requested and not controller_stop_path(workspace).exists():
            result = tick(config_path, workspace, mode)
            if result.get("phase") == "done":
                break
            time.sleep(poll_interval)
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm)
        signal.signal(signal.SIGINT, previous_sigint)
        clear_controller_artifacts(workspace)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    for name in [
        "bootstrap",
        "start",
        "tick",
        "status",
        "resume",
        "stop",
        "_run-controller",
    ]:
        command = sub.add_parser(name)
        command.add_argument("--config", required=True)
        command.add_argument("--workspace")
        command.add_argument(
            "--mode",
            choices=["mock", "live"],
            default=os.environ.get("INNOVATION_LOOP_MODE", "mock"),
        )
        if name == "start":
            command.add_argument("--detached", action="store_true")
            command.add_argument("--poll-interval", type=float)
        if name == "_run-controller":
            command.add_argument("--poll-interval", type=float, default=0.2)

    args = parser.parse_args()
    config_path = pathlib.Path(args.config).resolve()
    workspace = workspace_from_goal(config_path, args.workspace)

    if args.command == "bootstrap":
        result = run_python(
            "repo_detect.py",
            "--workspace",
            str(workspace),
            "--write-config",
            str(config_path),
            cwd=workspace,
        )
        dvc_bootstrapped = ensure_repo_bootstrap_for_dvc(workspace)
        save_session(
            session_path(workspace),
            {
                "round": 0,
                "state": "bootstrap_completed",
                "stage": "bootstrap_completed",
                "message": "bootstrap completed",
                "iteration_count": 0,
                "active_dvc_task": None,
                "active_run_id": None,
                "best_run_id": None,
                "best_metric": None,
                "best_exp_ref": None,
                "budget_used": {"rounds": 0, "full_runs": 0},
                "stop_reason": None,
            },
        )
        emit_json({**result, "dvc_bootstrapped": dvc_bootstrapped})
        return

    if args.command == "tick":
        emit_json(tick(config_path, workspace, args.mode))
        return

    if args.command == "status":
        status = load_session(session_path(workspace))
        status["controller_running"] = controller_is_running(workspace)
        status["controller_not_running"] = not status["controller_running"]
        status["controller_status"] = (
            read_json(controller_status_path(workspace), None)
            if controller_status_path(workspace).exists()
            else None
        )
        emit_json(status)
        return

    if args.command == "resume":
        session = load_session(session_path(workspace))
        checkpoint = pathlib.Path(
            workspace / "experiments" / "recovery_checkpoint.json"
        )
        payload = (
            __import__("json").loads(checkpoint.read_text(encoding="utf-8"))
            if checkpoint.exists()
            else None
        )
        if not payload or not payload.get("checkpoint_path"):
            emit_json({"resumed": False, "reason": "no_checkpoint"})
            return
        round_selection = select_round_mutation(
            workspace,
            load_goal(config_path),
            int(session.get("iteration_count", 0)) + 1,
            args.mode,
            collect_round_research_context(
                workspace,
                load_goal(config_path),
                int(session.get("iteration_count", 0)) + 1,
            ),
        )
        mutation = round_selection.get("mutation", round_selection)
        if mutation.get("review_blocked"):
            emit_json({"resumed": False, "reason": "review_blocked"})
            return
        run_id = f"resume-{int(session.get('iteration_count', 0)) + 1:04d}"
        candidate = run_python(
            "run_candidate.py",
            "--config",
            str(config_path),
            "--workspace",
            str(workspace),
            "--run-id",
            run_id,
            "--proposal-json",
            json.dumps(mutation),
            "--resume-from",
            payload["checkpoint_path"],
            "--mode",
            args.mode,
            cwd=workspace,
        )
        session["active_dvc_task"] = run_id
        session["active_run_id"] = run_id
        set_session_stage(session, "queued", f"resumed {run_id}")
        save_session(session_path(workspace), session)
        emit_json(
            {
                "resumed": True,
                "candidate": candidate,
                "resume_from": payload["checkpoint_path"],
            }
        )
        return

    if args.command == "stop":
        controller_stop_path(workspace).write_text("stop\n", encoding="utf-8")
        if controller_pid_path(workspace).exists():
            try:
                os.kill(
                    int(controller_pid_path(workspace).read_text(encoding="utf-8")),
                    signal.SIGTERM,
                )
            except Exception:
                pass
        emit_json({"stopped": True})
        return

    if args.command == "start":
        if getattr(args, "detached", False):
            ensure_controller_not_running(workspace)
            command = [
                sys.executable,
                str(pathlib.Path(__file__).resolve()),
                "_run-controller",
                "--config",
                str(config_path),
                "--workspace",
                str(workspace),
                "--mode",
                args.mode,
                "--poll-interval",
                str(
                    args.poll_interval
                    or os.environ.get("INNOVATION_LOOP_POLL_INTERVAL", "0.2")
                ),
            ]
            process = subprocess.Popen(
                command,
                cwd=str(workspace),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            controller_pid_path(workspace).write_text(
                str(process.pid), encoding="utf-8"
            )
            emit_json(
                {
                    "detached": True,
                    "pid": process.pid,
                    "controller_pid": str(controller_pid_path(workspace)),
                }
            )
            return
        emit_json(tick(config_path, workspace, args.mode))
        return

    if args.command == "_run-controller":
        run_controller(config_path, workspace, float(args.poll_interval), args.mode)
        return


if __name__ == "__main__":
    main()
