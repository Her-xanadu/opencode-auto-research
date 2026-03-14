#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import sys

SCRIPTS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from ae_common import emit_json
from build_index import build_indexes
from common import (
    discover_paper_paths,
    index_output_dir,
    list_paper_dirs,
    load_research_config,
    resolve_workspace_root,
    scaffold_claims,
    scaffold_machine_layer,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault-root", required=True)
    parser.add_argument("--workspace-root")
    parser.add_argument("--config")
    args = parser.parse_args()

    workspace_root = resolve_workspace_root(args.workspace_root)
    config = load_research_config(
        pathlib.Path(args.config).resolve() if args.config else None
    )
    vault_root = pathlib.Path(args.vault_root).resolve()
    touched = []
    for paper_dir in list_paper_dirs(vault_root):
        paths = discover_paper_paths(paper_dir)
        meta = scaffold_machine_layer(paths)
        before_claims = paths.claims.exists()
        scaffold_claims(paths, meta)
        if (
            not before_claims
            or not paths.meta.exists()
            or not paths.figure_note.exists()
        ):
            touched.append(paper_dir.name)
    index_result = build_indexes(
        vault_root,
        workspace_root,
        index_output_dir(workspace_root, config),
        scaffold_missing=True,
        extract_claims=False,
        config=config,
    )
    emit_json(
        {
            "touched_papers": touched,
            "touched_count": len(touched),
            "index_result": index_result,
        }
    )


if __name__ == "__main__":
    main()
