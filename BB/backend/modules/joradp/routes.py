from __future__ import annotations
from flask import Blueprint, jsonify, request, redirect, send_file
import sqlite3
import json
import io
import os
import requests
import time
import zipfile
from functools import lru_cache
from requests.adapters import HTTPAdapter
from shared.r2_storage import (
    generate_presigned_url,
    build_public_url,
    upload_bytes,
    delete_object as delete_r2_object,
    normalize_key,
)

joradp_bp = Blueprint('joradp', __name__)
DB_PATH = 'harvester.db'


JORADP_R2_PREFIX = "Textes_juridiques_DZ/joradp.dz"


def _build_r2_session():
    session = requests.Session()
    adapter = HTTPAdapter(pool_connections=16, pool_maxsize=32, pool_block=True)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.setdefault("User-Agent", "DocHarvester/1.0")
    return session


_R2_SESSION = _build_r2_session()


def _extract_year_from_filename(filename: str) -> str:
    if len(filename) >= 5 and filename[1:5].isdigit():
        return filename[1:5]
    return "unknown"


def _build_pdf_key(filename: str) -> str:
    year = _extract_year_from_filename(filename)
    return f"{JORADP_R2_PREFIX}/{year}/{filename}"


def _build_text_key(pdf_key: str) -> str:
    if pdf_key.endswith(".pdf"):
        return pdf_key[:-4] + ".txt"
    return f"{pdf_key}.txt"


def _ensure_public_url(raw_path: str | None) -> str | None:
    if not raw_path:
        return None
    return build_public_url(raw_path)


def _fetch_r2_text(raw_path: str | None) -> str | None:
    if not raw_path:
        return None
    url = generate_presigned_url(raw_path) or build_public_url(raw_path)
    if not url:
        return None
    try:
        with _R2_SESSION.get(url, timeout=60) as resp:
            if resp.ok:
                resp.encoding = 'utf-8'
                return resp.text
    except Exception:
        return None
    return None


def _fetch_r2_bytes(raw_path: str | None) -> bytes | None:
    if not raw_path:
        return None
    url = generate_presigned_url(raw_path) or build_public_url(raw_path)
    if not url:
        return None
    try:
        with _R2_SESSION.get(url, timeout=60) as resp:
            if resp.ok:
                return resp.content
    except Exception:
        return None
    return None


@lru_cache(maxsize=2048)
def _r2_exists(raw_path: str | None) -> bool:
    if not raw_path:
        return False
    url = generate_presigned_url(raw_path) or build_public_url(raw_path)
    if not url:
        return False
    try:
        resp = _R2_SESSION.head(url, timeout=10)
        if resp.status_code == 403:
            probe = _R2_SESSION.get(url, stream=True, timeout=10)
            exists = probe.status_code == 200
            probe.close()
            resp.close()
            return exists
        exists = resp.status_code == 200
        resp.close()
        return exists
    except Exception:
        return False


@joradp_bp.before_app_request
def _clear_r2_exists_cache():
    _r2_exists.cache_clear()


def build_r2_url(raw_path: str | None) -> str | None:
    """
    Retourne une URL R2 (pré-signée si possible) pour le chemin donné.
    """
    if not raw_path:
        return None
    return generate_presigned_url(raw_path)


def _derive_pdf_key(file_path: str | None, url: str) -> str:
    key = normalize_key(file_path) if file_path else None
    if key:
        return key
    filename = url.split('/')[-1]
    return _build_pdf_key(filename)


def _ensure_text_content(doc_id: int, file_path: str | None, text_path: str | None, url: str):
    """
    Retourne le texte associé à un document, en le générant si nécessaire.
    """
    existing_text = _fetch_r2_text(text_path)
    if existing_text:
        return existing_text, text_path

    pdf_bytes = _fetch_r2_bytes(file_path)
    if not pdf_bytes:
        with _R2_SESSION.get(url, timeout=60) as response:
            response.raise_for_status()
            pdf_bytes = response.content

    import PyPDF2

    reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
    extracted_text = ""
    for page in reader.pages:
        extracted_text += (page.extract_text() or "") + "\n"

    pdf_key = _derive_pdf_key(file_path, url)
    text_key = _build_text_key(pdf_key)
    uploaded_text_url = upload_bytes(text_key, extracted_text.encode('utf-8'), content_type='text/plain')

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE documents SET text_path = ?, text_extracted_at = CURRENT_TIMESTAMP WHERE id = ?", (uploaded_text_url, doc_id))
    conn.commit()
    conn.close()
    _update_document_exists_flags(doc_id, text_exists=True)

    return extracted_text, uploaded_text_url

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _ensure_documents_status_columns():
    conn = get_db_connection()
    try:
        existing_columns = {row['name'] for row in conn.execute("PRAGMA table_info(documents)").fetchall()}
        added = False
        for column in ('file_exists', 'text_exists'):
            if column not in existing_columns:
                conn.execute(f"ALTER TABLE documents ADD COLUMN {column} INTEGER DEFAULT 0")
                added = True
        if added:
            conn.commit()
    finally:
        conn.close()


def _update_document_exists_flags(doc_id, file_exists=None, text_exists=None):
    if file_exists is None and text_exists is None:
        return
    columns = []
    params = []
    if file_exists is not None:
        columns.append("file_exists = ?")
        params.append(1 if file_exists else 0)
    if text_exists is not None:
        columns.append("text_exists = ?")
        params.append(1 if text_exists else 0)
    params.append(doc_id)
    conn = get_db_connection()
    try:
        conn.execute(f"UPDATE documents SET {', '.join(columns)} WHERE id = ?", params)
        conn.commit()
    finally:
        conn.close()


_ensure_documents_status_columns()

VALID_STATUS_VALUES = {'pending', 'in_progress', 'success', 'failed'}

def normalize_status(status):
    """Ramène n'importe quelle valeur à un statut normalisé."""
    if status is None:
        return 'pending'

    normalized = str(status).strip().lower()
    if normalized in VALID_STATUS_VALUES:
        return normalized

    if normalized == 'skipped':
        return 'pending'

    return 'pending'


def reconcile_status_with_existence(status, exists):
    """
    Ajuste un statut en fonction de l'existence d'une ressource (fichier PDF/TXT).
    """
    normalized = normalize_status(status)

    if exists is True and normalized in {'pending', 'failed'}:
        return 'success'

    if exists is False and normalized == 'success':
        return 'failed'

    return normalized


def is_success(status):
    return normalize_status(status) == 'success'


def extract_num_from_url(url: str) -> str | None:
    """Parse the document number from a JORADP URL."""
    if not url:
        return None

    filename = url.split('/')[-1]
    if len(filename) >= 8 and filename[0].upper() == 'F' and filename[5:8].isdigit():
        return filename[5:8]
    if '.' in filename:
        return filename.rsplit('.', 1)[0]
    return filename

# ============================================================================
# ROUTES DOCUMENTS
# ============================================================================

@joradp_bp.route('/documents/<int:doc_id>/metadata', methods=['GET'])
def get_document_metadata(doc_id):
    """Récupérer les métadonnées d'un document"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                d.id,
                d.url,
                d.publication_date,
                d.file_size_bytes,
                d.file_path,
                d.text_path,
                d.metadata_collection_status,
                d.download_status,
                d.text_extraction_status,
                d.ai_analysis_status,
                d.embedding_status,
                d.extra_metadata,
                dm.title AS metadata_title,
                dm.publication_date AS metadata_publication_date,
                dm.language AS metadata_language,
                dm.description AS metadata_description,
                dm.page_count AS metadata_page_count,
                ai.summary,
                ai.keywords,
                ai.named_entities,
                ai.additional_metadata,
                ai.extraction_quality,
                ai.extraction_method,
                ai.extraction_confidence,
                ai.extracted_text_length,
                ai.char_count,
                ai.updated_at AS analysis_updated_at,
                emb.model_name AS embedding_model,
                emb.dimension AS embedding_dimension,
                emb.created_at AS embedding_created_at,
                LENGTH(emb.embedding) AS embedding_bytes
            FROM documents d
            LEFT JOIN document_ai_analysis ai ON d.id = ai.document_id
            LEFT JOIN document_metadata dm ON d.id = dm.document_id
            LEFT JOIN document_embeddings emb ON d.id = emb.document_id
            WHERE d.id = ?
        """, (doc_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return jsonify({'error': 'Document non trouvé'}), 404
        doc = dict(row)

        extra_metadata_raw = doc.pop('extra_metadata', None)
        extra_metadata = None
        if extra_metadata_raw:
            try:
                extra_metadata = json.loads(extra_metadata_raw)
            except json.JSONDecodeError:
                extra_metadata = None
        if extra_metadata:
            doc['extra_metadata'] = extra_metadata

        analysis_metadata_raw = doc.pop('additional_metadata', None)
        analysis_metadata = {}
        if analysis_metadata_raw:
            try:
                analysis_metadata = json.loads(analysis_metadata_raw)
            except json.JSONDecodeError:
                analysis_metadata = {}

        file_exists = bool(doc.get('file_exists'))
        text_exists = bool(doc.get('text_exists'))

        doc['statuts'] = {
            'collected': normalize_status(doc.pop('metadata_collection_status')),
            'downloaded': reconcile_status_with_existence(doc.pop('download_status'), file_exists),
            'text_extracted': reconcile_status_with_existence(doc.pop('text_extraction_status'), text_exists),
            'analyzed': normalize_status(doc.pop('ai_analysis_status')),
            'embedded': normalize_status(doc.pop('embedding_status')),
        }

        # Informations enrichies
        metadata_title = doc.pop('metadata_title', None)
        ai_title = analysis_metadata.get('title') or analysis_metadata.get('document_title')
        ai_title_origin = analysis_metadata.get('title_origin')

        title_origin = None
        title_value = None

        if metadata_title:
            title_value = metadata_title
            title_origin = 'extracted'
        elif ai_title:
            title_value = ai_title
            if isinstance(ai_title_origin, str) and ai_title_origin.lower() in ('extracted', 'generated'):
                title_origin = ai_title_origin.lower()
            else:
                title_origin = 'generated'

        doc['title'] = title_value
        doc['title_origin'] = title_origin

        doc['document_language'] = doc.pop('metadata_language', None) or analysis_metadata.get('language')
        doc['language'] = doc['document_language']
        doc['document_page_count'] = doc.pop('metadata_page_count', None)

        publication_meta = doc.pop('metadata_publication_date', None)
        if publication_meta and not doc.get('publication_date'):
            doc['publication_date'] = publication_meta
        doc['metadata_publication_date'] = publication_meta

        description_meta = doc.pop('metadata_description', None)
        if description_meta:
            doc['metadata_description'] = description_meta

        # Analyse IA enrichie
        summary = analysis_metadata.get('summary') or doc.get('summary')
        if isinstance(summary, dict):
            summary = summary.get('fr') or summary.get('en')
        doc['summary'] = summary

        keywords = analysis_metadata.get('keywords') or doc.get('keywords')
        keywords_list = []
        if isinstance(keywords, str):
            keywords_list = [kw.strip() for kw in keywords.replace(';', ',').split(',') if kw.strip()]
        elif isinstance(keywords, list):
            keywords_list = [kw for kw in keywords if isinstance(kw, str) and kw.strip()]
        elif isinstance(keywords, dict):
            keywords_list = keywords.get('fr') or keywords.get('en') or []
        doc['keywords'] = ', '.join(keywords_list)
        doc['keywords_list'] = keywords_list

        named_entities = analysis_metadata.get('entities') or analysis_metadata.get('named_entities') or doc.get('named_entities')
        if isinstance(named_entities, list):
            formatted_entities = []
            for entity in named_entities:
                if isinstance(entity, str):
                    formatted_entities.append(entity)
                elif isinstance(entity, dict):
                    etype = entity.get('type') or entity.get('label') or ''
                    value = entity.get('value') or entity.get('name') or ''
                    if etype or value:
                        formatted_entities.append(f"{etype.upper() if etype else 'ENTITÉ'} - {value}".strip(' -'))
                else:
                    formatted_entities.append(str(entity))
            doc['named_entities'] = '\n'.join(formatted_entities)
            doc['named_entities_list'] = formatted_entities
        elif isinstance(named_entities, dict):
            flattened = []
            for label, values in named_entities.items():
                if isinstance(values, list):
                    flattened.extend(f"{label}: {value}" for value in values)
            doc['named_entities'] = '\n'.join(flattened)
            doc['named_entities_list'] = flattened
        else:
            doc['named_entities'] = named_entities

        doc['extraction_quality'] = doc.pop('extraction_quality', None) or analysis_metadata.get('extraction_quality')
        doc['extraction_method'] = doc.pop('extraction_method', None) or analysis_metadata.get('extraction_method')
        doc['extraction_confidence'] = doc.pop('extraction_confidence', None) or analysis_metadata.get('extraction_confidence')
        doc['extracted_text_length'] = doc.pop('extracted_text_length', None) or analysis_metadata.get('extracted_text_length')
        doc['text_char_count'] = doc.pop('char_count', None) or analysis_metadata.get('char_count')
        doc['analysis_updated_at'] = doc.pop('analysis_updated_at', None)
        doc['draft_date'] = analysis_metadata.get('draft_date') or analysis_metadata.get('document_date')

        # Aperçu du texte
        text_preview = None
        text_content = _fetch_r2_text(doc.get('text_path'))
        if text_content:
            text_preview = text_content[:1500]
        if text_preview:
            doc['text_preview'] = text_preview
            doc['text_preview_length'] = len(text_preview)

        # Informations embedding
        embedding_info = None
        extra_embedding = None
        if extra_metadata:
            extra_embedding = extra_metadata.get('embedding')
        if extra_embedding:
            embedding_info = {
                'model': extra_embedding.get('model') or doc.get('embedding_model'),
                'dimension': extra_embedding.get('dimension'),
                'vector_length': len(extra_embedding.get('vector', [])) if isinstance(extra_embedding.get('vector'), list) else extra_embedding.get('dimension'),
                'storage': 'extra_metadata'
            }
        elif doc.get('embedding_model'):
            embedding_info = {
                'model': doc.get('embedding_model'),
                'dimension': doc.get('embedding_dimension'),
                'bytes': doc.get('embedding_bytes'),
                'created_at': doc.get('embedding_created_at'),
                'storage': 'table'
            }

        # Nettoyer les champs temporaires
        doc.pop('embedding_model', None)
        doc.pop('embedding_dimension', None)
        doc.pop('embedding_created_at', None)
        doc.pop('embedding_bytes', None)

        if embedding_info:
            doc['embedding'] = embedding_info

        doc['numero'] = extract_num_from_url(doc.get('url'))
        if doc.get('publication_date') and not doc.get('date'):
            doc['date'] = doc['publication_date']

        return jsonify({'success': True, 'metadata': doc})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@joradp_bp.route('/documents/<int:doc_id>/download', methods=['POST'])
def download_single_document(doc_id):
    """Télécharger un seul document PDF"""
    try:
        # Récupérer le document de la BDD
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, url, file_path, download_status, file_exists
            FROM documents
            WHERE id = ?
        """, (doc_id,))

        doc = cursor.fetchone()
        if not doc:
            conn.close()
            return jsonify({"error": "Document non trouvé"}), 404

        file_exists = bool(doc.get('file_exists'))

        # Marquer le téléchargement comme en cours
        cursor.execute("""
            UPDATE documents
            SET download_status = 'in_progress',
                error_log = NULL
            WHERE id = ?
        """, (doc_id,))
        conn.commit()

        # Télécharger le document
        url = doc['url']
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        # Extraire le nom du fichier depuis l'URL
        filename = url.split('/')[-1]

        pdf_key = _build_pdf_key(filename)
        uploaded_url = upload_bytes(pdf_key, response.content, content_type='application/pdf')

        # Mettre à jour la BDD
        cursor.execute("""
            UPDATE documents
            SET file_path = ?,
                download_status = 'success',
                downloaded_at = CURRENT_TIMESTAMP,
                file_size_bytes = ?
            WHERE id = ?
        """, (uploaded_url, len(response.content), doc_id))
        _update_document_exists_flags(doc_id, file_exists=True)

        conn.commit()
        conn.close()

        return jsonify({
            "success": True,
            "message": "Document téléchargé avec succès",
            "file_path": uploaded_url,
            "file_exists_before": file_exists,
            "overwritten": file_exists
        })

    except requests.RequestException as e:
        try:
            cursor.execute("""
                UPDATE documents
                SET download_status = 'failed',
                    error_log = ?
                WHERE id = ?
            """, (str(e), doc_id))
            conn.commit()
            conn.close()
        except Exception:
            pass
        return jsonify({
            "error": "Erreur de téléchargement",
            "message": str(e)
        }), 500
    except Exception as e:
        try:
            cursor.execute("""
                UPDATE documents
                SET download_status = 'failed',
                    error_log = ?
                WHERE id = ?
            """, (str(e), doc_id))
            conn.commit()
            conn.close()
        except Exception:
            pass
        return jsonify({
            "error": "Erreur serveur",
            "message": str(e)
        }), 500


@joradp_bp.route('/documents/<int:doc_id>/view', methods=['GET'])
def view_document(doc_id):
    """Servir le fichier PDF pour visualisation"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT file_path FROM documents WHERE id = ?", (doc_id,))
        doc = cursor.fetchone()
        conn.close()

        if not doc or not doc['file_path']:
            return jsonify({"error": "Document non trouvé ou pas encore téléchargé"}), 404

        url = build_r2_url(doc['file_path'])

        if not url:
            return jsonify({
                "error": "URL R2 introuvable pour ce document",
                "path": doc['file_path']
            }), 404

        # Redirige vers l'URL R2 (le navigateur chargera le PDF directement).
        return redirect(url, code=302)

    except Exception as e:
        return jsonify({
            "error": "Erreur serveur",
            "message": str(e)
        }), 500


@joradp_bp.route('/documents/<int:doc_id>', methods=['DELETE'])
def delete_document(doc_id):
    """Supprimer un document de la base de données"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute('SELECT file_path, text_path FROM documents WHERE id = ?', (doc_id,))
        doc = cursor.fetchone()
        if not doc:
            conn.close()
            return jsonify({'error': 'Document non trouvé'}), 404

        cursor.execute('DELETE FROM documents WHERE id = ?', (doc_id,))
        conn.commit()
        conn.close()

        delete_r2_object(doc['file_path'])
        delete_r2_object(doc['text_path'])

        return jsonify({'success': True, 'message': 'Document supprimé'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# ROUTES SITES
# ============================================================================

@joradp_bp.route('/sites', methods=['GET'])
def get_sites():
    """Liste tous les sites JORADP avec statistiques"""
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


@joradp_bp.route('/sites/<int:site_id>/sessions', methods=['GET'])
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
                SUM(CASE WHEN d.ai_analysis_status = 'success' THEN 1 ELSE 0 END) as nb_analyzed
            FROM harvesting_sessions hs
            LEFT JOIN documents d ON hs.id = d.session_id
            WHERE hs.site_id = ?
            GROUP BY hs.id
            ORDER BY hs.created_at DESC
        """, (site_id,))

        sessions = []
        for row in cursor.fetchall():
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
                    'analyze': {'done': row['nb_analyzed'] or 0, 'total': row['nb_documents'] or 0}
                }
            })

        conn.close()
        return jsonify({'success': True, 'sessions': sessions})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# ROUTES SESSIONS
# ============================================================================

@joradp_bp.route('/sessions/<int:session_id>/documents', methods=['GET'])
def get_session_documents(session_id):
    """Récupérer les documents d'une session avec pagination et filtres"""
    try:
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 50))

        # Filtres optionnels
        year = request.args.get('year')
        date_debut = request.args.get('date_debut')
        date_fin = request.args.get('date_fin')
        status = request.args.get('status', 'all')
        search_num = request.args.get('search_num')

        conn = get_db_connection()
        cursor = conn.cursor()

        # Construire la requête avec filtres
        where_clauses = ['session_id = ?']
        params = [session_id]

        if year:
            # Chercher l'année dans l'URL (ex: F1973xxx.pdf)
            where_clauses.append("url LIKE ?")
            params.append(f'%F{year}%')

        if date_debut:
            where_clauses.append('publication_date >= ?')
            params.append(date_debut)

        if date_fin:
            where_clauses.append('publication_date <= ?')
            params.append(date_fin)

        if status != 'all':
            if status == 'collected':
                where_clauses.append("metadata_collection_status = 'success'")
            elif status == 'downloaded':
                where_clauses.append("download_status = 'success'")
            elif status == 'analyzed':
                where_clauses.append("ai_analysis_status = 'success'")

        if search_num:
            where_clauses.append('url LIKE ?')
            params.append(f'%{search_num}%')

        where_sql = ' AND '.join(where_clauses)

        # Compter le total
        cursor.execute(f'SELECT COUNT(*) FROM documents WHERE {where_sql}', params)
        total = cursor.fetchone()[0]

        # Récupérer la page
        offset = (page - 1) * per_page
        cursor.execute(f"""
            SELECT
                id,
                url,
                publication_date,
                file_size_bytes,
                metadata_collection_status,
                download_status,
                text_extraction_status,
                ai_analysis_status,
                embedding_status,
                file_path,
                text_path,
                file_exists,
                text_exists
            FROM documents
            WHERE {where_sql}
            ORDER BY publication_date DESC, url DESC
            LIMIT ? OFFSET ?
        """, params + [per_page, offset])

        documents = []
        for row in cursor.fetchall():
            # Extraire le numéro depuis l'URL
            filename = row['url'].split('/')[-1]  # F2024001.pdf
            num = filename[5:8] if len(filename) > 8 else '000'

            # Extraire l'année de l'URL (ex: F1973001.pdf -> 1973)
            import re
            year_match = re.search(r'F(\d{4})\d{3}\.pdf', row['url'])
            year_str = year_match.group(1) if year_match else None

            file_exists = bool(row['file_exists'])
            text_exists = bool(row['text_exists'])

            documents.append({
                'id': row['id'],
                'url': row['url'],
                'numero': num,
                'date': year_str,  # Année extraite de l'URL
                'publication_date': row['publication_date'],
                'size_kb': round(row['file_size_bytes'] / 1024, 1) if row['file_size_bytes'] else 0,
                'file_path': row['file_path'],
                'text_path': row['text_path'],
                'file_exists': file_exists,
                'text_exists': text_exists,
                'statuts': {
                    'collected': normalize_status(row['metadata_collection_status']),
                    'downloaded': reconcile_status_with_existence(row['download_status'], file_exists),
                    'text_extracted': reconcile_status_with_existence(row['text_extraction_status'], text_exists),
                    'analyzed': normalize_status(row['ai_analysis_status']),
                    'embedded': normalize_status(row['embedding_status'])
                }
            })

        conn.close()

        return jsonify({
            'success': True,
            'documents': documents,
            'pagination': {
                'page': page,
                'per_page': per_page,
                'total': total,
                'total_pages': (total + per_page - 1) // per_page
            }
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@joradp_bp.route('/sessions/delete', methods=['POST'])
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


@joradp_bp.route('/sessions/<int:session_id>/download', methods=['POST'])
def download_documents_batch(session_id):
    """Télécharger les PDFs en batch"""
    try:
        data = request.json or {}
        mode = data.get('mode', 'all')

        conn = get_db_connection()
        cursor = conn.cursor()

        # Construire la requête selon le mode
        where_clauses = ['session_id = ?', "(download_status = 'pending' OR download_status = 'failed')"]
        params = [session_id]

        if mode == 'selected':
            doc_ids = data.get('document_ids', [])
            if not doc_ids:
                return jsonify({'error': 'Aucun document sélectionné'}), 400
            placeholders = ','.join('?' * len(doc_ids))
            where_clauses.append(f'id IN ({placeholders})')
            params.extend(doc_ids)

        where_sql = ' AND '.join(where_clauses)

        cursor.execute(f"""
            SELECT id, url, file_path
            FROM documents
            WHERE {where_sql}
        """, params)

        documents = cursor.fetchall()
        conn.close()

        if not documents:
            return jsonify({
                'success': True,
                'message': 'Aucun document à télécharger',
                'downloaded': 0
            })

        # Télécharger chaque document
        import requests

        success_count = 0
        failed_count = 0

        for doc in documents:
            doc_id = doc['id']
            url = doc['url']

            try:
                # Télécharger le PDF
                response = requests.get(url, timeout=30)
                response.raise_for_status()

                filename = url.split('/')[-1]
                pdf_key = _build_pdf_key(filename)
                uploaded_url = upload_bytes(pdf_key, response.content, content_type='application/pdf')

                # Mettre à jour la BD
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE documents
                    SET download_status = 'success',
                        downloaded_at = CURRENT_TIMESTAMP,
                        file_path = ?,
                        file_size_bytes = ?
                    WHERE id = ?
                """, (uploaded_url, len(response.content), doc_id))
                conn.commit()
                conn.close()

                success_count += 1
                print(f"✅ Téléchargé: {filename}")

            except Exception as e:
                # Marquer comme failed
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE documents
                    SET download_status = 'failed', error_log = ?
                    WHERE id = ?
                """, (str(e), doc_id))
                conn.commit()
                conn.close()

                failed_count += 1
                print(f"❌ Échec: {url} - {e}")

        return jsonify({
            'success': True,
            'downloaded': success_count,
            'failed': failed_count,
            'total': len(documents)
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@joradp_bp.route('/documents/export', methods=['POST'])
def export_selected_documents():
    """
    Exporter plusieurs PDF téléchargés en un seul ZIP (via leurs URL R2).
    """
    try:
        data = request.json or {}
        document_ids = data.get('document_ids') or []
        if not document_ids or not isinstance(document_ids, list):
            return jsonify({'error': 'document_ids requis (liste)'}), 400

        numeric_ids = []
        for doc_id in document_ids:
            try:
                numeric_ids.append(int(doc_id))
            except (TypeError, ValueError):
                continue

        if not numeric_ids:
            return jsonify({'error': 'document_ids invalides'}), 400

        placeholders = ','.join('?' * len(numeric_ids))
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT id, url, file_path
            FROM documents
            WHERE id IN ({placeholders})
              AND file_path IS NOT NULL
              AND download_status = 'success'
            """,
            numeric_ids
        )
        docs = cursor.fetchall()
        conn.close()

        if not docs:
            return jsonify({'error': 'Aucun PDF disponible pour les IDs fournis'}), 404

        buffer = io.BytesIO()
        added = 0
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
            for row in docs:
                raw_url = row['file_path']
                if not raw_url:
                    continue
                signed = generate_presigned_url(raw_url, expires_in=600) or build_public_url(raw_url)
                if not signed:
                    continue
                try:
                    resp = _R2_SESSION.get(signed, timeout=30)
                    resp.raise_for_status()
                    filename = raw_url.split('/')[-1] or f'doc-{row["id"]}.pdf'
                    archive.writestr(filename, resp.content)
                    added += 1
                except Exception as exc:
                    print(f"⚠️  Export ZIP: échec doc {row['id']} - {exc}")
                    continue

        if added == 0:
            return jsonify({'error': 'Aucun fichier exporté (accès R2 ou URLs invalides)'}), 400

        buffer.seek(0)
        download_name = f"joradp-documents-{int(time.time())}.zip"
        try:
            return send_file(buffer, as_attachment=True, download_name=download_name, mimetype='application/zip')
        except TypeError:
            return send_file(buffer, as_attachment=True, attachment_filename=download_name, mimetype='application/zip')

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@joradp_bp.route('/sessions/<int:session_id>/analyze', methods=['POST'])
def analyze_documents_batch(session_id):
    """Analyser les documents avec OpenAI IA"""
    try:
        from openai import OpenAI
        from analysis import get_embedding_model

        # Charger la clé API
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            return jsonify({'error': 'OPENAI_API_KEY non trouvée'}), 500

        client = OpenAI(api_key=api_key)

        conn = get_db_connection()
        cursor = conn.cursor()

        # Récupérer les documents téléchargés mais pas encore analysés
        cursor.execute("""
            SELECT id, file_path, text_path, url
            FROM documents
            WHERE session_id = ?
            AND download_status = 'success'
            AND (ai_analysis_status = 'pending' OR ai_analysis_status = 'failed')
        """, (session_id,))

        documents = cursor.fetchall()
        conn.close()

        if not documents:
            return jsonify({
                'success': True,
                'message': 'Aucun document à analyser',
                'analyzed': 0
            })

        success_count = 0
        failed_count = 0

        for doc in documents:
            doc_id = doc['id']
            file_path = doc['file_path']
            text_path = doc['text_path']
            url = doc['url']

            try:
                text, _ = _ensure_text_content(doc_id, file_path, text_path, url)

                # 1.5. Générer l'embedding du texte
                embedding_model = get_embedding_model()
                embedding_data = None

                if embedding_model:
                    try:
                        vector = embedding_model.encode(
                            text[:5000],  # Limiter pour l'embedding
                            convert_to_numpy=True,
                            normalize_embeddings=True
                        )
                        if hasattr(vector, 'tolist'):
                            vector = vector.tolist()

                        embedding_data = {
                            'model': 'all-MiniLM-L6-v2',
                            'dimension': len(vector),
                            'vector': [float(v) for v in vector]
                        }
                    except Exception as e:
                        print(f"   ⚠️  Embedding non généré: {e}")

                # 2. Analyser avec OpenAI
                text_sample = text[:10000]

                response = client.chat.completions.create(
                    model="gpt-4o",
                    max_tokens=1024,
                    messages=[{
                        "role": "user",
                        "content": f"""Analyse ce document juridique officiel et retourne un JSON strict avec les clés EXACTES suivantes :
- \"title\" : un titre clair et informatif (génère-le si le texte n'en contient pas).
- \"summary\" : résumé synthétique en français (2 à 4 phrases).
- \"keywords\" : tableau (max 5) de mots-clés pertinents (chaque valeur est une chaîne).
- \"entities\" : tableau décrivant les entités nommées majeures, chaque entrée au format \"TYPE - Nom\" (TYPE ∈ {{PERSONNE, ORGANISATION, LIEU, DATE, AUTRE}}).
- \"draft_date\" : date de rédaction au format YYYY-MM-DD ou null si inconnue.
Si une information est introuvable, utilise null ou une chaîne vide.

Document :
{text_sample}"""
                    }],
                    response_format={"type": "json_object"}
                )

                analysis_result = response.choices[0].message.content

                # 3. Sauvegarder dans la BD
                conn = get_db_connection()
                cursor = conn.cursor()

                # Sauvegarder l'embedding si généré
                if embedding_data:
                    cursor.execute(
                        "UPDATE documents SET extra_metadata = ? WHERE id = ?",
                        (json.dumps({'embedding': embedding_data}), doc_id)
                    )

                # Mettre à jour le document
                cursor.execute("""
                    UPDATE documents
                    SET ai_analysis_status = 'success', analyzed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (doc_id,))

                # Insérer ou mettre à jour l'analyse
                cursor.execute("""
                    INSERT OR REPLACE INTO document_ai_analysis
                    (document_id, extracted_text_length, summary, additional_metadata, created_at)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                """, (doc_id, len(text), analysis_result[:500], analysis_result))

                conn.commit()
                conn.close()

                success_count += 1
                print(f"✅ Analysé: {os.path.basename(file_path)}")

            except Exception as e:
                # Marquer comme failed
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE documents
                    SET ai_analysis_status = 'failed', error_log = ?
                    WHERE id = ?
                """, (str(e), doc_id))
                conn.commit()
                conn.close()

                failed_count += 1
                print(f"❌ Échec analyse: {url} - {e}")

        return jsonify({
            'success': True,
            'analyzed': success_count,
            'failed': failed_count,
            'total': len(documents)
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# ROUTES HARVEST
# ============================================================================

@joradp_bp.route('/harvest/incremental', methods=['POST'])
def incremental_harvest():
    """Moissonnage incrémental JORADP"""
    try:
        data = request.json or {}
        session_id = data.get('session_id')
        mode = data.get('mode', 'depuis_dernier')

        if not session_id:
            return jsonify({'error': 'session_id requis'}), 400

        from harvester_joradp_incremental import JORADPIncrementalHarvester
        harvester = JORADPIncrementalHarvester(session_id)

        if mode == 'depuis_dernier':
            harvester.harvest_depuis_dernier()

        elif mode == 'entre_dates':
            date_debut = data.get('date_debut')
            date_fin = data.get('date_fin')
            if not date_debut or not date_fin:
                return jsonify({'error': 'date_debut et date_fin requis'}), 400
            harvester.harvest_entre_dates(date_debut, date_fin)

        elif mode == 'depuis_numero':
            year = data.get('year')
            start_num = data.get('start_num')
            max_docs = data.get('max_docs', 100)
            if not year or not start_num:
                return jsonify({'error': 'year et start_num requis'}), 400
            harvester.harvest_depuis_numero(year, start_num, max_docs)

        else:
            return jsonify({'error': 'Mode inconnu'}), 400

        result = {
            'success': True,
            'mode': mode,
            'found': harvester.stats['total_found']
        }

        # Ajouter infos du dernier document si disponible
        if hasattr(harvester, 'last_doc_info') and harvester.last_doc_info:
            result['last_document'] = harvester.last_doc_info

        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# ROUTES EXTRACTION DE TEXTE INTELLIGENTE
# ============================================================================

@joradp_bp.route('/documents/extraction-quality', methods=['GET'])
def get_extraction_quality_stats():
    """Obtenir les statistiques de qualité d'extraction"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Stats par qualité
        cursor.execute("""
            SELECT
                COALESCE(extraction_quality, 'unknown') as quality,
                COUNT(*) as count
            FROM document_ai_analysis
            GROUP BY extraction_quality
        """)
        quality_stats = {row['quality']: row['count'] for row in cursor.fetchall()}

        # Stats par méthode
        cursor.execute("""
            SELECT
                COALESCE(extraction_method, 'pypdf2') as method,
                COUNT(*) as count
            FROM document_ai_analysis
            GROUP BY extraction_method
        """)
        method_stats = {row['method']: row['count'] for row in cursor.fetchall()}

        # Documents à ré-extraire (poor/failed/unknown)
        cursor.execute("""
            SELECT COUNT(*) as count
            FROM documents d
            LEFT JOIN document_ai_analysis da ON d.id = da.document_id
            WHERE d.file_path IS NOT NULL
            AND d.file_path LIKE '%.pdf'
            AND (da.extraction_quality IS NULL
                 OR da.extraction_quality IN ('poor', 'failed', 'unknown'))
        """)
        reextract_count = cursor.fetchone()['count']

        conn.close()

        return jsonify({
            'quality_stats': quality_stats,
            'method_stats': method_stats,
            'needs_reextraction': reextract_count
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@joradp_bp.route('/documents/poor-quality', methods=['GET'])
def get_poor_quality_documents():
    """Lister les documents avec qualité poor/failed/unknown"""
    try:
        from shared.intelligent_text_extractor import IntelligentTextExtractor

        extractor = IntelligentTextExtractor(DB_PATH)
        docs = extractor.get_poor_quality_documents()

        return jsonify({
            'count': len(docs),
            'documents': docs
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@joradp_bp.route('/documents/reextract', methods=['POST'])
def reextract_documents():
    """
    Ré-extraire les documents avec qualité insuffisante

    Body JSON:
    {
        "document_ids": [1, 2, 3],  # Optionnel, sinon tous les poor/failed
        "use_vision_api": false,    # Activer Vision API pour derniers recours
        "force": false              # Forcer même si déjà good/excellent
    }
    """
    try:
        from shared.intelligent_text_extractor import IntelligentTextExtractor

        data = request.json or {}
        document_ids = data.get('document_ids', [])
        use_vision = data.get('use_vision_api', False)
        force = data.get('force', False)

        # Activer Vision API si demandé
        if use_vision:
            os.environ['ENABLE_VISION_API'] = 'true'

        extractor = IntelligentTextExtractor(DB_PATH)

        # Si IDs spécifiés, les utiliser
        if document_ids:
            conn = get_db_connection()
            cursor = conn.cursor()

            placeholders = ','.join('?' * len(document_ids))
            cursor.execute(f"""
                SELECT d.id, d.file_path
                FROM documents d
                WHERE d.id IN ({placeholders})
                AND d.file_path IS NOT NULL
                AND d.file_path LIKE '%.pdf'
            """, document_ids)

            docs = [{'id': row['id'], 'file_path': row['file_path']}
                    for row in cursor.fetchall()]
            conn.close()
        else:
            # Sinon, récupérer tous les documents de qualité insuffisante
            docs = extractor.get_poor_quality_documents()

        # Ré-extraire
        results = []
        total = len(docs)

        print(f"\n🔄 Ré-extraction de {total} documents...")

        for i, doc in enumerate(docs):
            print(f"\n📄 [{i+1}/{total}] Document {doc['id']}...")

            try:
                result = extractor.extract_and_evaluate(doc['file_path'], doc['id'])

                results.append({
                    'id': doc['id'],
                    'success': True,
                    'quality': result['quality'],
                    'method': result['method'],
                    'confidence': result['confidence'],
                    'char_count': result['char_count']
                })

            except Exception as e:
                print(f"❌ Erreur document {doc['id']}: {e}")
                results.append({
                    'id': doc['id'],
                    'success': False,
                    'error': str(e)
                })

        # Statistiques finales
        successful = sum(1 for r in results if r.get('success'))
        excellent = sum(1 for r in results if r.get('quality') == 'excellent')
        good = sum(1 for r in results if r.get('quality') == 'good')
        poor = sum(1 for r in results if r.get('quality') == 'poor')
        failed = sum(1 for r in results if r.get('quality') == 'failed')

        return jsonify({
            'total_processed': total,
            'successful': successful,
            'stats': {
                'excellent': excellent,
                'good': good,
                'poor': poor,
                'failed': failed
            },
            'results': results
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@joradp_bp.route('/documents/<int:doc_id>/reextract', methods=['POST'])
def reextract_single_document(doc_id):
    """Ré-extraire un seul document"""
    try:
        from shared.intelligent_text_extractor import IntelligentTextExtractor

        data = request.json or {}
        use_vision = data.get('use_vision_api', False)

        # Activer Vision API si demandé
        if use_vision:
            os.environ['ENABLE_VISION_API'] = 'true'

        # Récupérer le document
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT file_path
            FROM documents
            WHERE id = ?
            AND file_path IS NOT NULL
            AND file_path LIKE '%.pdf'
        """, (doc_id,))

        doc = cursor.fetchone()
        conn.close()

        if not doc:
            return jsonify({'error': 'Document non trouvé ou pas de PDF'}), 404

        # Extraire
        extractor = IntelligentTextExtractor(DB_PATH)
        result = extractor.extract_and_evaluate(doc['file_path'], doc_id)

        return jsonify({
            'document_id': doc_id,
            'quality': result['quality'],
            'method': result['method'],
            'confidence': result['confidence'],
            'char_count': result['char_count']
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# ROUTE STATISTIQUES GLOBALES
# ============================================================================

@joradp_bp.route('/stats', methods=['GET'])
def get_global_stats():
    """Récupérer les statistiques globales pour JORADP"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Total de documents
        cursor.execute("SELECT COUNT(*) as total FROM documents")
        total = cursor.fetchone()['total']

        # Documents collectés (métadonnées)
        cursor.execute("""
            SELECT COUNT(*) as collected
            FROM documents
            WHERE metadata_collection_status = 'success'
        """)
        collected = cursor.fetchone()['collected']

        # Documents téléchargés
        cursor.execute("""
            SELECT COUNT(*) as downloaded
            FROM documents
            WHERE download_status = 'success'
        """)
        downloaded = cursor.fetchone()['downloaded']

        # Documents avec texte extrait
        cursor.execute("""
            SELECT COUNT(*) as extracted
            FROM documents
            WHERE text_extraction_status = 'success'
        """)
        extracted = cursor.fetchone()['extracted']

        # Documents analysés avec IA
        cursor.execute("""
            SELECT COUNT(*) as analyzed
            FROM documents
            WHERE ai_analysis_status = 'success'
        """)
        analyzed = cursor.fetchone()['analyzed']

        # Documents avec embeddings
        cursor.execute("""
            SELECT COUNT(*) as embedded
            FROM documents
            WHERE embedding_status = 'success'
        """)
        embedded = cursor.fetchone()['embedded']

        conn.close()

        return jsonify({
            'success': True,
            'stats': {
                'total': total,
                'collected': collected,
                'downloaded': downloaded,
                'extracted': extracted,
                'analyzed': analyzed,
                'embedded': embedded
            }
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# ROUTES BATCH POUR SÉLECTION MULTIPLE DE DOCUMENTS
# ============================================================================

@joradp_bp.route('/batch/extract', methods=['POST'])
def batch_extract_documents():
    """Extraire le texte de plusieurs documents sélectionnés"""
    try:
        from shared.intelligent_text_extractor import IntelligentTextExtractor

        data = request.json or {}
        document_ids = data.get('document_ids', [])
        use_vision = data.get('use_vision_api', False)

        if not document_ids:
            return jsonify({'error': 'Aucun document spécifié'}), 400

        # Activer Vision API si demandé
        if use_vision:
            os.environ['ENABLE_VISION_API'] = 'true'

        # Récupérer les documents
        conn = get_db_connection()
        cursor = conn.cursor()

        placeholders = ','.join('?' * len(document_ids))
        cursor.execute(f"""
            SELECT id, url, file_path
            FROM documents
            WHERE id IN ({placeholders})
            AND file_path IS NOT NULL
            AND file_path LIKE '%.pdf'
        """, document_ids)

        documents = cursor.fetchall()

        if documents:
            cursor.execute(
                f"UPDATE documents SET text_extraction_status = 'in_progress', error_log = NULL WHERE id IN ({placeholders})",
                document_ids
            )
            conn.commit()

        if not documents:
            return jsonify({
                'success': True,
                'message': 'Aucun document PDF à extraire',
                'extracted': 0
            })

        # Extraire chaque document
        extractor = IntelligentTextExtractor(DB_PATH)
        success_count = 0
        failed_count = 0
        results = []

        for doc in documents:
            numero = extract_num_from_url(doc['url'])
            try:
                result = extractor.extract_and_evaluate(doc['file_path'], doc['id'])
                success_count += 1
                results.append({
                    'id': doc['id'],
                    'numero': numero,
                    'quality': result['quality'],
                    'method': result['method']
                })
            except Exception as e:
                failed_count += 1
                print(f"❌ Erreur extraction doc {doc['id']}: {e}")
                cursor.execute("""
                    UPDATE documents
                    SET text_extraction_status = 'failed',
                        error_log = ?
                    WHERE id = ?
                """, (str(e), doc['id']))
                conn.commit()

        conn.close()

        return jsonify({
            'success': True,
            'message': f'Extraction terminée: {success_count} succès, {failed_count} échecs',
            'extracted': success_count,
            'failed': failed_count,
            'results': results
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@joradp_bp.route('/batch/analyze', methods=['POST'])
def batch_analyze_documents():
    """Analyser plusieurs documents sélectionnés avec IA + embeddings"""
    try:
        from openai import OpenAI
        from analysis import get_embedding_model

        data = request.json or {}
        document_ids = data.get('document_ids', [])
        force = data.get('force', False)
        generate_embeddings = bool(data.get('generate_embeddings', False))

        if not document_ids:
            return jsonify({'error': 'Aucun document spécifié'}), 400

        # Vérifier la clé API
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            return jsonify({'error': 'OPENAI_API_KEY non trouvée'}), 500

        client = OpenAI(api_key=api_key)

        # Récupérer les documents
        conn = get_db_connection()
        cursor = conn.cursor()

        placeholders = ','.join('?' * len(document_ids))
        cursor.execute(f"""
            SELECT
                id,
                file_path,
                text_path,
                url,
                ai_analysis_status,
                embedding_status
            FROM documents
            WHERE id IN ({placeholders})
            AND download_status = 'success'
        """, document_ids)

        documents = cursor.fetchall()

        # Filtrer les documents déjà analysés si force=False
        to_analyze = []
        already_analyzed = []
        missing_text = []

        for doc in documents:
            numero = extract_num_from_url(doc['url'])
            if not force and normalize_status(doc['ai_analysis_status']) == 'success':
                already_analyzed.append(numero or str(doc['id']))
                continue

            text_content = _fetch_r2_text(doc['text_path'])
            if not text_content:
                try:
                    text_content, new_text_path = _ensure_text_content(
                        doc['id'],
                        doc['file_path'],
                        doc['text_path'],
                        doc['url']
                    )
                    doc['text_path'] = new_text_path
                except Exception:
                    missing_text.append(numero or str(doc['id']))
                    continue

            doc['_text_content'] = text_content
            to_analyze.append(doc)

        # Messages d'information
        info_messages = []
        if already_analyzed:
            info_messages.append(f"{len(already_analyzed)} déjà analysé(s)")
        if missing_text:
            info_messages.append(f"{len(missing_text)} sans texte extrait")

        if not to_analyze:
            conn.close()
            return jsonify({
                'success': True,
                'message': 'Aucun document à analyser. ' + ', '.join(info_messages),
                'analyzed': 0,
                'already_analyzed': len(already_analyzed),
                'missing_text': len(missing_text)
            })

        # Analyser chaque document
        success_count = 0
        failed_count = 0
        embedding_model = get_embedding_model() if generate_embeddings else None

        to_analyze_ids = [doc['id'] for doc in to_analyze]
        if to_analyze_ids:
            placeholders_in = ','.join('?' * len(to_analyze_ids))
            assignments = [
                "ai_analysis_status = 'in_progress'",
                "analyzed_at = NULL",
                "error_log = NULL"
            ]
            if embedding_model:
                assignments.append("embedding_status = 'in_progress'")
                assignments.append("embedded_at = NULL")
            cursor.execute(
                f"UPDATE documents SET {', '.join(assignments)} WHERE id IN ({placeholders_in})",
                to_analyze_ids
            )
            conn.commit()

        for doc in to_analyze:
            doc_id = doc['id']

            try:
                text = doc.get('_text_content')
                if not text:
                    text, _ = _ensure_text_content(
                        doc_id,
                        doc['file_path'],
                        doc['text_path'],
                        doc['url']
                    )

                # Générer l'embedding si le modèle est disponible
                embedding_data = None
                embedding_status_value = None
                embedding_error_message = None

                if embedding_model:
                    embedding_status_value = 'failed'
                    try:
                        vector = embedding_model.encode(
                            text[:5000],
                            convert_to_numpy=True,
                            normalize_embeddings=True
                        )
                        if hasattr(vector, 'tolist'):
                            vector = vector.tolist()

                        embedding_data = {
                            'model': 'all-MiniLM-L6-v2',
                            'dimension': len(vector),
                            'vector': [float(v) for v in vector]
                        }
                        embedding_status_value = 'success'
                    except Exception as e:
                        embedding_error_message = f"Embedding non généré: {e}"
                        print(f"   ⚠️  {embedding_error_message}")

                # Analyser avec OpenAI
                text_sample = text[:10000]

                response = client.chat.completions.create(
                    model="gpt-4o",
                    max_tokens=1024,
                    messages=[{
                        "role": "user",
                        "content": f"""Analyse ce document officiel algérien et renvoie STRICTEMENT le JSON suivant :
{{
  "title": "Titre clair (génère-le si absent)",
  "title_origin": "extracted|generated",
  "summary": "Résumé en français (2-4 phrases)",
  "keywords": ["mot1","mot2"],
  "entities": ["TYPE - Nom"],
  "draft_date": "YYYY-MM-DD ou null",
  "language": "fr|ar|... (code ISO)"
}}
Rappelle-toi : 
- \"title_origin\" doit être "extracted" si le titre est pris tel quel du document, sinon "generated".
- \"keywords\" est un tableau (max 5 entrées).
- \"entities\" est un tableau où TYPE ∈ {{PERSONNE, ORGANISATION, LIEU, DATE, AUTRE}}.
- Mets null quand l'information est introuvable.

Document :
{text_sample}"""
                    }],
                    response_format={"type": "json_object"}
                )

                analysis_result = response.choices[0].message.content

                # Sauvegarder l'embedding dans extra_metadata si disponible
                if embedding_data:
                    cursor.execute(
                        "SELECT extra_metadata FROM documents WHERE id = ?",
                        (doc_id,)
                    )
                    existing_extra = cursor.fetchone()
                    merged_extra = {}

                    if existing_extra and existing_extra['extra_metadata']:
                        try:
                            merged_extra = json.loads(existing_extra['extra_metadata'])
                        except json.JSONDecodeError:
                            merged_extra = {}

                    merged_extra['embedding'] = embedding_data

                    cursor.execute(
                        "UPDATE documents SET extra_metadata = ? WHERE id = ?",
                        (json.dumps(merged_extra), doc_id)
                    )

                # Sauvegarder l'analyse et les statuts
                status_assignments = [
                    "ai_analysis_status = 'success'",
                    "analyzed_at = CURRENT_TIMESTAMP",
                    "error_log = ?"
                ]
                status_params = [embedding_error_message]

                if embedding_status_value:
                    status_assignments.append("embedding_status = ?")
                    status_assignments.append("embedded_at = CASE WHEN ? = 'success' THEN CURRENT_TIMESTAMP ELSE NULL END")
                    status_params.extend([embedding_status_value, embedding_status_value])

                cursor.execute(
                    f"UPDATE documents SET {', '.join(status_assignments)} WHERE id = ?",
                    status_params + [doc_id]
                )

                cursor.execute("""
                    INSERT OR REPLACE INTO document_ai_analysis
                    (document_id, extracted_text_length, summary, additional_metadata, created_at)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                """, (doc_id, len(text), analysis_result[:500], analysis_result))

                conn.commit()
                success_count += 1
                print(f"✅ Analysé: doc {doc_id}")

            except Exception as e:
                failure_message = str(e)
                failure_assignments = [
                    "ai_analysis_status = 'failed'",
                    "error_log = ?",
                    "analyzed_at = NULL"
                ]
                failure_params = [failure_message]

                if embedding_model:
                    failure_assignments.append("embedding_status = 'failed'")
                    failure_assignments.append("embedded_at = NULL")

                cursor.execute(
                    f"UPDATE documents SET {', '.join(failure_assignments)} WHERE id = ?",
                    failure_params + [doc_id]
                )
                conn.commit()
                failed_count += 1
                print(f"❌ Échec analyse doc {doc_id}: {failure_message}")

        conn.close()

        return jsonify({
            'success': True,
            'message': f'Analyse terminée: {success_count} succès, {failed_count} échecs',
            'analyzed': success_count,
            'failed': failed_count,
            'already_analyzed': len(already_analyzed),
            'missing_text': len(missing_text)
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@joradp_bp.route('/batch/embeddings', methods=['POST'])
def batch_generate_embeddings():
    """Générer uniquement les embeddings pour plusieurs documents sélectionnés"""
    try:
        from analysis import get_embedding_model

        data = request.json or {}
        document_ids = data.get('document_ids', [])
        force = data.get('force', False)

        if not document_ids:
            return jsonify({'error': 'Aucun document spécifié'}), 400

        embedding_model = get_embedding_model()
        if not embedding_model:
            return jsonify({'error': 'Aucun modèle d\'embedding disponible'}), 500

        conn = get_db_connection()
        cursor = conn.cursor()

        placeholders = ','.join('?' * len(document_ids))
        cursor.execute(f"""
            SELECT id, url, file_path, text_path, embedding_status
            FROM documents
            WHERE id IN ({placeholders})
        """, document_ids)

        documents = cursor.fetchall()

        to_embed = []
        already_done = []
        missing_text = []

        for doc in documents:
            numero = extract_num_from_url(doc['url']) or str(doc['id'])
            status = normalize_status(doc['embedding_status'])

            if not force and status == 'success':
                already_done.append(numero)
                continue

            text_content = _fetch_r2_text(doc['text_path'])
            if not text_content:
                try:
                    text_content, new_text_path = _ensure_text_content(
                        doc['id'],
                        doc['file_path'],
                        doc['text_path'],
                        doc['url']
                    )
                    doc['text_path'] = new_text_path
                except Exception:
                    missing_text.append(numero)
                    continue

            doc['_text_content'] = text_content
            to_embed.append(doc)

        if not to_embed:
            conn.close()
            return jsonify({
                'success': True,
                'message': 'Aucun embedding à générer.',
                'embedded': 0,
                'already_embedded': len(already_done),
                'missing_text': len(missing_text)
            })

        to_embed_ids = [doc['id'] for doc in to_embed]
        placeholders_in = ','.join('?' * len(to_embed_ids))

        cursor.execute(
            f"UPDATE documents SET embedding_status = 'in_progress', embedded_at = NULL, error_log = NULL WHERE id IN ({placeholders_in})",
            to_embed_ids
        )
        conn.commit()

        success_count = 0
        failed_count = 0

        for doc in to_embed:
            doc_id = doc['id']
            numero = extract_num_from_url(doc['url']) or str(doc_id)

            try:
                text = doc.get('_text_content')
                if not text:
                    text, _ = _ensure_text_content(doc_id, doc['file_path'], doc['text_path'], doc['url'])

                vector = embedding_model.encode(
                    text[:5000],
                    convert_to_numpy=True,
                    normalize_embeddings=True
                )
                if hasattr(vector, 'tolist'):
                    vector = vector.tolist()

                embedding_data = {
                    'model': 'all-MiniLM-L6-v2',
                    'dimension': len(vector),
                    'vector': [float(v) for v in vector]
                }

                cursor.execute(
                    "SELECT extra_metadata FROM documents WHERE id = ?",
                    (doc_id,)
                )
                existing_extra = cursor.fetchone()
                merged_extra = {}
                if existing_extra and existing_extra['extra_metadata']:
                    try:
                        merged_extra = json.loads(existing_extra['extra_metadata'])
                    except json.JSONDecodeError:
                        merged_extra = {}

                merged_extra['embedding'] = embedding_data

                cursor.execute(
                    """
                    UPDATE documents
                    SET extra_metadata = ?,
                        embedding_status = 'success',
                        embedded_at = CURRENT_TIMESTAMP,
                        error_log = NULL
                    WHERE id = ?
                    """,
                    (json.dumps(merged_extra), doc_id)
                )
                conn.commit()
                success_count += 1
                print(f"✅ Embedding généré pour doc {doc_id} ({numero})")

            except Exception as e:
                cursor.execute(
                    """
                    UPDATE documents
                    SET embedding_status = 'failed',
                        embedded_at = NULL,
                        error_log = ?
                    WHERE id = ?
                    """,
                    (str(e), doc_id)
                )
                conn.commit()
                failed_count += 1
                print(f"❌ Échec embedding doc {doc_id}: {e}")

        conn.close()

        return jsonify({
            'success': True,
            'message': f'Embeddings générés: {success_count} succès, {failed_count} échecs',
            'embedded': success_count,
            'failed': failed_count,
            'already_embedded': len(already_done),
            'missing_text': len(missing_text)
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500
