#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Any, Dict, List

SCRIPTS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from ae_common import emit_json, write_json, write_text
from common import (
    build_frontier_map,
    build_meta_stub,
    build_method_index,
    build_paper_record,
    discover_paper_paths,
    extract_claims_from_markdown,
    feedback_output_path,
    frontier_map_output_path,
    index_output_dir,
    list_paper_dirs,
    load_claims,
    load_meta,
    load_posterior_rank,
    load_research_config,
    paper_id_map_output_path,
    posterior_rank_output_path,
    resolve_workspace_root,
    scaffold_machine_layer,
    scaffold_figure_note,
    score_overlap,
    tokenize,
    validate_meta,
    write_claims,
    write_meta_stub,
)


def jsonl_lines(rows: List[Dict[str, Any]]) -> str:
    import json

    return "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + (
        "\n" if rows else ""
    )


def build_indexes(
    vault_root: pathlib.Path,
    workspace_root: pathlib.Path,
    output_dir: pathlib.Path,
    *,
    scaffold_missing: bool,
    extract_claims: bool,
    overwrite_claims: bool,
    config: Dict[str, Any],
) -> Dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    posterior = load_posterior_rank(posterior_rank_output_path(workspace_root, config))
    paper_rows: List[Dict[str, Any]] = []
    claim_rows: List[Dict[str, Any]] = []
    id_rows: List[Dict[str, Any]] = []
    issues: List[Dict[str, Any]] = []

    for paper_dir in list_paper_dirs(vault_root):
        paths = discover_paper_paths(paper_dir)
        if scaffold_missing:
            scaffold_machine_layer(paths)
        meta = load_meta(paths)
        if not paths.meta.exists() and scaffold_missing:
            write_meta_stub(paths.meta, meta)
        if scaffold_missing:
            scaffold_figure_note(paths, meta)
        missing_fields = validate_meta(meta)
        if (extract_claims and (overwrite_claims or not paths.claims.exists())) or (
            not extract_claims and not paths.claims.exists()
        ):
            claims = extract_claims_from_markdown(paths, meta)
            write_claims(paths.claims, claims)
        else:
            claims = load_claims(paths.claims)
        paper = build_paper_record(paths, meta)
        paper_rows.append(paper)
        claim_rows.extend(claims)
        id_rows.append(
            {
                "paper_id": meta.get("paper_id"),
                "paper_dir": paper_dir.name,
                "doi": meta.get("doi"),
                "arxiv_id": meta.get("arxiv_id"),
                "title_zh": meta.get("title_zh"),
                "title_en": meta.get("title_en"),
            }
        )
        if missing_fields:
            issues.append(
                {"paper_dir": paper_dir.name, "missing_fields": missing_fields}
            )

    method_rows = build_method_index(paper_rows, posterior)
    frontier = build_frontier_map(paper_rows, posterior)

    write_text(output_dir / "paper-index.jsonl", jsonl_lines(paper_rows))
    write_text(output_dir / "claim-index.jsonl", jsonl_lines(claim_rows))
    write_text(output_dir / "method-index.jsonl", jsonl_lines(method_rows))
    write_json(output_dir / "frontier-map.json", frontier)
    write_text(paper_id_map_output_path(workspace_root, config), jsonl_lines(id_rows))

    return {
        "vault_root": str(vault_root),
        "output_dir": str(output_dir),
        "paper_count": len(paper_rows),
        "claim_count": len(claim_rows),
        "method_count": len(method_rows),
        "issues": issues,
        "feedback_path": str(feedback_output_path(workspace_root, config)),
        "frontier_map": str(frontier_map_output_path(workspace_root, config)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault-root", required=True)
    parser.add_argument("--workspace-root")
    parser.add_argument("--output-dir")
    parser.add_argument("--config")
    parser.add_argument("--scaffold-missing", action="store_true")
    parser.add_argument("--extract-claims", action="store_true")
    parser.add_argument("--overwrite-claims", action="store_true")
    args = parser.parse_args()

    workspace_root = resolve_workspace_root(args.workspace_root)
    config = load_research_config(
        pathlib.Path(args.config).resolve() if args.config else None
    )
    vault_root = pathlib.Path(args.vault_root).resolve()
    output_dir = (
        pathlib.Path(args.output_dir).resolve()
        if args.output_dir
        else index_output_dir(workspace_root, config)
    )
    emit_json(
        build_indexes(
            vault_root,
            workspace_root,
            output_dir,
            scaffold_missing=args.scaffold_missing,
            extract_claims=args.extract_claims,
            overwrite_claims=args.overwrite_claims,
            config=config,
        )
    )


if __name__ == "__main__":
    main()
