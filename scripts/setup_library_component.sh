#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
AA_SRC="$ROOT/AA/src"
PAGES_DIR="$AA_SRC/pages/library"
COMPONENTS_DIR="$AA_SRC/components/library"
BACKEND_DIR="$ROOT/AA/backend/mizane"

echo "Création de la structure Mizane Library..."

mkdir -p "$PAGES_DIR"
mkdir -p "$COMPONENTS_DIR"
mkdir -p "$BACKEND_DIR"

cat > "$PAGES_DIR/LibraryPage.tsx" <<'EOF'
import React from 'react';
import FiltersPanel from '../../components/library/FiltersPanel';
import DocumentTable from '../../components/library/DocumentTable';

const LibraryPage = () => (
  <main className="library-page">
    <header>
      <h1>Bibliothèque juridique</h1>
      <p>Corpus : JORADP / Cour suprême</p>
    </header>
    <FiltersPanel />
    <DocumentTable />
  </main>
);

export default LibraryPage;
EOF

cat > "$COMPONENTS_DIR/FiltersPanel.tsx" <<'EOF'
import React from 'react';

const FiltersPanel = () => (
  <section className="filters-panel">
    <div>Filtres JORADP / Cour suprême</div>
  </section>
);

export default FiltersPanel;
EOF

cat > "$COMPONENTS_DIR/DocumentTable.tsx" <<'EOF'
import React from 'react';

const DocumentTable = () => (
  <section className="document-table">
    <div>Tableau des documents (placeholder)</div>
  </section>
);

export default DocumentTable;
EOF

cat > "$BACKEND_DIR/routes.py" <<'EOF'
from flask import Blueprint, jsonify, request

mizane_bp = Blueprint('mizane', __name__, url_prefix='/api/mizane')

@mizane_bp.route('/documents', methods=['GET'])
def documents():
    corpus = request.args.get('corpus', 'joradp')
    return jsonify({
        'corpus': corpus,
        'documents': [],
    })

@mizane_bp.route('/semantic-search', methods=['POST'])
def semantic_search():
    payload = request.get_json(silent=True) or {}
    return jsonify({
        'query': payload.get('query'),
        'results': [],
    })
EOF

cat > "$BACKEND_DIR/__init__.py" <<'EOF'
from flask import Flask
from .routes import mizane_bp

def create_mizane_app():
    app = Flask(__name__)
    app.register_blueprint(mizane_bp)
    return app
EOF

echo "Structure Library ready. Complète les composants et les routes selon le plan."
