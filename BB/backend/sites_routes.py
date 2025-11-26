from flask import request, jsonify
import sqlite3
import math


def _safe_split_csv(value: str):
    if not value:
        return []
    return [chunk.strip() for chunk in value.split(',') if chunk.strip()]


def _semantic_rank(session_id: int, query: str, limit: int = 500):
    """Retourne une liste ordonnée (doc_id, score) pour une requête sémantique.

    La fonction reste tolérante : si le modèle ou numpy manquent, on renvoie
    ([], "message d'erreur") afin que l'appelant puisse afficher un fallback.
    """
    try:
        from analysis import get_embedding_model
        import numpy as np
    except Exception as exc:  # numpy ou import indisponible
        return [], f"embedding non disponible ({exc})"

    model = get_embedding_model()
    if not model:
        return [], "Aucun modèle d'embedding disponible"

    try:
        query_vec = model.encode(query, convert_to_numpy=True, normalize_embeddings=True)
    except Exception as exc:
        return [], f"Impossible de générer l'embedding requête : {exc}"

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT d.id, e.embedding, e.dimension
        FROM document_embeddings e
        JOIN documents d ON d.id = e.document_id
        WHERE d.session_id = ? AND e.embedding IS NOT NULL
        """,
        (session_id,),
    )

    scores = []
    for row in cursor.fetchall():
        try:
            emb = np.frombuffer(row["embedding"], dtype=np.float32)
            if row["dimension"] and emb.shape[0] >= row["dimension"]:
                emb = emb[: row["dimension"]]
            if emb.size == 0:
                continue
            norm = np.linalg.norm(emb)
            if norm == 0 or math.isnan(norm):
                continue
            emb = emb / norm
            score = float(np.dot(query_vec, emb))
            scores.append((row["id"], score))
        except Exception:
            continue

    conn.close()
    scores.sort(key=lambda tup: tup[1], reverse=True)
    return scores[:limit], None

def get_db_connection():
    conn = sqlite3.connect('harvester.db')
    conn.row_factory = sqlite3.Row
    return conn


VALID_STATUS_VALUES = {'pending', 'in_progress', 'success', 'failed'}

def normalize_status(status):
    """Normalize raw status value into one of the allowed states."""
    if status is None:
        return 'pending'

    normalized = str(status).strip().lower()
    if normalized in VALID_STATUS_VALUES:
        return normalized

    if normalized == 'skipped':
        return 'pending'

    return 'pending'


def register_sites_routes(app):
    
    @app.route('/api/sites', methods=['GET'])
    def get_sites():
        """Liste tous les sites avec statistiques agrégées"""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Récupérer tous les sites
            cursor.execute("""
                SELECT 
                    s.id,
                    s.name,
                    s.url,
                    s.created_at,
                    COUNT(DISTINCT hs.id) as nb_sessions,
                    COUNT(d.id) as nb_documents,
                    SUM(CASE WHEN hs.status = 'running' THEN 1 ELSE 0 END) as nb_running
                FROM sites s
                LEFT JOIN harvesting_sessions hs ON s.id = hs.site_id
                LEFT JOIN documents d ON hs.id = d.session_id
                GROUP BY s.id
                ORDER BY s.created_at DESC
            """)
            
            sites = []
            for row in cursor.fetchall():
                sites.append({
                    'id': row['id'],
                    'name': row['name'],
                    'url': row['url'],
                    'created_at': row['created_at'],
                    'nb_sessions': row['nb_sessions'] or 0,
                    'nb_documents': row['nb_documents'] or 0,
                    'status': 'running' if row['nb_running'] > 0 else 'idle'
                })
            
            conn.close()
            return jsonify({'success': True, 'sites': sites})
            
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    
    @app.route('/api/sites/<int:site_id>/sessions', methods=['GET'])
    def get_site_sessions(site_id):
        """Liste toutes les sessions d'un site"""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT 
                    hs.id,
                    hs.session_name,
                    hs.status,
                    hs.current_phase,
                    hs.created_at,
                    COUNT(d.id) as nb_documents,
                    SUM(CASE WHEN d.metadata_collection_status = 'success' THEN 1 ELSE 0 END) as nb_collected,
                    SUM(CASE WHEN d.download_status = 'success' THEN 1 ELSE 0 END) as nb_downloaded,
                    SUM(CASE WHEN d.text_extraction_status = 'success' THEN 1 ELSE 0 END) as nb_text_extracted,
                    SUM(CASE WHEN d.ai_analysis_status = 'success' THEN 1 ELSE 0 END) as nb_analyzed,
                    SUM(CASE WHEN d.embedding_status = 'success' THEN 1 ELSE 0 END) as nb_embedded
                FROM harvesting_sessions hs
                LEFT JOIN documents d ON hs.id = d.session_id
                WHERE hs.site_id = ?
                GROUP BY hs.id
                ORDER BY hs.created_at DESC
            """, (site_id,))
            
            sessions = []
            session_rows = cursor.fetchall()
            for row in session_rows:
                sessions.append({
                    'id': row['id'],
                    'session_name': row['session_name'],
                    'status': row['status'],
                    'current_phase': row['current_phase'],
                    'created_at': row['created_at'],
                    'nb_documents': row['nb_documents'] or 0,
                    'phases': {
                        'collect': {'done': row['nb_collected'] or 0, 'total': row['nb_documents'] or 0},
                        'download': {'done': row['nb_downloaded'] or 0, 'total': row['nb_documents'] or 0},
                        'text_extraction': {'done': row['nb_text_extracted'] or 0, 'total': row['nb_documents'] or 0},
                        'analyze': {'done': row['nb_analyzed'] or 0, 'total': row['nb_documents'] or 0},
                        'embeddings': {'done': row['nb_embedded'] or 0, 'total': row['nb_documents'] or 0}
                    }
                })

            details_cursor = conn.cursor()
            for session in sessions:
                details_cursor.execute("""
                    SELECT 
                        d.metadata_collection_status,
                        d.download_status,
                        d.text_extraction_status,
                        d.ai_analysis_status,
                        d.embedding_status,
                        d.file_path,
                        d.text_path
                    FROM documents d
                    WHERE d.session_id = ?
                """, (session['id'],))
                doc_rows = details_cursor.fetchall()
                total_docs = len(doc_rows) or session['nb_documents']

                collected_done = downloaded_done = text_done = analyzed_done = embedded_done = 0
                for doc in doc_rows:
                    collected_status = normalize_status(doc['metadata_collection_status'])
                    download_status = normalize_status(doc['download_status'])
                    text_status = normalize_status(doc['text_extraction_status'])
                    analyze_status = normalize_status(doc['ai_analysis_status'])
                    embedding_status = normalize_status(doc['embedding_status'])

                    if collected_status == 'success':
                        collected_done += 1
                    if download_status == 'success':
                        downloaded_done += 1
                    if text_status == 'success':
                        text_done += 1
                    if analyze_status == 'success':
                        analyzed_done += 1
                    if embedding_status == 'success':
                        embedded_done += 1

                session['nb_documents'] = total_docs
                session['phases'] = {
                    'collect': {'done': collected_done, 'total': total_docs},
                    'download': {'done': downloaded_done, 'total': total_docs},
                    'text_extraction': {'done': text_done, 'total': total_docs},
                    'analyze': {'done': analyzed_done, 'total': total_docs},
                    'embeddings': {'done': embedded_done, 'total': total_docs},
                }
            
            conn.close()
            return jsonify({'success': True, 'sessions': sessions})
            
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    
    @app.route('/api/sites/<int:site_id>/sessions', methods=['POST'])
    def create_site_session(site_id):
        """Créer une nouvelle session avec tous les paramètres"""
        data = request.json
        session_name = data.get('session_name')
        
        if not session_name:
            return jsonify({'error': 'session_name requis'}), 400
        
        # Paramètres
        max_documents = data.get('max_documents')
        start_number = data.get('start_number')
        end_number = data.get('end_number')
        schedule_config = data.get('schedule_config')
        filter_date_start = data.get('filter_date_start')
        filter_date_end = data.get('filter_date_end')
        filter_keywords = data.get('filter_keywords')
        filter_languages = data.get('filter_languages')
        
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO harvesting_sessions 
                (site_id, session_name, status, max_documents, start_number, end_number, 
                 schedule_config, filter_date_start, filter_date_end, 
                 filter_keywords, filter_languages, created_at)
                VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (site_id, session_name, max_documents, start_number, end_number, 
                  schedule_config, filter_date_start, filter_date_end,
                  filter_keywords, filter_languages))
            
            session_id = cursor.lastrowid
            conn.commit()
            conn.close()
            
            return jsonify({'success': True, 'session_id': session_id})
            
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Une session avec ce nom existe déjà pour ce site'}), 409
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    
    @app.route('/api/sites/delete', methods=['POST'])
    def delete_sites():
        """Supprimer plusieurs sites (bulk)"""
        data = request.json
        site_ids = data.get('site_ids', [])
        
        if not site_ids:
            return jsonify({'error': 'site_ids requis'}), 400
        
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            placeholders = ','.join('?' * len(site_ids))
            cursor.execute(f"DELETE FROM sites WHERE id IN ({placeholders})", site_ids)
            
            deleted = cursor.rowcount
            conn.commit()
            conn.close()
            
            return jsonify({'success': True, 'deleted': deleted})
            
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    
    @app.route('/api/sessions/delete', methods=['POST'])
    def delete_sessions():
        """Supprimer plusieurs sessions (bulk)"""
        data = request.json
        session_ids = data.get('session_ids', [])
        
        if not session_ids:
            return jsonify({'error': 'session_ids requis'}), 400
        
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            placeholders = ','.join('?' * len(session_ids))
            cursor.execute(f"DELETE FROM harvesting_sessions WHERE id IN ({placeholders})", session_ids)
            
            deleted = cursor.rowcount
            conn.commit()
            conn.close()
            
            return jsonify({'success': True, 'deleted': deleted})
            
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/sessions/<int:session_id>/documents')
    def get_session_documents(session_id):
        """Récupérer les documents d'une session avec pagination"""
        try:
            page = int(request.args.get('page', 1))
            per_page = int(request.args.get('per_page', 20))

            # Filtres optionnels
            year = request.args.get('year')
            date_debut = request.args.get('date_debut')
            date_fin = request.args.get('date_fin')
            status = request.args.get('status', 'all')
            search_num = request.args.get('search_num')
            keywords_tous = request.args.get('keywords_tous') or request.args.get('keywordsTous')
            keywords_un_de = request.args.get('keywords_un_de') or request.args.get('keywordsUnDe')
            keywords_exclut = request.args.get('keywords_exclut') or request.args.get('keywordsExclut')
            search_semantique = request.args.get('search_semantique') or request.args.get('searchSemantique')

            conn = get_db_connection()
            cursor = conn.cursor()

            # Construire la requête avec filtres
            where_clauses = ['d.session_id = ?']
            params = [session_id]
            join_sql = ""

            if year:
                # Chercher l'année dans l'URL (ex: F1973xxx.pdf)
                where_clauses.append("d.url LIKE ?")
                params.append(f'%F{year}%')

            if date_debut:
                where_clauses.append('d.publication_date >= ?')
                params.append(date_debut)

            if date_fin:
                where_clauses.append('d.publication_date <= ?')
                params.append(date_fin)

            if status != 'all':
                if status == 'collected':
                    where_clauses.append("d.metadata_collection_status = 'success'")
                elif status == 'downloaded':
                    where_clauses.append("d.download_status = 'success'")
                elif status == 'analyzed':
                    where_clauses.append("d.ai_analysis_status = 'success'")

            if search_num:
                where_clauses.append('d.url LIKE ?')
                params.append(f'%{search_num}%')

            # Filtres textuels basés sur les analyses IA (keywords + summary)
            keyword_fields = [
                "LOWER(COALESCE(ai.keywords, ''))",
                "LOWER(COALESCE(ai.summary, ''))",
                "LOWER(COALESCE(ai.additional_metadata, ''))",
            ]

            if keywords_tous:
                join_sql = "LEFT JOIN document_ai_analysis ai ON ai.document_id = d.id"
                for kw in _safe_split_csv(keywords_tous.lower()):
                    clause = ' OR '.join([f"{field} LIKE ?" for field in keyword_fields])
                    where_clauses.append(f"({clause})")
                    params.extend([f"%{kw}%"] * len(keyword_fields))

            if keywords_un_de:
                join_sql = "LEFT JOIN document_ai_analysis ai ON ai.document_id = d.id"
                ors = []
                kw_params = []
                for kw in _safe_split_csv(keywords_un_de.lower()):
                    ors.extend([f"{field} LIKE ?" for field in keyword_fields])
                    kw_params.extend([f"%{kw}%"] * len(keyword_fields))
                if ors:
                    where_clauses.append("(" + " OR ".join(ors) + ")")
                    params.extend(kw_params)

            if keywords_exclut:
                join_sql = "LEFT JOIN document_ai_analysis ai ON ai.document_id = d.id"
                for kw in _safe_split_csv(keywords_exclut.lower()):
                    for field in keyword_fields:
                        where_clauses.append(f"{field} NOT LIKE ?")
                        params.append(f"%{kw}%")

            where_sql = ' AND '.join(where_clauses)

            base_select = f"""
                    SELECT 
                        d.id,
                        d.url,
                        d.publication_date,
                        d.file_size_bytes,
                        d.metadata_collection_status,
                        d.download_status,
                        d.text_extraction_status,
                        d.ai_analysis_status,
                        d.embedding_status,
                        d.file_path,
                        d.text_path
                    FROM documents d
                    {join_sql}
                    WHERE {where_sql}
            """

            # Si recherche sémantique : on récupère tout et on trie côté Python (pour conserver l'ordre de similarité)
            if search_semantique:
                cursor.execute(base_select, params)
                rows = cursor.fetchall()
                total_pre_filter = len(rows)
            else:
                cursor.execute(f'SELECT COUNT(*) FROM documents d {join_sql} WHERE {where_sql}', params)
                total = cursor.fetchone()[0]
                offset = (page - 1) * per_page
                cursor.execute(
                    base_select + " ORDER BY d.publication_date DESC, d.url DESC LIMIT ? OFFSET ?",
                    params + [per_page, offset]
                )
                rows = cursor.fetchall()

            documents = []
            for row in rows:
                # Extraire le numéro depuis l'URL
                filename = row['url'].split('/')[-1]  # F2024001.pdf
                num = filename[5:8] if len(filename) > 8 else '000'

                # Extraire l'année de l'URL (ex: F1973001.pdf -> 1973)
                import re
                year_match = re.search(r'F(\d{4})\d{3}\.pdf', row['url'])
                year_str = year_match.group(1) if year_match else None

                file_exists = bool(row['file_path'])
                text_exists = bool(row['text_path'])

                collected_status = normalize_status(row['metadata_collection_status'])
                downloaded_status = normalize_status(row['download_status'])
                text_status = normalize_status(row['text_extraction_status'])
                analyzed_status = normalize_status(row['ai_analysis_status'])
                embedding_status = normalize_status(row['embedding_status'])

                documents.append({
                    'id': row['id'],
                    'url': row['url'],
                    'numero': num,
                    'date': year_str,  # Année extraite de l'URL
                    'publication_date': row['publication_date'],  # Vraie date (sera remplie par IA)
                    'size_kb': round(row['file_size_bytes'] / 1024, 1) if row['file_size_bytes'] else 0,
                    'file_path': row['file_path'],
                    'text_path': row['text_path'],
                    'file_exists': file_exists,
                    'text_exists': text_exists,
                    'statuts': {
                        'collected': collected_status,
                        'downloaded': downloaded_status,
                        'text_extracted': text_status,
                        'analyzed': analyzed_status,
                        'embedded': embedding_status,
                    }
                })

            if search_semantique:
                scores, sem_error = _semantic_rank(session_id, search_semantique, limit=5000)
                score_map = {doc_id: score for doc_id, score in scores}
                documents = [doc for doc in documents if doc['id'] in score_map]
                documents.sort(key=lambda d: score_map.get(d['id'], 0), reverse=True)
                total = len(documents)
                offset = (page - 1) * per_page
                documents = documents[offset: offset + per_page]
                for doc in documents:
                    doc['similarity'] = round(score_map.get(doc['id'], 0.0), 3)
                pagination_meta = {
                    'page': page,
                    'per_page': per_page,
                    'total': total,
                    'semantic_query': search_semantique,
                    'pre_filtered': total_pre_filter,
                    'semantic_error': sem_error,
                }
            else:
                pagination_meta = {
                    'page': page,
                    'per_page': per_page,
                    'total': total,
                    'total_pages': (total + per_page - 1) // per_page
                }

            conn.close()

            return jsonify({
                'success': True,
                'documents': documents,
                'pagination': pagination_meta
            })

        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/documents/<int:doc_id>', methods=['DELETE'])
    def delete_document(doc_id):
        """Supprimer un document de la base de données"""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute('SELECT id FROM documents WHERE id = ?', (doc_id,))
            if not cursor.fetchone():
                conn.close()
                return jsonify({'error': 'Document non trouvé'}), 404
            
            cursor.execute('DELETE FROM documents WHERE id = ?', (doc_id,))
            conn.commit()
            conn.close()
            
            return jsonify({'success': True, 'message': 'Document supprimé'})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    
    @app.route('/api/sites/<int:site_id>', methods=['GET'])
    def get_site_by_id(site_id):
        """Récupérer les paramètres d'un site par ID"""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("SELECT * FROM sites WHERE id = ?", (site_id,))
            site = cursor.fetchone()
            conn.close()
            
            if not site:
                return jsonify({'error': 'Site non trouvé'}), 404
            
            return jsonify({'success': True, 'site': dict(site)})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/sites/<int:site_id>', methods=['PUT'])
    def update_site_settings(site_id):
        """Modifier les paramètres d'un site"""
        try:
            data = request.json
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE sites 
                SET name = ?,
                    url = ?,
                    site_type = ?,
                    workers_parallel = ?,
                    timeout_seconds = ?,
                    delay_between_requests = ?,
                    delay_before_retry = ?
                WHERE id = ?
            """, (
                data.get('name'),
                data.get('url'),
                data.get('site_type'),
                data.get('workers_parallel'),
                data.get('timeout_seconds'),
                data.get('delay_between_requests'),
                data.get('delay_before_retry'),
                site_id
            ))
            
            conn.commit()
            conn.close()
            
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/sessions/<int:session_id>/settings', methods=['GET'])
    def get_session_settings(session_id):
        """Récupérer les paramètres d'une session"""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("SELECT * FROM harvesting_sessions WHERE id = ?", (session_id,))
            session = cursor.fetchone()
            conn.close()
            
            if not session:
                return jsonify({'error': 'Session non trouvée'}), 404
            
            return jsonify({'success': True, 'session': dict(session)})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/sessions/<int:session_id>/settings', methods=['PUT'])
    def update_session_settings(session_id):
        """Modifier les paramètres d'une session"""
        try:
            data = request.json
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE harvesting_sessions 
                SET max_documents = ?,
                    start_number = ?,
                    end_number = ?,
                    filter_date_start = ?,
                    filter_date_end = ?,
                    filter_keywords = ?,
                    schedule_config = ?
                WHERE id = ?
            """, (
                data.get('max_documents'),
                data.get('start_number'),
                data.get('end_number'),
                data.get('filter_date_start'),
                data.get('filter_date_end'),
                data.get('filter_keywords'),
                data.get('schedule_config'),
                session_id
            ))
            
            conn.commit()
            conn.close()
            
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
