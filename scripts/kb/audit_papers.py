#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import sys

SCRIPTS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from common import (
    discover_paper_paths,
    list_paper_dirs,
    load_meta,
    scaffold_machine_layer,
    validate_meta,
)
from ae_common import emit_json


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault-root", required=True)
    parser.add_argument("--scaffold-missing", action="store_true")
    args = parser.parse_args()

    vault_root = pathlib.Path(args.vault_root).resolve()
    papers = []
    missing_meta = 0
    missing_claims = 0
    missing_figure = 0
    for paper_dir in list_paper_dirs(vault_root):
        paths = discover_paper_paths(paper_dir)
        if args.scaffold_missing:
            meta = scaffold_machine_layer(paths)
        else:
            meta = load_meta(paths)
        if not paths.meta.exists():
            missing_meta += 1
        if not paths.figure_note.exists():
            missing_figure += 1
        if not paths.claims.exists():
            missing_claims += 1
        fields_missing = validate_meta(meta or {})
        papers.append(
            {
                "paper_dir": paper_dir.name,
                "markdown": paths.markdown.name if paths.markdown else None,
                "pdf": paths.pdf.name if paths.pdf else None,
                "canvas": paths.canvas.name if paths.canvas else None,
                "has_paper_meta": paths.meta.exists(),
                "has_figure_note": paths.figure_note.exists(),
                "has_claims": paths.claims.exists(),
                "missing_fields": fields_missing,
            }
        )

    emit_json(
        {
            "vault_root": str(vault_root),
            "paper_dir_count": len(papers),
            "missing_paper_meta_count": missing_meta,
            "missing_figure_note_count": missing_figure,
            "missing_claims_count": missing_claims,
            "papers": papers,
        }
    )


if __name__ == "__main__":
    main()
