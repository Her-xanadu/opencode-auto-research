from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sys
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

SCRIPTS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from ae_common import (  # noqa: E402
    append_jsonl,
    dump_yaml_like,
    load_yaml_like,
    now_iso,
    read_json,
    read_jsonl,
    read_text,
    write_json,
    write_text,
)

MACHINE_LAYER_FILES = {"paper.meta.yaml", "figure-note.md", "claims.jsonl"}
STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "under",
    "used",
    "using",
    "based",
    "network",
    "traffic",
    "encrypted",
    "classification",
    "detection",
    "system",
    "paper",
    "research",
    "current",
    "metric",
    "optimize",
    "实验",
    "当前",
    "系统",
    "研究",
    "方法",
    "模型",
    "论文",
    "目标",
}


@dataclass
class PaperPaths:
    root: pathlib.Path
    markdown: Optional[pathlib.Path]
    pdf: Optional[pathlib.Path]
    canvas: Optional[pathlib.Path]
    meta: pathlib.Path
    figure_note: pathlib.Path
    claims: pathlib.Path


def load_research_config(config_path: Optional[pathlib.Path] = None) -> Dict[str, Any]:
    default_path = SCRIPTS_ROOT.parent / "configs" / "research_brain.yaml"
    path = config_path or default_path
    config = load_yaml_like(path) if path.exists() else {}
    config.setdefault("vault_root", "../vault")
    vault_root = pathlib.Path(str(config.get("vault_root") or ""))
    if vault_root and not vault_root.is_absolute():
        config["vault_root"] = str((path.parent / vault_root).resolve())
    config.setdefault("index_output_dir", "experiments/research/index")
    config.setdefault("retrieval_cache_dir", "experiments/research/retrieval-cache")
    config.setdefault("evidence_output_dir", "experiments/research")
    config.setdefault("feedback_output", "experiments/research/paper-feedback.jsonl")
    config.setdefault(
        "posterior_rank_output", "experiments/research/posterior-rank.json"
    )
    config.setdefault("paper_id_map_output", "experiments/research/paper-id-map.jsonl")
    config.setdefault(
        "frontier_map_output", "experiments/research/index/frontier-map.json"
    )
    selection = dict(config.get("selection", {}))
    selection.setdefault("relevant_count", 2)
    selection.setdefault("orthogonal_count", 1)
    selection.setdefault("cautionary_count", 1)
    selection.setdefault("minimum_evidence_units", 2)
    selection.setdefault("max_papers_for_prompt", 4)
    selection.setdefault("max_claims_per_paper", 2)
    config["selection"] = selection
    return config


def resolve_workspace_root(path: Optional[str]) -> pathlib.Path:
    return pathlib.Path(path).resolve() if path else SCRIPTS_ROOT.parent


def resolve_output_path(workspace_root: pathlib.Path, value: str) -> pathlib.Path:
    path = pathlib.Path(value)
    return path if path.is_absolute() else (workspace_root / path)


def experiments_research_dir(
    workspace_root: pathlib.Path, config: Dict[str, Any]
) -> pathlib.Path:
    return resolve_output_path(
        workspace_root, config.get("evidence_output_dir", "experiments/research")
    )


def index_output_dir(
    workspace_root: pathlib.Path, config: Dict[str, Any]
) -> pathlib.Path:
    return resolve_output_path(
        workspace_root, config.get("index_output_dir", "experiments/research/index")
    )


def retrieval_cache_dir(
    workspace_root: pathlib.Path, config: Dict[str, Any]
) -> pathlib.Path:
    return resolve_output_path(
        workspace_root,
        config.get("retrieval_cache_dir", "experiments/research/retrieval-cache"),
    )


def feedback_output_path(
    workspace_root: pathlib.Path, config: Dict[str, Any]
) -> pathlib.Path:
    return resolve_output_path(
        workspace_root,
        config.get("feedback_output", "experiments/research/paper-feedback.jsonl"),
    )


def posterior_rank_output_path(
    workspace_root: pathlib.Path, config: Dict[str, Any]
) -> pathlib.Path:
    return resolve_output_path(
        workspace_root,
        config.get("posterior_rank_output", "experiments/research/posterior-rank.json"),
    )


def paper_id_map_output_path(
    workspace_root: pathlib.Path, config: Dict[str, Any]
) -> pathlib.Path:
    return resolve_output_path(
        workspace_root,
        config.get("paper_id_map_output", "experiments/research/paper-id-map.jsonl"),
    )


def frontier_map_output_path(
    workspace_root: pathlib.Path, config: Dict[str, Any]
) -> pathlib.Path:
    return resolve_output_path(
        workspace_root,
        config.get(
            "frontier_map_output", "experiments/research/index/frontier-map.json"
        ),
    )


def normalized_slug(value: str) -> str:
    lowered = value.strip().lower()
    lowered = re.sub(r"https?://", "", lowered)
    lowered = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", lowered)
    return lowered.strip("-") or "unknown"


def tokenize(value: str) -> List[str]:
    tokens = re.findall(r"[A-Za-z0-9\u4e00-\u9fff]+", value.lower())
    return [token for token in tokens if len(token) > 1 and token not in STOPWORDS]


def parse_frontmatter(text: str) -> Dict[str, Any]:
    if not text.startswith("---"):
        return {}
    lines = text.splitlines()
    if len(lines) < 3:
        return {}
    try:
        end_index = lines[1:].index("---") + 1
    except ValueError:
        return {}
    payload = "\n".join(lines[1:end_index])
    temp_path = pathlib.Path("frontmatter.yaml")
    return load_yaml_like_from_text(payload, temp_path)


def load_yaml_like_from_text(text: str, path_hint: pathlib.Path) -> Dict[str, Any]:
    if not text.strip():
        return {}
    temp = path_hint.parent / f".{path_hint.name}.tmp"
    temp.write_text(text, encoding="utf-8")
    try:
        return load_yaml_like(temp)
    finally:
        temp.unlink(missing_ok=True)


def body_without_frontmatter(text: str) -> str:
    if not text.startswith("---"):
        return text
    lines = text.splitlines()
    try:
        end_index = lines[1:].index("---") + 1
    except ValueError:
        return text
    return "\n".join(lines[end_index + 1 :]).strip()


def discover_paper_paths(paper_root: pathlib.Path) -> PaperPaths:
    files = sorted(path for path in paper_root.iterdir() if path.is_file())
    markdown_candidates = [
        path
        for path in files
        if path.suffix.lower() == ".md" and path.name not in MACHINE_LAYER_FILES
    ]
    pdf_candidates = [path for path in files if path.suffix.lower() == ".pdf"]
    canvas_candidates = [path for path in files if path.suffix.lower() == ".canvas"]
    preferred_canvas = next(
        (path for path in canvas_candidates if path.name.endswith("-架构图.canvas")),
        None,
    )
    return PaperPaths(
        root=paper_root,
        markdown=markdown_candidates[0] if markdown_candidates else None,
        pdf=pdf_candidates[0] if pdf_candidates else None,
        canvas=preferred_canvas
        or (canvas_candidates[0] if canvas_candidates else None),
        meta=paper_root / "paper.meta.yaml",
        figure_note=paper_root / "figure-note.md",
        claims=paper_root / "claims.jsonl",
    )


def looks_like_paper_dir(path: pathlib.Path) -> bool:
    if not path.is_dir() or path.name.startswith("."):
        return False
    files = list(path.iterdir())
    return any(
        item.suffix.lower() in {".md", ".pdf", ".canvas"}
        for item in files
        if item.is_file()
    )


def list_paper_dirs(vault_root: pathlib.Path) -> List[pathlib.Path]:
    return sorted(path for path in vault_root.iterdir() if looks_like_paper_dir(path))


def first_non_empty(values: Iterable[Any], default: str = "") -> str:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and value.strip():
            return value.strip()
    return default


def extract_arxiv_id(text: str) -> Optional[str]:
    match = re.search(
        r"arxiv(?:\.org/abs/)?[:\s/]*([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)",
        text,
        re.IGNORECASE,
    )
    return match.group(1) if match else None


def make_canonical_paper_id(metadata: Dict[str, Any]) -> str:
    doi = str(metadata.get("doi") or "").strip()
    if doi:
        return f"doi:{doi.lower()}"
    arxiv_id = str(metadata.get("arxiv_id") or "").strip()
    if arxiv_id:
        return f"arxiv:{arxiv_id.lower()}"
    venue = normalized_slug(str(metadata.get("venue") or "unknown"))
    year = str(metadata.get("year") or "unknown")
    title = first_non_empty(
        [metadata.get("title_en"), metadata.get("title_zh"), metadata.get("title")],
        "untitled",
    )
    digest = hashlib.sha1(title.encode("utf-8")).hexdigest()[:10]
    return f"paper:{venue}:{year}:{digest}"


def infer_family_tags(text: str, tags: Iterable[str]) -> List[str]:
    source = " ".join([text, *list(tags)]).lower()
    mapping = {
        "objective": ["loss", "objective", "contrastive", "regularization", "蒸馏"],
        "representation": [
            "feature",
            "embedding",
            "representation",
            "预训练",
            "prompt",
            "semantic",
        ],
        "architecture": [
            "transformer",
            "gnn",
            "cnn",
            "conformer",
            "mixture",
            "switch",
            "graph",
        ],
        "adaptation": ["ood", "continual", "online", "test-time", "drift", "adaptive"],
        "cautionary": [
            "sok",
            "survey",
            "mystery",
            "bias",
            "捷径",
            "陷阱",
            "警示",
            "综述",
        ],
    }
    found: List[str] = []
    for family, needles in mapping.items():
        if any(needle in source for needle in needles):
            found.append(family)
    return sorted(set(found))


def to_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [part.strip() for part in re.split(r"[,/|]", value) if part.strip()]
    return [str(value).strip()]


def build_meta_stub(paths: PaperPaths) -> Dict[str, Any]:
    text = read_text(paths.markdown, "") if paths.markdown else ""
    frontmatter = parse_frontmatter(text)
    body = body_without_frontmatter(text)
    title_zh = first_non_empty([frontmatter.get("title"), paths.root.name])
    title_en = first_non_empty([frontmatter.get("original_title")], title_zh)
    tags = to_list(frontmatter.get("tags"))
    venue = first_non_empty([frontmatter.get("venue")], "unknown")
    year = frontmatter.get("year") or "unknown"
    arxiv_id = extract_arxiv_id(text)
    stub = {
        "paper_id": "",
        "title_zh": title_zh,
        "title_en": title_en,
        "year": year,
        "venue": venue,
        "task_tags": sorted(set(tags[:4] or tokenize(title_zh)[:4])),
        "method_tags": sorted(set(tokenize(title_en)[:4])),
        "family_tags": infer_family_tags(body, tags),
        "evidence_quality": first_non_empty(
            [frontmatter.get("evidence_quality")], "unknown"
        ),
        "transferability": "unknown",
        "repo_fit_guess": "medium",
        "compute_cost": "unknown",
        "code_available": False,
        "code_url": "",
        "negative_lessons": [],
        "doi": first_non_empty([frontmatter.get("doi")], ""),
        "arxiv_id": arxiv_id or first_non_empty([frontmatter.get("arxiv")], ""),
        "source_dir": paths.root.name,
        "updated_at": now_iso(),
    }
    stub["paper_id"] = make_canonical_paper_id(stub)
    return stub


def write_meta_stub(path: pathlib.Path, value: Dict[str, Any]) -> None:
    write_text(path, dump_yaml_like(value) + "\n")


def load_meta(paths: PaperPaths) -> Dict[str, Any]:
    if paths.meta.exists():
        meta = load_yaml_like(paths.meta)
        if not meta.get("paper_id"):
            meta["paper_id"] = make_canonical_paper_id(meta)
        return meta
    return build_meta_stub(paths)


def scaffold_figure_note(paths: PaperPaths, meta: Dict[str, Any]) -> None:
    if paths.figure_note.exists():
        return
    title = first_non_empty(
        [meta.get("title_zh"), meta.get("title_en")], paths.root.name
    )
    canvas_name = paths.canvas.name if paths.canvas else "<待补充架构图>"
    write_text(
        paths.figure_note,
        "\n".join(
            [
                f"# {title} 图示解读",
                "",
                f"- 架构图来源: {canvas_name}",
                "- 主要模块: 待补充",
                "- 输入输出: 待补充",
                "- 模块关系: 待补充",
                "- 相比常规方法的差异: 待补充",
                "- 适配当前实验的潜在切入点: 待补充",
                "",
            ]
        ),
    )


def scaffold_claims(paths: PaperPaths, meta: Dict[str, Any]) -> None:
    if paths.claims.exists():
        return
    skeleton = [
        {
            "paper_id": meta.get("paper_id"),
            "claim_id": f"{meta.get('paper_id')}:mechanism:stub",
            "claim_type": "mechanism",
            "text": "待补充论文机制摘要",
        },
        {
            "paper_id": meta.get("paper_id"),
            "claim_id": f"{meta.get('paper_id')}:limitation:stub",
            "claim_type": "limitation",
            "text": "待补充论文局限性",
        },
        {
            "paper_id": meta.get("paper_id"),
            "claim_id": f"{meta.get('paper_id')}:transfer_hint:stub",
            "claim_type": "transfer_hint",
            "text": "待补充迁移启发",
        },
    ]
    for row in skeleton:
        append_jsonl(paths.claims, row)


def scaffold_machine_layer(paths: PaperPaths) -> Dict[str, Any]:
    meta = load_meta(paths)
    if not paths.meta.exists():
        write_meta_stub(paths.meta, meta)
    scaffold_figure_note(paths, meta)
    return meta


def validate_meta(meta: Dict[str, Any]) -> List[str]:
    required = [
        "paper_id",
        "title_zh",
        "title_en",
        "year",
        "venue",
        "task_tags",
        "method_tags",
        "family_tags",
        "evidence_quality",
        "transferability",
        "repo_fit_guess",
        "compute_cost",
        "code_available",
        "code_url",
        "negative_lessons",
    ]
    missing: List[str] = []
    for field in required:
        value = meta.get(field)
        if value is None or value == "":
            missing.append(field)
    return missing


def split_sections(body: str) -> List[Dict[str, str]]:
    sections: List[Dict[str, str]] = []
    current_title = "摘要"
    current_lines: List[str] = []
    for line in body.splitlines():
        if line.startswith("#"):
            if current_lines:
                sections.append(
                    {"title": current_title, "text": "\n".join(current_lines).strip()}
                )
                current_lines = []
            current_title = line.lstrip("#").strip() or "未命名章节"
            continue
        current_lines.append(line)
    if current_lines:
        sections.append(
            {"title": current_title, "text": "\n".join(current_lines).strip()}
        )
    return [section for section in sections if section["text"]]


def summarize_text(text: str, limit: int = 180) -> str:
    normalized = re.sub(r"\s+", " ", text).strip()
    return normalized[:limit].rstrip("，。；; ")


def normalize_claim_text(text: str) -> str:
    value = str(text or "")
    value = re.sub(r">\s*\[!\w+\]\s*", "", value)
    value = value.replace(">", " ")
    value = re.sub(r"#+\s*", "", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"\1", value)
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = re.sub(r"\$[^$]+\$", "", value)
    value = value.replace("|", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def strip_generic_prefix(text: str) -> str:
    value = normalize_claim_text(text)
    generic_prefixes = [
        "作者解决了什么问题？",
        "作者解决了什么问题?",
        "达到了什么效果？",
        "达到了什么效果?",
        "论文的优势：",
        "论文的优势:",
        "潜在局限：",
        "潜在局限:",
        "核心挑战：",
        "核心挑战:",
        "主要发现：",
        "主要发现:",
        "关键数据：",
        "关键数据:",
    ]
    for prefix in generic_prefixes:
        if value.startswith(prefix):
            value = value[len(prefix) :].strip(" ：:-")
    value = re.sub(r"^(?:\d+\.|[-*])\s*", "", value)
    return value.strip()


def first_sentence(text: str, limit: int = 120) -> str:
    normalized = strip_generic_prefix(text)
    pieces = [
        piece.strip(" -:：")
        for piece in re.split(
            r"(?:\s+-\s+|\s+\d+\.\s+|(?<=[。！？.!?])\s+)", normalized
        )
        if piece.strip()
    ]
    bad_starts = (
        "作者",
        "论文",
        "问题",
        "效果",
        "优势",
        "局限",
        "挑战",
        "发现",
        "数据",
    )
    candidates = [
        piece
        for piece in pieces
        if piece not in {"1.", "2.", "3.", "4."}
        and len(piece) > 12
        and not piece.startswith(bad_starts)
    ]
    picked = candidates[0] if candidates else (pieces[0] if pieces else normalized)
    if len(picked) < 8 and len(pieces) > 1:
        picked = pieces[1]
    return summarize_text(picked, limit)


def infer_mechanism_verb(text: str, family_tags: List[str]) -> str:
    lowered = text.lower()
    mapping = {
        "reweight": ["weight", "reweight", "mask", "importance", "加权", "掩码"],
        "aggregate": ["correlation", "multi-view", "graph", "fusion", "关联", "聚合"],
        "pretrain": ["pretrain", "masked", "自监督", "预训练"],
        "adapt": ["ood", "adaptive", "continual", "online", "test-time", "漂移"],
        "compress": ["convolution", "lightweight", "efficient", "压缩", "高效"],
        "guard": ["bias", "sok", "survey", "捷径", "failure", "warning"],
    }
    for verb, needles in mapping.items():
        if any(needle in lowered for needle in needles):
            return verb
    if "architecture" in family_tags:
        return "restructure"
    if "objective" in family_tags:
        return "regularize"
    if "representation" in family_tags:
        return "reshape"
    return "adapt"


def infer_target_object(text: str, family_tags: List[str]) -> str:
    lowered = text.lower()
    if any(
        token in lowered for token in ["encoder", "representation", "embedding", "表征"]
    ):
        return "representation"
    if any(
        token in lowered
        for token in ["loss", "objective", "regularization", "目标函数"]
    ):
        return "objective"
    if any(
        token in lowered
        for token in ["flow", "graph", "multi-view", "stream", "流", "图"]
    ):
        return "traffic structure"
    if any(
        token in lowered for token in ["ood", "online", "continual", "adapt", "漂移"]
    ):
        return "adaptation policy"
    if "architecture" in family_tags:
        return "model architecture"
    return "feature pipeline"


def zh_target_object(target_object: str) -> str:
    mapping = {
        "representation": "表征层",
        "objective": "目标函数",
        "traffic structure": "流量结构",
        "adaptation policy": "适配策略",
        "model architecture": "模型结构",
        "feature pipeline": "特征管线",
    }
    return mapping.get(target_object, target_object)


def zh_mechanism_verb(verb: str) -> str:
    mapping = {
        "reweight": "重加权",
        "aggregate": "聚合",
        "pretrain": "预训练",
        "adapt": "自适应",
        "compress": "压缩",
        "guard": "约束",
        "restructure": "重组",
        "regularize": "正则化",
        "reshape": "重塑",
    }
    return mapping.get(verb, verb)


def action_clause(text: str, limit: int = 48) -> str:
    cleaned = first_sentence(text, limit)
    cleaned = re.sub(
        r"^(?:当前|很多|许多|该方法|该论文|这篇论文|研究者|研究人员)", "", cleaned
    ).strip("，。；; ")
    return cleaned or "提升可迁移性"


def distilled_action_phrase(text: str, mechanism_verb: str, target_object: str) -> str:
    lowered = normalize_claim_text(text).lower()
    rules = [
        (
            ["convolution", "卷积", "transformer", "自注意力"],
            "以卷积替代高成本自注意力",
        ),
        (
            ["correlation", "关联", "单流", "multi-view", "graph"],
            "通过跨流关联聚合补足单流信息不足",
        ),
        (
            ["masked byte modeling", "masked", "掩码", "mbm"],
            "用掩码预训练强化局部可恢复模式",
        ),
        (["frozen encoder", "冻结编码器"], "用冻结编码器评估真实迁移表征"),
        (["shortcut", "bias", "捷径", "过拟合", "sok"], "约束数据捷径和伪泛化收益"),
        (
            ["ood", "unknown", "漂移", "online", "continual"],
            "在分布漂移下维持可迁移判别边界",
        ),
        (
            ["tabular", "protocol-native", "字段", "协议"],
            "利用协议原生字段重建稳定语义",
        ),
        (["anomaly", "malicious", "异常", "恶意"], "强化异常边界与少样本判别信号"),
    ]
    for needles, phrase in rules:
        if any(needle in lowered for needle in needles):
            return phrase
    target = zh_target_object(target_object)
    action = zh_mechanism_verb(mechanism_verb)
    return f"围绕{target}做{action}以提升可迁移性"


def polish_action_phrase(phrase: str) -> str:
    value = str(phrase or "").strip()
    value = value.replace("以以", "以")
    value = value.replace("以通过", "通过")
    value = value.replace("以用", "用")
    value = value.replace("借此通过", "通过")
    value = value.replace("借此用", "用")
    value = re.sub(
        r"围绕([^做]+)做([^以]+)以提升可迁移性", r"通过\2\1提升可迁移性", value
    )
    value = value.replace(
        "对流量结构做预训练，以卷积替代高成本自注意力",
        "对流量结构做预训练，以卷积替代高成本自注意力",
    )
    value = re.sub(r"\s+", "", value)
    return value.strip("，。；; ")


def render_action_sentence(
    verb: str, target_object: str, text: str, claim_type: str
) -> str:
    target = zh_target_object(target_object)
    action = zh_mechanism_verb(verb)
    clause = polish_action_phrase(distilled_action_phrase(text, verb, target_object))
    lead = clause if clause.startswith(("以", "通过", "用")) else f"以{clause}"
    if claim_type == "mechanism":
        return f"对{target}做{action}，{lead}。"
    if claim_type == "transfer_hint":
        return f"可把{action}作用到{target}，{lead}。"
    if claim_type == "limitation":
        return f"若继续沿{target}{action}路线推进，需警惕{clause}带来的失效边界。"
    if claim_type == "negative_lesson":
        return f"若结果不达标，应停止重复{target}{action}路线，转而检查{clause}。"
    return f"围绕{target}做{action}，目标是{clause}。"


def compact_claim_unit(
    text: str, family_tags: List[str], claim_type: str, paper_id: str, index: int
) -> Dict[str, Any]:
    cleaned = first_sentence(text, 140)
    mechanism_verb = infer_mechanism_verb(cleaned, family_tags)
    target_object = infer_target_object(cleaned, family_tags)
    causal_chain = cleaned
    action_sentence = render_action_sentence(
        mechanism_verb, target_object, cleaned, claim_type
    )
    boundary_conditions = "需要在当前 repo 的数据规模、计算预算与指标路径下保持可验证。"
    failure_mode = "若 killer ablation 不能打掉主效应，则说明机制叙事不成立。"
    if claim_type in {"limitation", "negative_lesson"}:
        failure_mode = cleaned
    return {
        "mech_id": f"{paper_id}:mech:{claim_type}:{index}",
        "claim_type": claim_type,
        "intervention": cleaned,
        "target_object": target_object,
        "mechanism_verb": mechanism_verb,
        "action_sentence": action_sentence,
        "causal_chain": causal_chain,
        "boundary_conditions": boundary_conditions,
        "failure_mode": failure_mode,
    }


def build_mechanism_units(
    claim_rows: List[Dict[str, Any]], meta: Dict[str, Any], summary: str
) -> List[Dict[str, Any]]:
    paper_id = str(meta.get("paper_id") or "unknown")
    family_tags = to_list(meta.get("family_tags"))
    units: List[Dict[str, Any]] = []
    order = ["mechanism", "transfer_hint", "limitation", "negative_lesson"]
    for claim_type in order:
        rows = claims_by_type(claim_rows, claim_type, 2)
        for index, row in enumerate(rows, start=1):
            units.append(
                compact_claim_unit(
                    str(row.get("text") or summary),
                    family_tags,
                    claim_type,
                    paper_id,
                    index,
                )
            )
    if not units:
        units.append(compact_claim_unit(summary, family_tags, "mechanism", paper_id, 1))
    return units[:4]


def metric_path_for_target(target_object: str) -> List[str]:
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
    return mapping.get(target_object, ["intermediate_signal", "target_metric"])


def extract_claims_from_markdown(
    paths: PaperPaths, meta: Dict[str, Any]
) -> List[Dict[str, Any]]:
    text = read_text(paths.markdown, "") if paths.markdown else ""
    body = body_without_frontmatter(text)
    sections = split_sections(body)
    claims: List[Dict[str, Any]] = []
    rules = [
        ("mechanism", ["方法", "架构", "核心方案", "创新", "stage", "模块"]),
        ("limitation", ["局限", "潜在问题", "风险", "缺点"]),
        ("negative_lesson", ["问题", "失败", "风险", "瓶颈", "挑战"]),
        ("transfer_hint", ["思考", "启发", "适配", "应用", "优势", "总结"]),
    ]
    for claim_type, keywords in rules:
        for section in sections:
            title = section["title"].lower()
            content = section["text"]
            haystack = f"{title} {content.lower()}"
            if not any(keyword.lower() in haystack for keyword in keywords):
                continue
            summary = summarize_text(content)
            if not summary:
                continue
            claims.append(
                {
                    "paper_id": meta.get("paper_id"),
                    "claim_id": f"{meta.get('paper_id')}:{claim_type}:{len(claims) + 1}",
                    "claim_type": claim_type,
                    "section": section["title"],
                    "text": summary,
                }
            )
            break
    needed_types = {"mechanism", "limitation", "transfer_hint"}
    existing_types = {claim["claim_type"] for claim in claims}
    if "mechanism" not in existing_types and sections:
        claims.append(
            {
                "paper_id": meta.get("paper_id"),
                "claim_id": f"{meta.get('paper_id')}:mechanism:fallback",
                "claim_type": "mechanism",
                "section": sections[0]["title"],
                "text": summarize_text(sections[0]["text"]),
            }
        )
    if "limitation" not in existing_types:
        claims.append(
            {
                "paper_id": meta.get("paper_id"),
                "claim_id": f"{meta.get('paper_id')}:limitation:fallback",
                "claim_type": "limitation",
                "section": "自动补全",
                "text": "需要结合原文进一步确认局限性与失败边界。",
            }
        )
    if "transfer_hint" not in existing_types:
        claims.append(
            {
                "paper_id": meta.get("paper_id"),
                "claim_id": f"{meta.get('paper_id')}:transfer_hint:fallback",
                "claim_type": "transfer_hint",
                "section": "自动补全",
                "text": "优先复用单一机制并保持最小改动面，再观察是否适配当前 repo。",
            }
        )
    if "negative_lesson" not in {claim["claim_type"] for claim in claims}:
        claims.append(
            {
                "paper_id": meta.get("paper_id"),
                "claim_id": f"{meta.get('paper_id')}:negative_lesson:fallback",
                "claim_type": "negative_lesson",
                "section": "自动补全",
                "text": "若方法依赖外部服务、重型模型或环境假设，迁移时需要先降级实现。",
            }
        )
    return claims


def write_claims(path: pathlib.Path, claims: List[Dict[str, Any]]) -> None:
    rows = [json.dumps(claim, ensure_ascii=False) for claim in claims]
    write_text(path, "\n".join(rows) + "\n")


def load_claims(path: pathlib.Path) -> List[Dict[str, Any]]:
    rows = read_jsonl(path)
    return [row for row in rows if isinstance(row, dict)]


def claims_by_type(
    claims: List[Dict[str, Any]], claim_type: str, limit: int = 2
) -> List[Dict[str, Any]]:
    return [
        claim for claim in claims if str(claim.get("claim_type") or "") == claim_type
    ][:limit]


def claim_texts(
    claims: List[Dict[str, Any]], claim_type: str, limit: int = 2
) -> List[str]:
    rows = claims_by_type(claims, claim_type, limit)
    return [
        str(row.get("text") or "").strip()
        for row in rows
        if str(row.get("text") or "").strip()
    ]


def compute_cautionary_score(
    meta: Dict[str, Any], claims: List[Dict[str, Any]], summary: str
) -> float:
    cues = " ".join(
        [
            str(meta.get("title_zh") or ""),
            str(meta.get("title_en") or ""),
            str(meta.get("venue") or ""),
            " ".join(to_list(meta.get("task_tags"))),
            " ".join(to_list(meta.get("method_tags"))),
            " ".join(to_list(meta.get("family_tags"))),
            summary,
            " ".join(str(claim.get("text") or "") for claim in claims[:6]),
        ]
    ).lower()
    score = 0.0
    strong_markers = [
        "sok",
        "survey",
        "综述",
        "bias",
        "shortcut",
        "捷径",
        "mystery",
        "enigma",
    ]
    weak_markers = ["limitation", "风险", "局限", "failure", "陷阱", "warning", "警示"]
    for marker in strong_markers:
        if marker in cues:
            score += 2.0
    for marker in weak_markers:
        if marker in cues:
            score += 0.75
    if "cautionary" in to_list(meta.get("family_tags")):
        score += 1.0
    if any("negative_lesson" == str(claim.get("claim_type") or "") for claim in claims):
        score += 0.5
    return round(score, 4)


def compute_innovation_potential(
    meta: Dict[str, Any], claims: List[Dict[str, Any]]
) -> float:
    score = 0.0
    score += min(2.0, 0.4 * len(claim_texts(claims, "mechanism", 4)))
    score += min(1.5, 0.5 * len(claim_texts(claims, "transfer_hint", 3)))
    score += min(1.0, 0.4 * len(to_list(meta.get("family_tags"))))
    repo_fit = str(meta.get("repo_fit_guess") or "medium").lower()
    evidence_quality = str(meta.get("evidence_quality") or "unknown").lower()
    if repo_fit == "high":
        score += 1.0
    elif repo_fit == "medium":
        score += 0.5
    if evidence_quality in {"high", "高"}:
        score += 1.0
    elif evidence_quality in {"medium", "中"}:
        score += 0.5
    if str(meta.get("compute_cost") or "").lower() in {"low", "medium", "低", "中"}:
        score += 0.5
    return round(score, 4)


def compute_grounding_confidence(
    meta: Dict[str, Any], claim_rows: List[Dict[str, Any]]
) -> float:
    evidence_quality = str(meta.get("evidence_quality") or "unknown").lower()
    quality_score = {
        "high": 1.0,
        "medium": 0.6,
        "low": 0.2,
        "高": 1.0,
        "中": 0.6,
        "低": 0.2,
    }.get(evidence_quality, 0.3)
    mechanism_count = len(claim_texts(claim_rows, "mechanism", 4))
    transfer_count = len(claim_texts(claim_rows, "transfer_hint", 3))
    limitation_count = len(claim_texts(claim_rows, "limitation", 3))
    return round(
        min(
            1.0,
            quality_score
            + mechanism_count * 0.08
            + transfer_count * 0.05
            + limitation_count * 0.03,
        ),
        2,
    )


def build_paper_record(paths: PaperPaths, meta: Dict[str, Any]) -> Dict[str, Any]:
    markdown_text = read_text(paths.markdown, "") if paths.markdown else ""
    body = body_without_frontmatter(markdown_text)
    claim_rows = load_claims(paths.claims) if paths.claims.exists() else []
    summary = summarize_text(body, 260)
    mechanism_units = build_mechanism_units(claim_rows, meta, summary)
    compact_mechanism_claims = [
        str(unit.get("action_sentence") or "")
        for unit in mechanism_units
        if str(unit.get("claim_type") or "") == "mechanism"
    ][:2]
    compact_transfer_hints = [
        str(unit.get("action_sentence") or "")
        for unit in mechanism_units
        if str(unit.get("claim_type") or "") == "transfer_hint"
    ][:2]
    compact_limitation_claims = [
        str(unit.get("action_sentence") or "")
        for unit in mechanism_units
        if str(unit.get("claim_type") or "") == "limitation"
    ][:2]
    compact_negative_lessons = [
        str(unit.get("action_sentence") or "")
        for unit in mechanism_units
        if str(unit.get("claim_type") or "") == "negative_lesson"
    ][:2]
    metric_paths = [
        metric_path_for_target(str(unit.get("target_object") or ""))
        for unit in mechanism_units[:2]
    ]
    cautionary_score = compute_cautionary_score(meta, claim_rows, summary)
    innovation_potential = compute_innovation_potential(meta, claim_rows)
    grounding_confidence = compute_grounding_confidence(meta, claim_rows)
    all_tags = sorted(
        set(
            to_list(meta.get("task_tags"))
            + to_list(meta.get("method_tags"))
            + to_list(meta.get("family_tags"))
        )
    )
    return {
        "paper_id": meta.get("paper_id"),
        "title_zh": meta.get("title_zh"),
        "title_en": meta.get("title_en"),
        "year": meta.get("year"),
        "task_tags": to_list(meta.get("task_tags")),
        "method_tags": to_list(meta.get("method_tags")),
        "family_tags": to_list(meta.get("family_tags")),
        "venue": meta.get("venue"),
        "transferability": meta.get("transferability", "unknown"),
        "repo_fit_guess": meta.get("repo_fit_guess", "medium"),
        "evidence_quality": meta.get("evidence_quality", "unknown"),
        "summary": summary,
        "mechanism_claims": compact_mechanism_claims,
        "transfer_hints": compact_transfer_hints,
        "limitation_claims": compact_limitation_claims,
        "negative_lessons": compact_negative_lessons,
        "mechanism_units": mechanism_units,
        "metric_paths": metric_paths,
        "grounding_confidence": grounding_confidence,
        "cautionary_score": cautionary_score,
        "innovation_potential": innovation_potential,
        "tags": all_tags,
        "paths": {
            "root": str(paths.root),
            "markdown": str(paths.markdown) if paths.markdown else None,
            "pdf": str(paths.pdf) if paths.pdf else None,
            "canvas": str(paths.canvas) if paths.canvas else None,
            "meta": str(paths.meta),
            "figure_note": str(paths.figure_note),
            "claims": str(paths.claims),
        },
        "claim_count": len(claim_rows),
    }


def build_method_index(
    papers: List[Dict[str, Any]], posterior_rank: Dict[str, Any]
) -> List[Dict[str, Any]]:
    buckets: Dict[str, Dict[str, Any]] = {}
    for paper in papers:
        paper_id = paper["paper_id"]
        rank = posterior_rank.get(paper_id, {})
        for method in paper.get("method_tags", []):
            bucket = buckets.setdefault(
                method,
                {
                    "method_tag": method,
                    "paper_ids": [],
                    "families": set(),
                    "score": 0.0,
                },
            )
            bucket["paper_ids"].append(paper_id)
            bucket["families"].update(paper.get("family_tags", []))
            bucket["score"] += float(rank.get("posterior_usefulness", 0.0))
    rows: List[Dict[str, Any]] = []
    for method, bucket in sorted(buckets.items()):
        rows.append(
            {
                "method_tag": method,
                "paper_ids": bucket["paper_ids"],
                "families": sorted(bucket["families"]),
                "score": round(bucket["score"], 4),
            }
        )
    return rows


def build_frontier_map(
    papers: List[Dict[str, Any]], posterior_rank: Dict[str, Any]
) -> Dict[str, Any]:
    topics: Dict[str, Dict[str, Any]] = {}
    for paper in papers:
        paper_id = paper["paper_id"]
        rank = posterior_rank.get(paper_id, {})
        topic_names = paper.get("task_tags") or ["general"]
        family_names = paper.get("family_tags") or ["general"]
        for topic in topic_names:
            topic_bucket = topics.setdefault(topic, {})
            for family in family_names:
                family_bucket = topic_bucket.setdefault(family, [])
                family_bucket.append(
                    {
                        "paper_id": paper_id,
                        "title": paper.get("title_zh") or paper.get("title_en"),
                        "recommended_weight": round(
                            1.0 + float(rank.get("posterior_usefulness", 0.0)), 4
                        ),
                    }
                )
    for topic_bucket in topics.values():
        for family, items in topic_bucket.items():
            topic_bucket[family] = sorted(
                items, key=lambda item: item["recommended_weight"], reverse=True
            )
    return {"topics": topics, "updated_at": now_iso()}


def load_posterior_rank(path: pathlib.Path) -> Dict[str, Any]:
    payload = read_json(path, {})
    return payload if isinstance(payload, dict) else {}


def build_text_index(paper: Dict[str, Any], claims: List[Dict[str, Any]]) -> str:
    parts: List[str] = [
        str(paper.get("title_zh") or ""),
        str(paper.get("title_en") or ""),
        str(paper.get("summary") or ""),
        " ".join(paper.get("tags") or []),
    ]
    parts.extend(str(claim.get("text") or "") for claim in claims[:6])
    return " ".join(parts)


def score_overlap(query_tokens: List[str], text: str) -> int:
    normalized = text.lower()
    return sum(1 for token in query_tokens if token in normalized)
