#!/usr/bin/env bash
set -euo pipefail

# Basic housekeeping helper: reports heavy folders and old archives.
# Optional: --purge-archives to delete archives older than 90 days (asks confirmation).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/BB"

echo "== Tailles principales =="
du -hd1 sauvegardes_Mizane backend frontend 2>/dev/null | sort -hr

echo
echo "== Archives >60 jours =="
find sauvegardes_Mizane/archives -type f -mtime +60 -print 2>/dev/null || true

if [[ "${1:-}" == "--purge-archives" ]]; then
  echo
  echo "Suppression des archives >90 jours (option activée)"
  find sauvegardes_Mizane/archives -type f -mtime +90 -print0 2>/dev/null | while IFS= read -r -d '' f; do
    printf "Supprimer %s ? [y/N] " "$f"
    read -r ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] && rm -f "$f"
  done
fi
