"""
Liste les décisions de la Cour Suprême sans date valide afin de cibler une ré-analyse IA.

Utilisation :
    python scripts/list_missing_decision_dates.py

Sortie :
    - nombre total
    - liste des IDs à transmettre à /api/coursupreme/batch/analyze
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "backend" / "harvester.db"


def has_valid_date(value: str | None) -> bool:
    if not value:
        return False
    v = value.strip()
    if len(v) < 8:
        return False
    # Formats simples tolérés
    import re
    if re.match(r"^\d{4}[-/]\d{2}[-/]\d{2}$", v):
        return True
    if re.match(r"^\d{2}[-/]\d{2}[-/]\d{4}$", v):
        return True
    # Dates texte basiques (ex: "15 novembre 2017")
    months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
    lower = v.lower()
    if any(m in lower for m in months):
        return True
    return False


def main():
    if not DB_PATH.exists():
        print(f"DB introuvable: {DB_PATH}")
        return
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id, decision_number, decision_date FROM supreme_court_decisions")
    rows = cursor.fetchall()
    conn.close()

    missing = []
    for _id, number, date_val in rows:
        if not has_valid_date(date_val):
            missing.append((_id, number, date_val))

    print(f"Décisions sans date valide : {len(missing)}")
    if not missing:
        return

    # Liste d'ids pour batch/analyze
    ids = [str(x[0]) for x in missing]
    print("IDs (pour /api/coursupreme/batch/analyze) :")
    print(",".join(ids))

    # Quelques exemples
    print("\nExemples :")
    for entry in missing[:5]:
        print(f"  id={entry[0]} number={entry[1]} date='{entry[2]}'")


if __name__ == "__main__":
    main()
