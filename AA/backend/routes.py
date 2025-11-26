from __future__ import annotations

import json
from pathlib import Path
from sqlite3 import Row, connect
from typing import Any, Dict

from flask import Blueprint, jsonify, request

mizane_bp = Blueprint('mizane', __name__)

ROOT = Path(__file__).resolve().parents[3]
DB_PATH = ROOT / 'BB' / 'backend' / 'harvester.db'

DEFAULT_LIMIT = 20


def get_connection():
    if not DB_PATH.exists():
        raise RuntimeError('La base harvester.db est introuvable.')
    conn = connect(str(DB_PATH))
    conn.row_factory = Row
    return conn


def serialize_document(row: Row) -> Dict[str, Any]:
    metadata = row.get('extra_metadata')
    parsed_metadata = None
    if metadata:
        try:
            parsed_metadata = json.loads(metadata)
        except json.JSONDecodeError:
            parsed_metadata = metadata
    return {
        'id': row['id'],
        'publication_date': row['publication_date'],
        'url': row['url'],
        'file_path': row['file_path'],
        'metadata_collected_at': row['metadata_collected_at'],
        'extra_metadata': parsed_metadata or metadata,
        'text_path': row['text_path'],
    }


def build_filter_conditions() -> tuple[str, list[Any]]:
    conds: list[str] = []
    values: list[Any] = []
    year = request.args.get('year')
    if year:
        conds.append("strftime('%Y', publication_date) = ?")
        values.append(year)
    search = request.args.get('search')
    if search:
        pattern = f"%{search}%"
        conds.append("(url LIKE ? OR extra_metadata LIKE ?)")
        values.extend([pattern, pattern])
    from_date = request.args.get('from')
    if from_date:
        conds.append('publication_date >= ?')
        values.append(from_date)
    to_date = request.args.get('to')
    if to_date:
        conds.append('publication_date <= ?')
        values.append(to_date)
    if not conds:
        return '', []
    return 'WHERE ' + ' AND '.join(conds), values


@mizane_bp.route('/documents', methods=['GET'])
def list_documents():
    page = max(1, int(request.args.get('page', 1)))
    limit = min(100, int(request.args.get('limit', DEFAULT_LIMIT)))
    offset = (page - 1) * limit

    where_clause, params = build_filter_conditions()
    with get_connection() as conn:
        total_stmt = f'SELECT COUNT(*) AS total FROM documents {where_clause}'
        cursor = conn.execute(total_stmt, params)
        total = cursor.fetchone()['total']

        stmt = (
            f"SELECT id, publication_date, url, file_path, metadata_collected_at, extra_metadata, text_path "
            f"FROM documents {where_clause} ORDER BY publication_date DESC LIMIT ? OFFSET ?"
        )
        rows = conn.execute(stmt, [*params, limit, offset]).fetchall()

    return jsonify({
        'total': total,
        'documents': [serialize_document(row) for row in rows],
    })


@mizane_bp.route('/statistics', methods=['GET'])
def statistics():
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS total, MAX(publication_date) AS last_updated FROM documents"
        ).fetchone()
    return jsonify({'total': row['total'] or 0, 'last_updated': row['last_updated']})


@mizane_bp.route('/semantic-search', methods=['POST'])
def semantic_search():
    payload = request.get_json(silent=True) or {}
    query = (payload.get('query') or '').strip()
    if not query:
        return jsonify({'query': query, 'results': [], 'message': 'Saisissez une question.'})

    pattern = f'%{query}%'
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, publication_date, url, file_path, metadata_collected_at, extra_metadata, text_path "
            "FROM documents WHERE url LIKE ? OR extra_metadata LIKE ? ORDER BY publication_date DESC LIMIT 5",
            (pattern, pattern),
        ).fetchall()
    results = [serialize_document(row) for row in rows]
    message = f'{len(results)} documents potentiellement associés à votre requête.'
    return jsonify({'query': query, 'results': results, 'message': message})
