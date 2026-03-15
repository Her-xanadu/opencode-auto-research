#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Any, Dict, List

SCRIPTS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from ae_common import emit_json, read_json, write_text
from common import (
    experiments_research_dir,
    load_research_config,
    resolve_workspace_root,
)


def render_paper_line(prefix: str, paper: Dict[str, Any]) -> str:
    def compact(value: str, limit: int) -> str:
        text = " ".join(str(value or "").split())
        return text[:limit].rstrip("，。；; ")

    tags = " / ".join(paper.get("family_tags") or paper.get("method_tags") or [])
    reason = f"匹配分 {paper.get('score', 0)}，证据质量 {paper.get('evidence_quality', 'unknown')}，grounding 置信度 {paper.get('grounding_confidence', 'unknown')}"
    summary = compact(str(paper.get("summary") or ""), 90)
    mechanism = "；".join(
        (paper.get("mechanism_claims") or paper.get("transfer_hints") or [])[:2]
    )
    risk = "；".join(
        (paper.get("negative_lessons") or paper.get("limitation_claims") or [])[:2]
    )
    return f"### {prefix}\n- paper_id: `{paper.get('paper_id')}`\n- 标题: {paper.get('title_zh') or paper.get('title_en')}\n- 方法族: {tags or 'general'}\n- 为什么入选: {reason}\n- 关键机制: {compact(mechanism or summary, 110)}\n- 风险提醒: {compact(risk or '未显式记录', 90)}\n"


def cap_line(line: str, limit: int) -> str:
    if len(line) <= limit:
        return line
    return line[: limit - 1].rstrip("，。；; ") + "…"


def render_budgeted(lines: List[str]) -> str:
    capped: List[str] = []
    budgets = {
        "推荐论文": 240,
        "正交论文": 180,
        "警示论文": 180,
        "Apollo 主攻假设": 160,
        "Apollo 组合机制": 180,
        "Apollo 主机制": 120,
        "Apollo 辅助信号": 120,
        "Hermes 正交假设": 160,
        "Hermes 组合机制": 180,
        "Athena 守门提醒": 150,
        "关键可证伪预测": 200,
        "Killer ablation": 200,
    }
    current_budget = None
    consumed = 0
    for line in lines:
        if line.startswith("### "):
            current_budget = next(
                (value for key, value in budgets.items() if key in line), None
            )
            consumed = 0
            capped.append(line)
            continue
        if line.startswith("- ") and current_budget is not None:
            remaining = max(40, current_budget - consumed)
            clipped = cap_line(line, remaining)
            consumed += len(clipped)
            capped.append(clipped)
            continue
        capped.append(line)
    rendered = "\n".join(capped).strip() + "\n"
    if len(rendered) < 500:
        rendered += "\n## 本轮建议边界\n- 仅允许单一主改动。\n- 每个主方案至少绑定两篇本地论文。\n- 优先选择与当前 family 或失败模式相关的可归因机制。\n"
    return rendered


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--round", type=int, required=True)
    parser.add_argument("--retrieval", required=True)
    parser.add_argument("--workspace-root")
    parser.add_argument("--config")
    parser.add_argument("--output")
    args = parser.parse_args()

    workspace_root = resolve_workspace_root(args.workspace_root)
    config = load_research_config(
        pathlib.Path(args.config).resolve() if args.config else None
    )
    retrieval = read_json(pathlib.Path(args.retrieval).resolve(), {})
    selected = list(retrieval.get("selected", []))
    innovation_briefs = dict(retrieval.get("innovation_briefs", {}))
    relevant = [paper for paper in selected if paper.get("slot") == "relevant"]
    orthogonal = [paper for paper in selected if paper.get("slot") == "orthogonal"]
    cautionary = [paper for paper in selected if paper.get("slot") == "cautionary"]

    lines = [
        f"# evidence-round-{args.round:04d}",
        "",
        "## 当前问题",
        "- 当前轮需要在不重写实验循环的前提下，选择一个具备文献支撑、可归因、可做最小消融的单一改动。",
        "- 证据包来自本地索引检索，而不是全量扫描知识库。",
        "",
    ]
    for index, paper in enumerate(relevant[:2], start=1):
        lines.append(render_paper_line(f"推荐论文 {index}（高度相关）", paper))
    if orthogonal:
        lines.append(render_paper_line("正交论文 1", orthogonal[0]))
    if cautionary:
        lines.append(render_paper_line("警示论文 / SoK 1", cautionary[0]))
    apollo = innovation_briefs.get("apollo", {})
    hermes = innovation_briefs.get("hermes", {})
    athena = innovation_briefs.get("athena", {})
    lines.extend(
        [
            "## 创新综合脊柱",
            f"- Apollo 主攻假设: {apollo.get('hypothesis_seed', '未生成')}",
            f"- Apollo 组合机制: {apollo.get('composed_hypothesis', '未生成')}",
            f"- Apollo 主机制: {apollo.get('lead_mechanism', '未生成')}",
            f"- Apollo 辅助信号: {apollo.get('support_signal', '未生成')}",
            f"- Apollo 组合兼容分: {apollo.get('compatibility_score', '未生成')}",
            f"- Hermes 正交假设: {hermes.get('hypothesis_seed', '未生成')}",
            f"- Hermes 组合机制: {hermes.get('composed_hypothesis', '未生成')}",
            f"- Hermes 正交主机制: {hermes.get('lead_mechanism', '未生成')}",
            f"- Hermes 组合兼容分: {hermes.get('compatibility_score', '未生成')}",
            f"- Athena 守门提醒: {'；'.join(athena.get('guardrails', [])) or '未生成'}",
            f"- 关键可证伪预测: {apollo.get('falsifiable_prediction', '未生成')}",
            f"- Killer ablation: {apollo.get('killer_ablation', '未生成')}",
            "",
            "## 给三专家的科研要求",
            "- Apollo: 优先把主机制落成单一因果链，不要把 support signal 也做成第二主改动。",
            "- Hermes: 必须提出和 Apollo 不同作用轴的组合，不允许只是同族换壳。",
            "- Athena: 优先拦截与 guardrail 冲突、没有 killer ablation、或本质是参数微调的方案。",
            "",
        ]
    )
    lines.extend(
        [
            "## 本轮建议边界",
            "- 主方案必须绑定至少 2 个唯一 paper_id。",
            "- 禁止纯调参作为主方案。",
            "- 必须给出 minimal_ablation 和 files_to_touch。",
            "",
        ]
    )
    rendered = render_budgeted(lines)
    evidence_dir = experiments_research_dir(workspace_root, config)
    evidence_dir.mkdir(parents=True, exist_ok=True)
    output_path = (
        pathlib.Path(args.output).resolve()
        if args.output
        else evidence_dir / f"evidence-round-{args.round:04d}.md"
    )
    write_text(output_path, rendered)
    emit_json(
        {
            "round": args.round,
            "output": str(output_path),
            "char_count": len(rendered),
            "selected_count": len(selected),
        }
    )


if __name__ == "__main__":
    main()
