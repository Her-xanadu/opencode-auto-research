#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any, Dict, List, Tuple

SCRIPTS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from ae_common import emit_json, read_json, read_jsonl, write_json
from common import (
    index_output_dir,
    load_research_config,
    posterior_rank_output_path,
    resolve_workspace_root,
    retrieval_cache_dir,
    score_overlap,
    tokenize,
    zh_target_object,
)
from ae_common import load_yaml_like


def load_jsonl(path: pathlib.Path) -> List[Dict[str, Any]]:
    return [row for row in read_jsonl(path) if isinstance(row, dict)]


def load_structured(path: pathlib.Path) -> Dict[str, Any]:
    if path.suffix.lower() in {".yaml", ".yml"}:
        return load_yaml_like(path)
    return read_json(path, {})


def selection_counts(config: Dict[str, Any]) -> Tuple[int, int, int, int]:
    selection = config.get("selection", {})
    return (
        int(selection.get("relevant_count", 2)),
        int(selection.get("orthogonal_count", 1)),
        int(selection.get("cautionary_count", 1)),
        int(selection.get("minimum_evidence_units", 2)),
    )


def list_text(values: List[str]) -> str:
    return "；".join([value for value in values if value][:2])


def paper_text_blob(paper: Dict[str, Any]) -> str:
    return " ".join(
        [
            str(paper.get("title_zh") or ""),
            str(paper.get("title_en") or ""),
            str(paper.get("summary") or ""),
            " ".join(paper.get("task_tags") or []),
            " ".join(paper.get("method_tags") or []),
            " ".join(paper.get("family_tags") or []),
            " ".join(paper.get("mechanism_claims") or []),
            " ".join(paper.get("transfer_hints") or []),
            " ".join(paper.get("limitation_claims") or []),
            " ".join(paper.get("negative_lessons") or []),
            " ".join(" ".join(path) for path in paper.get("metric_paths") or []),
            " ".join(
                str(unit.get("intervention") or "")
                for unit in paper.get("mechanism_units") or []
            ),
        ]
    )


def first_unit(paper: Dict[str, Any], claim_type: str | None = None) -> Dict[str, Any]:
    units = list(paper.get("mechanism_units") or [])
    if claim_type is None:
        return units[0] if units else {}
    filtered = [
        unit for unit in units if str(unit.get("claim_type") or "") == claim_type
    ]
    return filtered[0] if filtered else (units[0] if units else {})


def compatibility_score(
    lead_unit: Dict[str, Any],
    support_unit: Dict[str, Any],
    guard_unit: Dict[str, Any],
    lead_paper_id: str,
    support_paper_id: str,
    guard_paper_id: str,
) -> float:
    score = 0.0
    if lead_paper_id and support_paper_id and lead_paper_id != support_paper_id:
        score += 1.0
    if lead_unit.get("target_object") and support_unit.get("target_object"):
        if lead_unit.get("target_object") != support_unit.get("target_object"):
            score += 1.0
        else:
            score -= 0.25
    if support_unit.get("mechanism_verb") and lead_unit.get("mechanism_verb"):
        if support_unit.get("mechanism_verb") != lead_unit.get("mechanism_verb"):
            score += 0.5
    if guard_unit.get("target_object") and guard_unit.get(
        "target_object"
    ) != lead_unit.get("target_object"):
        score += 0.5
    if guard_paper_id and support_paper_id and guard_paper_id != support_paper_id:
        score += 0.25
    return round(score, 2)


def strip_period(text: str) -> str:
    return str(text or "").strip().rstrip("。；; ")


def compose_action_hypothesis(
    lead_unit: Dict[str, Any], support_unit: Dict[str, Any]
) -> str:
    lead_action = strip_period(
        lead_unit.get("action_sentence")
        or lead_unit.get("intervention")
        or "围绕主机制推进"
    )
    support_action = strip_period(
        support_unit.get("action_sentence")
        or support_unit.get("intervention")
        or "补入辅助信号"
    )
    support_action = support_action.replace("可把", "把")
    return f"先{lead_action}，再{support_action}，并保持单一主变化面。"


def prediction_sentence(lead_unit: Dict[str, Any]) -> str:
    target = zh_target_object(str(lead_unit.get("target_object") or "核心机制"))
    action = strip_period(lead_unit.get("action_sentence") or "主机制改动")
    return f"若实施“{action}”，则{target}相关中间指标应先稳定改善；若中间指标不变而目标指标上升，则该机制解释不成立。"


def metric_path_sentence(lead_unit: Dict[str, Any]) -> List[str]:
    target = str(lead_unit.get("target_object") or "")
    mapping = {
        "representation": [
            "representation_quality",
            "separation_margin",
            "target_metric",
        ],
        "objective": ["loss_shape", "optimization_stability", "target_metric"],
        "traffic structure": [
            "structure_signal",
            "cross_flow_consistency",
            "target_metric",
        ],
        "adaptation policy": [
            "adaptation_stability",
            "shift_robustness",
            "target_metric",
        ],
        "model architecture": [
            "feature_capacity",
            "generalization_margin",
            "target_metric",
        ],
        "feature pipeline": ["feature_quality", "signal_retention", "target_metric"],
    }
    return mapping.get(target, ["intermediate_signal", "target_metric"])


def killer_ablation_sentence(lead_unit: Dict[str, Any]) -> str:
    target = zh_target_object(str(lead_unit.get("target_object") or "核心机制"))
    action = strip_period(lead_unit.get("action_sentence") or "主机制改动")
    return f"仅撤去“{action}”并保持其余训练与评估条件不变；若{target}中间指标和目标指标仍保留增益，则否决该机制归因。"


def score_paper(
    paper: Dict[str, Any],
    posterior: Dict[str, Any],
    query_tokens: List[str],
    cooldowns: List[str],
    recent_families: List[str],
) -> Dict[str, Any]:
    text_blob = paper_text_blob(paper)
    overlap = score_overlap(query_tokens, text_blob)
    family_tags = [str(item) for item in paper.get("family_tags") or []]
    cautionary_score = float(paper.get("cautionary_score", 0.0))
    cautionary = cautionary_score >= 2.0
    family_match = sum(1 for family in family_tags if family in recent_families)
    cooldown_penalty = sum(1 for family in family_tags if family in cooldowns)
    posterior_row = posterior.get(str(paper.get("paper_id")), {})
    posterior_usefulness = float(posterior_row.get("posterior_usefulness", 0.0))
    innovation_potential = float(paper.get("innovation_potential", 0.0))
    transfer_count = len(paper.get("transfer_hints") or [])
    limitation_count = len(paper.get("limitation_claims") or []) + len(
        paper.get("negative_lessons") or []
    )
    metric_path_bonus = 0.4 * len(paper.get("metric_paths") or [])
    exploit_score = (
        overlap * 2.0
        + family_match * 1.5
        + innovation_potential
        + metric_path_bonus
        + posterior_usefulness
        - cooldown_penalty * 2.0
        - (1.5 if cautionary else 0.0)
    )
    orthogonal_score = (
        overlap * 1.2
        + innovation_potential
        + metric_path_bonus
        + transfer_count * 0.6
        + posterior_usefulness
        - cooldown_penalty
    )
    cautionary_rank = cautionary_score * 2.0 + limitation_count * 0.8 + overlap * 0.2
    score = exploit_score
    return {
        **paper,
        "score": round(score, 4),
        "exploit_score": round(exploit_score, 4),
        "orthogonal_score": round(orthogonal_score, 4),
        "cautionary_rank": round(cautionary_rank, 4),
        "overlap": overlap,
        "family_match": family_match,
        "cooldown_penalty": cooldown_penalty,
        "posterior_usefulness": posterior_usefulness,
        "innovation_potential": innovation_potential,
        "cautionary_score": cautionary_score,
        "cautionary": cautionary,
    }


def select_units(
    scored: List[Dict[str, Any]], config: Dict[str, Any]
) -> List[Dict[str, Any]]:
    relevant_count, orthogonal_count, cautionary_count, minimum_units = (
        selection_counts(config)
    )
    chosen: List[Dict[str, Any]] = []
    used_ids = set()

    relevant_pool = sorted(
        [paper for paper in scored if not paper.get("cautionary")],
        key=lambda item: (
            item["exploit_score"],
            item["overlap"],
            item["innovation_potential"],
        ),
        reverse=True,
    )
    for paper in relevant_pool[:relevant_count]:
        used_ids.add(paper["paper_id"])
        chosen.append({**paper, "slot": "relevant"})

    reference_families = set(chosen[0].get("family_tags") or []) if chosen else set()
    orthogonal_pool = [
        paper
        for paper in scored
        if paper["paper_id"] not in used_ids
        and (set(paper.get("family_tags") or []) - reference_families)
    ]
    orthogonal_pool = sorted(
        orthogonal_pool,
        key=lambda item: (
            item["orthogonal_score"],
            item["innovation_potential"],
            item["overlap"],
        ),
        reverse=True,
    )
    if not orthogonal_pool:
        orthogonal_pool = sorted(
            [
                paper
                for paper in scored
                if paper["paper_id"] not in used_ids and not paper.get("cautionary")
            ],
            key=lambda item: (
                item["orthogonal_score"],
                item["innovation_potential"],
                item["overlap"],
            ),
            reverse=True,
        )
    for paper in orthogonal_pool[:orthogonal_count]:
        used_ids.add(paper["paper_id"])
        chosen.append({**paper, "slot": "orthogonal"})

    cautionary_pool = sorted(
        [
            paper
            for paper in scored
            if paper["paper_id"] not in used_ids and paper.get("cautionary")
        ],
        key=lambda item: (
            item["cautionary_rank"],
            item["cautionary_score"],
            item["overlap"],
        ),
        reverse=True,
    )
    for paper in cautionary_pool[:cautionary_count]:
        used_ids.add(paper["paper_id"])
        chosen.append({**paper, "slot": "cautionary"})

    if len(chosen) < minimum_units:
        for paper in scored:
            if paper["paper_id"] in used_ids:
                continue
            used_ids.add(paper["paper_id"])
            chosen.append({**paper, "slot": "fallback"})
            if len(chosen) >= minimum_units:
                break

    return chosen


def innovation_brief_for_agent(
    agent: str, selected: List[Dict[str, Any]]
) -> Dict[str, Any]:
    relevant = [paper for paper in selected if paper.get("slot") == "relevant"]
    orthogonal = [paper for paper in selected if paper.get("slot") == "orthogonal"]
    cautionary = [paper for paper in selected if paper.get("slot") == "cautionary"]
    lead = (
        orthogonal[0]
        if agent == "Hermes" and orthogonal
        else (relevant[0] if relevant else None)
    )
    support = relevant[1] if len(relevant) > 1 else (relevant[0] if relevant else None)
    if agent == "Hermes" and relevant:
        support = relevant[0]
    guard = cautionary[0] if cautionary else None
    lead_unit = first_unit(lead, "mechanism") if lead else {}
    support_unit = first_unit(support, "transfer_hint") if support else {}
    guard_unit = (
        first_unit(guard, "negative_lesson")
        if guard
        else first_unit(guard, "limitation")
        if guard
        else {}
    )
    if lead and support:
        hypothesis = f"以{lead.get('title_zh') or lead.get('title_en')}的机制为主，并吸收{support.get('title_zh') or support.get('title_en')}的迁移启发，形成单一主改动。"
    else:
        hypothesis = "优先围绕单篇论文中最清晰的机制链提出单一主改动。"
    composed = ""
    if lead_unit and support_unit:
        composed = compose_action_hypothesis(lead_unit, support_unit)
    prediction = (
        prediction_sentence(lead_unit)
        if lead_unit
        else "若假设成立，应先看到中间机制指标改善。"
    )
    lead_paper_id = lead.get("paper_id") if lead else None
    support_paper_id = support.get("paper_id") if support else None
    guard_paper_id = guard.get("paper_id") if guard else None
    return {
        "agent": agent,
        "brief_id": f"brief:{agent.lower()}:{lead_paper_id or 'none'}:{support_paper_id or 'none'}",
        "lead_paper_id": lead_paper_id,
        "support_paper_id": support_paper_id,
        "guard_paper_id": guard_paper_id,
        "lead_mech_id": lead_unit.get("mech_id"),
        "support_mech_id": support_unit.get("mech_id"),
        "guard_mech_id": guard_unit.get("mech_id"),
        "hypothesis_seed": hypothesis,
        "composed_hypothesis": composed or hypothesis,
        "lead_mechanism": list_text(
            (lead or {}).get("mechanism_claims")
            or (lead or {}).get("transfer_hints")
            or []
        ),
        "support_signal": list_text(
            (support or {}).get("transfer_hints")
            or (support or {}).get("mechanism_claims")
            or []
        ),
        "guardrail": list_text(
            (guard or {}).get("negative_lessons")
            or (guard or {}).get("limitation_claims")
            or []
        ),
        "lead_unit": lead_unit,
        "support_unit": support_unit,
        "guard_unit": guard_unit,
        "falsifiable_prediction": prediction,
        "causal_metric_path": (
            metric_path_sentence(lead_unit)
            if lead_unit
            else ["intermediate_signal", "target_metric"]
        ),
        "killer_ablation": (
            killer_ablation_sentence(lead_unit)
            if lead_unit
            else "移除主机制后若主效应仍在则否决方案。"
        ),
        "compatibility_score": compatibility_score(
            lead_unit,
            support_unit,
            guard_unit,
            lead_paper_id or "",
            support_paper_id or "",
            guard_paper_id or "",
        ),
    }


def build_innovation_briefs(selected: List[Dict[str, Any]]) -> Dict[str, Any]:
    cautionary = [paper for paper in selected if paper.get("slot") == "cautionary"]
    return {
        "apollo": innovation_brief_for_agent("Apollo", selected),
        "hermes": innovation_brief_for_agent("Hermes", selected),
        "athena": {
            "agent": "Athena",
            "guardrails": [
                list_text(
                    paper.get("negative_lessons")
                    or paper.get("limitation_claims")
                    or [str(paper.get("summary") or "")]
                )
                for paper in cautionary[:2]
            ],
            "veto_focus": "拒绝与 cautionary 证据冲突、无法被最小消融验证、或只是参数微调的方案。",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--goal", required=True)
    parser.add_argument("--session", required=True)
    parser.add_argument("--best", required=True)
    parser.add_argument("--attempts", required=False)
    parser.add_argument("--workspace-root")
    parser.add_argument("--index-dir")
    parser.add_argument("--config")
    parser.add_argument("--output")
    parser.add_argument("--round", type=int)
    args = parser.parse_args()

    workspace_root = resolve_workspace_root(args.workspace_root)
    config = load_research_config(
        pathlib.Path(args.config).resolve() if args.config else None
    )
    index_dir = (
        pathlib.Path(args.index_dir).resolve()
        if args.index_dir
        else index_output_dir(workspace_root, config)
    )
    goal = load_structured(pathlib.Path(args.goal).resolve())
    session = load_structured(pathlib.Path(args.session).resolve())
    best = load_structured(pathlib.Path(args.best).resolve())
    attempts = (
        read_jsonl(pathlib.Path(args.attempts).resolve()) if args.attempts else []
    )
    posterior = read_json(posterior_rank_output_path(workspace_root, config), {})
    papers = load_jsonl(index_dir / "paper-index.jsonl")

    query_tokens = tokenize(
        " ".join(
            [
                str(goal.get("goal_text") or ""),
                str(goal.get("target_metric") or ""),
                str(best.get("family") or ""),
                " ".join(
                    str(item.get("family") or "")
                    for item in attempts[-5:]
                    if isinstance(item, dict)
                ),
            ]
        )
    )
    cooldowns = [
        family
        for family, remaining in dict(session.get("family_cooldowns", {})).items()
        if int(remaining) > 0
    ]
    recent_families = [
        str(item.get("family") or "")
        for item in attempts[-5:]
        if isinstance(item, dict)
    ]
    scored = sorted(
        [
            score_paper(paper, posterior, query_tokens, cooldowns, recent_families)
            for paper in papers
        ],
        key=lambda item: (item["score"], item["overlap"], item["posterior_usefulness"]),
        reverse=True,
    )
    selected = select_units(scored, config)
    round_index = args.round or int(session.get("iteration_count", 0)) + 1
    innovation_briefs = build_innovation_briefs(selected)
    payload = {
        "round": round_index,
        "query_tokens": query_tokens,
        "cooldowns": cooldowns,
        "selected": selected,
        "top_ranked": scored[:8],
        "innovation_briefs": innovation_briefs,
    }

    cache_dir = retrieval_cache_dir(workspace_root, config)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = (
        pathlib.Path(args.output).resolve()
        if args.output
        else cache_dir / f"retrieval-round-{round_index:04d}.json"
    )
    write_json(cache_path, payload)
    emit_json({**payload, "output": str(cache_path)})


if __name__ == "__main__":
    main()
