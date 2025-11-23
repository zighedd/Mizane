#!/usr/bin/env python3
"""Vérifie et répare les statuts de téléchargement, extraction et embedding."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from backend.modules.joradp import routes as joradp_routes


def _normalize_status(status: str | None) -> str:
    if status is None:
        return "pending"
    return str(status).strip().lower()


def _has_embedding(cursor: sqlite3.Cursor, document_id: int, extra_metadata: str | None) -> bool:
    if extra_metadata:
        try:
            payload = json.loads(extra_metadata)
        except json.JSONDecodeError:
            payload = {}
        else:
            embedding = payload.get("embedding")
            if isinstance(embedding, dict):
                vector = embedding.get("vector")
                if isinstance(vector, list) and vector:
                    return True

    cursor.execute(
        "SELECT 1 FROM document_embeddings WHERE document_id = ? LIMIT 1",
        (document_id,),
    )
    return cursor.fetchone() is not None


def repair_statuses(limit: int | None = None, apply: bool = False, verbose: bool = False) -> tuple[int, int, int]:
    joradp_routes._ensure_documents_status_columns()

    conn = joradp_routes.get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                id,
                file_path,
                text_path,
                download_status,
                text_extraction_status,
                embedding_status,
                extra_metadata
            FROM documents
            ORDER BY id
        """)

        rows = cursor.fetchall()
        processed = 0
        candidates = 0
        applied = 0

        for row in rows:
            if limit is not None and processed >= limit:
                break
            processed += 1

            document_id = row["id"]
            joradp_routes._r2_exists.cache_clear()
            file_exists = bool(row["file_path"]) and joradp_routes._r2_exists(row["file_path"])
            text_exists = bool(row["text_path"]) and joradp_routes._r2_exists(row["text_path"])
            embedding_exists = _has_embedding(cursor, document_id, row["extra_metadata"])

            updates: list[str] = []

            download_status = _normalize_status(row["download_status"])
            if file_exists and download_status != "success":
                updates.append("download_status = 'success'")

            text_status = _normalize_status(row["text_extraction_status"])
            if text_exists and text_status != "success":
                updates.append("text_extraction_status = 'success'")

            embedding_status = _normalize_status(row["embedding_status"])
            if embedding_exists and embedding_status != "success":
                updates.append("embedding_status = 'success'")

            if updates:
                candidates += 1
                if verbose:
                    print(
                        f"Document {document_id}: "
                        f"download_status {download_status} -> {'success' if file_exists else download_status}, "
                        f"text_extraction_status {text_status} -> {'success' if text_exists else text_status}, "
                        f"embedding_status {embedding_status} -> {'success' if embedding_exists else embedding_status}"
                    )
                if apply:
                    cursor.execute(
                        f"UPDATE documents SET {', '.join(updates)} WHERE id = ?",
                        (document_id,),
                    )
                    conn.commit()
                    applied += 1
        return processed, candidates, applied
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Vérifie les ressources existantes et met à jour les statuts."
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Limiter le nombre de documents inspectés.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Applique les mises à jour en base (sinon mode lecture seule).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Afficher les documents corrigés.",
    )

    args = parser.parse_args()
    processed, candidates, applied = repair_statuses(args.limit, args.apply, args.verbose)

    summary = f"✅ {processed} documents inspectés"
    if candidates:
        summary += f", {candidates} documents corrigeables."
        summary += " Modifications appliquées." if args.apply else " Mode simulation (aucune écriture)."
    else:
        summary += ", aucun document à corriger."
    if args.apply and applied:
        summary += f" {applied} lignes mises à jour."
    print(summary)


if __name__ == "__main__":
    main()
