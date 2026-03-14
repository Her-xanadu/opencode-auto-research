#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from typing import Any, Dict, List

SCRIPTS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from ae_common import emit_json, read_text, write_text
from common import (
    body_without_frontmatter,
    discover_paper_paths,
    list_paper_dirs,
    load_claims,
    load_meta,
    split_sections,
)

PLACEHOLDER_MARKERS = [
    "待补充",
    "<待补充架构图>",
    "主要模块: 待补充",
    "输入输出: 待补充",
    "模块关系: 待补充",
    "适配当前实验的潜在切入点: 待补充",
]


def note_needs_fill(path: pathlib.Path) -> bool:
    if not path.exists():
        return True
    text = read_text(path)
    return any(marker in text for marker in PLACEHOLDER_MARKERS)


def normalize_line(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" -:\n\t")


def extract_canvas_nodes(path: pathlib.Path | None) -> List[str]:
    if path is None or not path.exists():
        return []
    try:
        payload = json.loads(read_text(path))
    except Exception:
        return []
    rows: List[str] = []
    for node in payload.get("nodes", []):
        if not isinstance(node, dict):
            continue
        text = normalize_line(str(node.get("text") or ""))
        if text:
            rows.append(text)
    return rows


def extract_section_summary(
    sections: List[Dict[str, str]], keywords: List[str], fallback: str
) -> str:
    for section in sections:
        title = section["title"].lower()
        content = section["text"]
        haystack = f"{title} {content}".lower()
        if any(keyword in haystack for keyword in keywords):
            text = normalize_line(content)
            if text:
                return text[:180]
    return fallback


def extract_claim_text(
    claims: List[Dict[str, Any]], claim_type: str, fallback: str
) -> str:
    for claim in claims:
        if str(claim.get("claim_type") or "") == claim_type:
            text = normalize_line(str(claim.get("text") or ""))
            if text:
                return text
    return fallback


def canvas_module_summary(nodes: List[str], fallback: str) -> str:
    bullet_candidates: List[str] = []
    for node in nodes:
        cleaned = re.sub(r"^[#*\-\s]+", "", node)
        parts = [
            normalize_line(part)
            for part in re.split(r"[\n;]", cleaned)
            if normalize_line(part)
        ]
        for part in parts:
            if any(
                token in part
                for token in [
                    "模块",
                    "层",
                    "检测",
                    "分类",
                    "输出",
                    "输入",
                    "更新",
                    "特征",
                    "语义",
                    "图",
                    "网络",
                ]
            ):
                bullet_candidates.append(part)
    if bullet_candidates:
        return "；".join(bullet_candidates[:4])
    return fallback


def infer_io(markdown_body: str, title: str) -> str:
    lowered = markdown_body.lower()
    if any(
        token in lowered
        for token in ["异常检测", "恶意流量检测", "anomaly", "malicious"]
    ):
        return "输入为流级/包级加密流量统计或序列特征，输出为异常分数或恶意/正常判定。"
    if any(token in lowered for token in ["ood", "开放世界", "unknown", "未知"]):
        return "输入为加密流量包序列或统计特征，输出为已知类分类结果与 OOD/未知类判定。"
    if any(token in lowered for token in ["指纹", "fingerprint", "uri"]):
        return (
            "输入为加密流量 burst、时序与侧信道特征，输出为细粒度行为或指纹匹配结果。"
        )
    return f"输入通常是与《{title}》相关的加密流量统计或包序列特征，输出是对应的分类、检测或行为识别结果。"


def infer_relationship(
    nodes: List[str], sections: List[Dict[str, str]], fallback: str
) -> str:
    if len(nodes) >= 3:
        ordered = [
            re.sub(r"^[#*\-\s]+", "", normalize_line(node)) for node in nodes[:5]
        ]
        ordered = [node for node in ordered if node]
        if len(ordered) >= 3:
            return " -> ".join(ordered[:4])
    return extract_section_summary(
        sections, ["方法", "架构", "流程", "框架", "pipeline"], fallback
    )


def render_figure_note(paths, meta: Dict[str, Any]) -> str:
    markdown_text = read_text(paths.markdown, "") if paths.markdown else ""
    body = body_without_frontmatter(markdown_text)
    sections = split_sections(body)
    claims = load_claims(paths.claims) if paths.claims.exists() else []
    nodes = extract_canvas_nodes(paths.canvas)
    title = str(meta.get("title_zh") or meta.get("title_en") or paths.root.name)

    mechanism = extract_claim_text(
        claims,
        "mechanism",
        extract_section_summary(
            sections,
            ["方法", "架构", "核心方案", "设计", "pipeline"],
            "该工作围绕单一核心机制组织特征提取、判别与适配流程。",
        ),
    )
    limitation = extract_claim_text(
        claims,
        "limitation",
        extract_section_summary(
            sections,
            ["局限", "风险", "挑战", "问题"],
            "局限主要来自部署成本、外部依赖或跨环境迁移稳定性。",
        ),
    )
    transfer_hint = extract_claim_text(
        claims,
        "transfer_hint",
        extract_section_summary(
            sections,
            ["思考", "启发", "适配", "结论"],
            "优先抽取其中最小可归因机制，再映射到当前实验循环中的单一改动。",
        ),
    )
    modules = canvas_module_summary(nodes, mechanism)
    inputs_outputs = infer_io(body, title)
    relationships = infer_relationship(nodes, sections, mechanism)
    delta = extract_section_summary(
        sections,
        ["创新", "优势", "差异", "贡献", "对比"],
        "相比常规方法，它更强调在加密流量受限观测条件下，通过结构化机制提升可迁移性与鲁棒性。",
    )

    return "\n".join(
        [
            f"# {title} 图示解读",
            "",
            f"- 架构图来源: {paths.canvas.name if paths.canvas else '未找到架构图'}",
            f"- 主要模块: {modules}",
            f"- 输入输出: {inputs_outputs}",
            f"- 模块关系: {relationships}",
            f"- 相比常规方法的差异: {delta}",
            f"- 适配当前实验的潜在切入点: {transfer_hint}",
            "",
            "## 补充说明",
            f"- 核心机制摘要: {mechanism}",
            f"- 已知局限: {limitation}",
            f"- 当前建议: {transfer_hint}",
            "",
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault-root", required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    vault_root = pathlib.Path(args.vault_root).resolve()
    updated: List[str] = []
    for paper_dir in list_paper_dirs(vault_root):
        paths = discover_paper_paths(paper_dir)
        if not args.force and not note_needs_fill(paths.figure_note):
            continue
        meta = load_meta(paths)
        rendered = render_figure_note(paths, meta)
        write_text(paths.figure_note, rendered)
        updated.append(paper_dir.name)

    emit_json(
        {
            "vault_root": str(vault_root),
            "updated_count": len(updated),
            "updated": updated,
        }
    )


if __name__ == "__main__":
    main()
