import json
import os
import sqlite3
import sys

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from modules.joradp.routes import ensure_document_publication_date


def ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def run():
    db_path = ROOT / 'harvester.db'
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM documents")

    updates = 0
    for row in cursor.fetchall():
        if ensure_document_publication_date(conn, row['id']):
            updates += 1

    conn.commit()
    conn.close()

    print(f"✅ Mises à jour effectuées sur {updates} documents")


if __name__ == "__main__":
    run()
