#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from typing import Dict, List, Optional

SCRIPTS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from ae_common import emit_json, write_text
from common import (
    discover_paper_paths,
    list_paper_dirs,
    load_meta,
    parse_frontmatter,
    read_text,
    write_meta_stub,
)


def contains_chinese(value: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in value)


def english_pdf_name(candidate: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9]+", "_", candidate).strip("_")
    stem = re.sub(r"_+", "_", stem)
    return f"{stem or 'paper'}.pdf"


def infer_title_en(paths, meta: Dict[str, object]) -> str:
    title_en = str(meta.get("title_en") or "").strip()
    if title_en and not contains_chinese(title_en):
        return title_en
    if paths.markdown and paths.markdown.exists():
        frontmatter = parse_frontmatter(read_text(paths.markdown))
        original_title = str(frontmatter.get("original_title") or "").strip()
        if original_title and not contains_chinese(original_title):
            return original_title
    if paths.pdf and paths.pdf.exists():
        pdf_stem = paths.pdf.stem
        if pdf_stem and not contains_chinese(pdf_stem):
            return pdf_stem.replace("_", " ")
    return title_en or str(meta.get("title_zh") or paths.root.name)


def rename_if_needed(source: Optional[pathlib.Path], target: pathlib.Path) -> bool:
    if source is None or not source.exists() or source == target:
        return False
    if target.exists():
        return False
    source.rename(target)
    return True


def update_markdown_title(markdown_path: pathlib.Path, canonical_title: str) -> None:
    if not markdown_path.exists():
        return
    text = read_text(markdown_path)
    lines = text.splitlines()
    updated = False
    if lines and lines[0] == "---":
        for index in range(1, len(lines)):
            if lines[index] == "---":
                break
            if lines[index].startswith("title:"):
                lines[index] = f'title: "{canonical_title}"'
                updated = True
                break
    for index, line in enumerate(lines):
        if line.startswith("# "):
            lines[index] = f"# {canonical_title}"
            updated = True
            break
    if updated:
        write_text(markdown_path, "\n".join(lines) + "\n")


def update_figure_note(
    figure_note_path: pathlib.Path, canonical_title: str, canvas_name: str
) -> None:
    if not figure_note_path.exists():
        return
    lines = read_text(figure_note_path).splitlines()
    changed = False
    if lines:
        lines[0] = f"# {canonical_title} 图示解读"
        changed = True
    for index, line in enumerate(lines):
        if line.startswith("- 架构图来源:"):
            lines[index] = f"- 架构图来源: {canvas_name}"
            changed = True
            break
    if changed:
        write_text(figure_note_path, "\n".join(lines) + "\n")


def scaffold_canvas(canvas_path: pathlib.Path, canonical_title: str) -> None:
    if canvas_path.exists():
        return
    payload = {
        "nodes": [
            {
                "id": "root",
                "type": "text",
                "text": f"# {canonical_title} 架构图\n\n- 待后续继续细化\n- 当前由标准化脚本补齐文件位点",
                "x": 200,
                "y": 120,
                "width": 360,
                "height": 140,
            }
        ],
        "edges": [],
    }
    write_text(canvas_path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def scaffold_markdown(
    markdown_path: pathlib.Path,
    canonical_title: str,
    title_en: str,
    canvas_name: Optional[str],
) -> None:
    if markdown_path.exists():
        return
    lines = [
        "---",
        f'title: "{canonical_title}"',
        f'original_title: "{title_en}"',
        "status: 待读",
        "---",
        "",
        f"# {canonical_title}",
        "",
        "## 1. 研究问题",
        "",
        "待补充。",
        "",
        "## 2. 方法与架构",
        "",
        "待补充。",
        "",
    ]
    if canvas_name:
        lines.extend(["### 系统架构图", "", f"![[{canvas_name}]]", ""])
    lines.extend(["## 3. 实验效果", "", "待补充。", ""])
    write_text(markdown_path, "\n".join(lines))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault-root", required=True)
    args = parser.parse_args()

    vault_root = pathlib.Path(args.vault_root).resolve()
    rows: List[Dict[str, object]] = []
    for paper_dir in list_paper_dirs(vault_root):
        canonical_title = paper_dir.name
        paths = discover_paper_paths(paper_dir)
        meta = load_meta(paths)
        title_en = infer_title_en(paths, meta)

        target_markdown = paper_dir / f"{canonical_title}.md"
        target_canvas = paper_dir / f"{canonical_title}-架构图.canvas"
        target_pdf = paper_dir / english_pdf_name(title_en)

        md_renamed = rename_if_needed(paths.markdown, target_markdown)
        canvas_renamed = rename_if_needed(paths.canvas, target_canvas)
        pdf_renamed = rename_if_needed(paths.pdf, target_pdf)

        final_markdown = target_markdown if target_markdown.exists() else paths.markdown
        final_canvas = target_canvas if target_canvas.exists() else paths.canvas
        final_pdf = target_pdf if target_pdf.exists() else paths.pdf

        if final_canvas is None:
            scaffold_canvas(target_canvas, canonical_title)
            final_canvas = target_canvas
        if final_markdown is None:
            scaffold_markdown(
                target_markdown,
                canonical_title,
                title_en,
                final_canvas.name if final_canvas else None,
            )
            final_markdown = target_markdown

        meta["title_zh"] = canonical_title
        meta["title_en"] = title_en
        meta["source_dir"] = canonical_title
        write_meta_stub(paths.meta, meta)

        if final_markdown and final_markdown.exists():
            update_markdown_title(final_markdown, canonical_title)
        if final_canvas and final_canvas.exists():
            update_figure_note(paths.figure_note, canonical_title, final_canvas.name)

        rows.append(
            {
                "paper_dir": canonical_title,
                "markdown": str(final_markdown.name)
                if final_markdown and final_markdown.exists()
                else None,
                "canvas": str(final_canvas.name)
                if final_canvas and final_canvas.exists()
                else None,
                "pdf": str(final_pdf.name)
                if final_pdf and final_pdf.exists()
                else None,
                "markdown_renamed": md_renamed,
                "canvas_renamed": canvas_renamed,
                "pdf_renamed": pdf_renamed,
            }
        )

    emit_json({"vault_root": str(vault_root), "paper_count": len(rows), "papers": rows})


if __name__ == "__main__":
    main()
