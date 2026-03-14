#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import re
import shutil
import sys
from typing import Dict, List, Tuple

SCRIPTS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from ae_common import emit_json
from common import list_paper_dirs


def build_prefix_map(vault_root: pathlib.Path) -> Dict[str, pathlib.Path]:
    prefixes: Dict[str, pathlib.Path] = {}
    for paper_dir in list_paper_dirs(vault_root):
        name = paper_dir.name
        primary = name.split("_")[0]
        prefixes[primary.lower()] = paper_dir
        prefixes[name.lower()] = paper_dir
        acronym_match = re.match(r"([A-Za-z0-9\-]+)", name)
        if acronym_match:
            prefixes[acronym_match.group(1).lower()] = paper_dir
    return prefixes


def classify_root_file(
    path: pathlib.Path, prefixes: Dict[str, pathlib.Path]
) -> pathlib.Path | None:
    stem = path.stem.lower()
    for prefix, paper_dir in prefixes.items():
        if stem.startswith(prefix):
            return paper_dir / path.name
    return None


def should_keep_at_root(path: pathlib.Path) -> bool:
    if path.name.endswith(".base"):
        return True
    if "追踪" in path.name or "报告" in path.name:
        return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault-root", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    vault_root = pathlib.Path(args.vault_root).resolve()
    prefixes = build_prefix_map(vault_root)
    moves: List[Dict[str, str]] = []
    skipped: List[str] = []

    for path in sorted(vault_root.iterdir()):
        if not path.is_file():
            continue
        if should_keep_at_root(path):
            skipped.append(path.name)
            continue
        target = classify_root_file(path, prefixes)
        if target is None:
            skipped.append(path.name)
            continue
        moves.append({"from": str(path), "to": str(target)})
        if not args.dry_run:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                alt = target.with_name(f"{target.stem}-root{target.suffix}")
                shutil.move(str(path), str(alt))
                moves[-1]["to"] = str(alt)
            else:
                shutil.move(str(path), str(target))

    emit_json(
        {
            "vault_root": str(vault_root),
            "moved_count": len(moves),
            "moves": moves,
            "skipped": skipped,
        }
    )


if __name__ == "__main__":
    main()
