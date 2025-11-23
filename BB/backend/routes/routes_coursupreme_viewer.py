"""
Routes API hiérarchiques pour Cour Suprême
"""
from flask import jsonify, request
from . import api_bp
import sqlite3

DB_PATH = '../harvester.db'

def get_db():
    return sqlite3.connect(DB_PATH)


def _parse_id_list(value: str):
    ids = []
    for part in (value or '').split(','):
        part = part.strip()
        if not part:
            continue
        try:
            ids.append(int(part))
        except ValueError:
            continue
    return ids


def _format_display_date(value: str | None) -> str:
    if not value:
        return ''
    value = value.strip()
    for fmt in ('%d/%m/%Y', '%d-%m-%Y', '%Y-%m-%d', '%Y/%m/%d'):
        try:
            import datetime
            dt = datetime.datetime.strptime(value, fmt)
            return dt.strftime('%d-%m-%Y')
        except ValueError:
            continue
    return value.replace('/', '-')

@api_bp.route('/coursupreme/chambers', methods=['GET'])
def get_chambers():
    """Liste des sections avec statistiques"""
    conn = get_db()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            c.id,
            c.name_ar,
            c.name_fr,
            COUNT(DISTINCT dc.theme_id) as theme_count,
            COUNT(DISTINCT dc.decision_id) as decision_count
        FROM supreme_court_chambers c
        LEFT JOIN supreme_court_decision_classifications dc ON dc.chamber_id = c.id
        WHERE c.active = 1
        GROUP BY c.id
        ORDER BY c.id
    """)
    
    chambers = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify({'chambers': chambers})

@api_bp.route('/coursupreme/chambers/<int:chamber_id>/themes', methods=['GET'])
def get_chamber_themes(chamber_id):
    """Thèmes d'une section avec nb décisions"""
    conn = get_db()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            t.id,
            t.name_ar,
            COUNT(DISTINCT dc.decision_id) as decision_count
        FROM supreme_court_themes t
        LEFT JOIN supreme_court_decision_classifications dc ON dc.theme_id = t.id
        WHERE t.chamber_id = ?
        GROUP BY t.id
        HAVING decision_count > 0
        ORDER BY decision_count DESC
    """, (chamber_id,))
    
    themes = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify({'themes': themes})

@api_bp.route('/coursupreme/themes/<int:theme_id>/decisions', methods=['GET'])
def get_theme_decisions(theme_id):
    """Décisions d'un thème"""
    conn = get_db()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            d.id,
            d.decision_number,
            d.decision_date,
            d.object_ar,
            d.url
        FROM supreme_court_decisions d
        JOIN supreme_court_decision_classifications dc ON dc.decision_id = d.id
        WHERE dc.theme_id = ?
        ORDER BY d.decision_date DESC
    """, (theme_id,))
    
    decisions = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify({'decisions': decisions})


@api_bp.route('/coursupreme/search', methods=['GET'])
def search_decisions():
    """Recherche dans les décisions"""
    query = request.args.get('q', '').strip()
    
    if not query:
        return jsonify({'results': []})
    
    conn = get_db()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    search_pattern = f'%{query}%'
    
    cursor.execute("""
        SELECT DISTINCT
            d.id,
            d.decision_number,
            d.decision_date,
            d.object_ar,
            d.url
        FROM supreme_court_decisions d
        WHERE 
            d.decision_number LIKE ?
            OR d.decision_date LIKE ?
            OR d.object_ar LIKE ?
            OR d.parties_ar LIKE ?
        ORDER BY d.decision_date DESC
        LIMIT 50
    """, (search_pattern, search_pattern, search_pattern, search_pattern))
    
    results = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify({'results': results, 'count': len(results)})


@api_bp.route('/coursupreme/search', methods=['GET'])

@api_bp.route('/coursupreme/search/advanced', methods=['GET'])
def advanced_search_decisions():
    """Ancienne route avancée (désactivée, utiliser modules.coursupreme.routes)."""
    return jsonify({
        'error': 'Route legacy désactivée. Utiliser /api/coursupreme/search/advanced (nouveau module).'
    }), 410
    keywords_inc = request.args.get('keywords_inc', '').strip()
    keywords_exc = request.args.get('keywords_exc', '').strip()
    decision_number = request.args.get('decision_number', '').strip()
    date_from = request.args.get('date_from', '').strip()
    date_to = request.args.get('date_to', '').strip()
    chambers_or = _parse_id_list(request.args.get('chambers_or', ''))
    chambers_inc = _parse_id_list(request.args.get('chambers_inc', ''))
    themes_or = _parse_id_list(request.args.get('themes_or', ''))
    themes_inc = _parse_id_list(request.args.get('themes_inc', ''))
    
    conn = get_db()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    query = """
        SELECT DISTINCT
            d.id,
            d.decision_number,
            d.decision_date,
            d.object_ar,
            d.url
        FROM supreme_court_decisions d
    """
    
    conditions = []
    params = []
    candidate_ids = None

    def intersect_ids(id_set):
        nonlocal candidate_ids
        if id_set is None:
            return
        if candidate_ids is None:
            candidate_ids = set(id_set)
        else:
            candidate_ids &= set(id_set)
        return candidate_ids
    
    if chambers_inc:
        placeholders = ','.join(['?' for _ in chambers_inc])
        cursor.execute(f"""
            SELECT decision_id
            FROM supreme_court_decision_classifications
            WHERE chamber_id IN ({placeholders})
            GROUP BY decision_id
            HAVING COUNT(DISTINCT chamber_id) >= ?
        """, (*chambers_inc, len(chambers_inc)))
        intersect_ids({row[0] for row in cursor.fetchall()})
        if candidate_ids is not None and not candidate_ids:
            conn.close()
            return jsonify({'results': [], 'count': 0})

    if themes_inc:
        placeholders = ','.join(['?' for _ in themes_inc])
        cursor.execute(f"""
            SELECT decision_id
            FROM supreme_court_decision_classifications
            WHERE theme_id IN ({placeholders})
            GROUP BY decision_id
            HAVING COUNT(DISTINCT theme_id) >= ?
        """, (*themes_inc, len(themes_inc)))
        intersect_ids({row[0] for row in cursor.fetchall()})
        if candidate_ids is not None and not candidate_ids:
            conn.close()
            return jsonify({'results': [], 'count': 0})

    if keywords_inc:
        keywords = keywords_inc.split()
        for kw in keywords:
            conditions.append("(d.object_ar LIKE ? OR d.parties_ar LIKE ? OR d.arguments_ar LIKE ?)")
            params.extend([f'%{kw}%', f'%{kw}%', f'%{kw}%'])
    
    if keywords_exc:
        keywords = keywords_exc.split()
        for kw in keywords:
            conditions.append("(d.object_ar NOT LIKE ? AND d.parties_ar NOT LIKE ? AND d.arguments_ar NOT LIKE ?)")
            params.extend([f'%{kw}%', f'%{kw}%', f'%{kw}%'])
    
    if decision_number:
        conditions.append("d.decision_number LIKE ?")
        params.append(f'%{decision_number}%')

    if candidate_ids is not None:
        conditions.append(f"d.id IN ({','.join('?' for _ in candidate_ids)})")
        params.extend(sorted(candidate_ids))

    if chambers_or:
        placeholders = ','.join(['?' for _ in chambers_or])
        conditions.append(f"d.id IN (SELECT decision_id FROM supreme_court_decision_classifications WHERE chamber_id IN ({placeholders}))")
        params.extend(chambers_or)

    if themes_or:
        placeholders = ','.join(['?' for _ in themes_or])
        conditions.append(f"d.id IN (SELECT decision_id FROM supreme_court_decision_classifications WHERE theme_id IN ({placeholders}))")
        params.extend(themes_or)
    
    if date_from:
        conditions.append("d.decision_date >= ?")
        params.append(date_from)
    
    if date_to:
        conditions.append("d.decision_date <= ?")
        params.append(date_to)
    
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    
    query += " ORDER BY d.decision_date DESC LIMIT 100"
    
    cursor.execute(query, params)
    results = []
    for row in cursor.fetchall():
        item = dict(row)
        item['decision_date'] = _format_display_date(item.get('decision_date'))
        results.append(item)
    conn.close()
    
    return jsonify({'results': results, 'count': len(results)})

@api_bp.route('/coursupreme/decisions/<int:decision_id>', methods=['GET'])
def get_decision_detail(decision_id):
    """Détail complet d'une décision"""
    conn = get_db()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, decision_number, decision_date, url, file_path_ar, file_path_fr
        FROM supreme_court_decisions
        WHERE id = ?
    """, (decision_id,))
    
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        return jsonify({'error': 'Décision non trouvée'}), 404
    
    decision = dict(row)
    
    if decision.get('file_path_ar'):
        try:
            with open(decision['file_path_ar'], 'r', encoding='utf-8') as f:
                decision['content_ar'] = f.read()
        except:
            decision['content_ar'] = None
    
    if decision.get('file_path_fr'):
        try:
            with open(decision['file_path_fr'], 'r', encoding='utf-8') as f:
                decision['content_fr'] = f.read()
        except:
            decision['content_fr'] = None
    
    conn.close()
    
    return jsonify(decision)

@api_bp.route('/coursupreme/decisions/<int:decision_id>', methods=['DELETE'])
def delete_decision(decision_id):
    """Supprime une décision (BDD + fichiers)"""
    import os
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT file_path_ar, file_path_fr
        FROM supreme_court_decisions
        WHERE id = ?
    """, (decision_id,))
    
    row = cursor.fetchone()
    
    if not row:
        return jsonify({'error': 'Décision non trouvée'}), 404
    
    file_ar, file_fr = row
    
    try:
        if file_ar and os.path.exists(file_ar):
            os.remove(file_ar)
        if file_fr and os.path.exists(file_fr):
            os.remove(file_fr)
        
        cursor.execute("DELETE FROM supreme_court_decision_classifications WHERE decision_id = ?", (decision_id,))
        cursor.execute("DELETE FROM supreme_court_decisions WHERE id = ?", (decision_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Décision supprimée', 'status': 'success'})
        
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500

@api_bp.route('/coursupreme/download/<int:decision_id>', methods=['POST'])
def download_decision(decision_id):
    """Télécharge, extrait et traduit une décision"""
    import sys
    sys.path.insert(0, '..')
    from auto_translator import translator
    import requests
    from bs4 import BeautifulSoup
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, decision_number, decision_date, url, file_path_ar
        FROM supreme_court_decisions
        WHERE id = ?
    """, (decision_id,))
    
    row = cursor.fetchone()
    
    if not row:
        return jsonify({'error': 'Décision non trouvée'}), 404
    
    dec_id, num, date, url, existing_file = row
    
    if existing_file:
        return jsonify({'message': 'Décision déjà téléchargée', 'status': 'exists'})
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        cursor.execute("""
            UPDATE supreme_court_decisions
            SET html_content_ar = ?
            WHERE id = ?
        """, (response.text, dec_id))
        conn.commit()
        
        success = translator.translate_and_save_decision(
            dec_id, num, date, response.text, conn
        )
        
        conn.close()
        
        if success:
            return jsonify({'message': 'Décision téléchargée et traduite', 'status': 'success'})
        else:
            return jsonify({'error': 'Erreur traduction'}, 500)
            
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500

@api_bp.route('/coursupreme/metadata/<int:decision_id>', methods=['GET'])
def get_decision_metadata(decision_id):
    """Récupérer les métadonnées IA d'une décision"""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT decision_number, decision_date,
                   summary_ar, summary_fr,
                   title_ar, title_fr,
                   entities_ar, entities_fr
            FROM supreme_court_decisions
            WHERE id = ?
        """, (decision_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return jsonify({'error': 'Décision non trouvée'}), 404
        
        return jsonify(dict(row))
        
    except Exception as e:
        print(f"Erreur metadata: {e}")
        return jsonify({'error': str(e)}), 500
