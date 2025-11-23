import os

from dotenv import load_dotenv
from pathlib import Path
from flask import Flask, jsonify
from flask_cors import CORS

# Import des modules
from modules.joradp.routes import joradp_bp
from modules.coursupreme.routes import coursupreme_bp

# Import des anciennes routes (harvest, sites, etc.)
from collections_api import register_collections_routes
from harvest_routes import register_harvest_routes
from sites_routes import register_sites_routes

CWD = os.path.dirname(os.path.abspath(__file__))
# Charge d'abord l'éventuelle .env du dossier backend, puis celle à la racine si présente.
load_dotenv(os.path.join(CWD, ".env"))
root_env = Path(CWD).resolve().parent / ".env"
if root_env.exists():
    load_dotenv(root_env)

app = Flask(__name__)
CORS(app)

# Enregistrer les modules avec préfixes
app.register_blueprint(joradp_bp, url_prefix='/api/joradp')
app.register_blueprint(coursupreme_bp, url_prefix='/api/coursupreme')

# Anciennes routes (à garder pour l'instant)
register_collections_routes(app)
register_harvest_routes(app)
register_sites_routes(app)

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'modules': ['joradp', 'coursupreme']})

if __name__ == '__main__':
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", 5001))
    debug_mode = os.getenv("FLASK_DEBUG", "0").lower() in ("1", "true", "yes")
    print(f"🚀 Démarrage avec 2 modules sur {host}:{port} (debug={'on' if debug_mode else 'off'}) :")
    print("   📰 JORADP:        /api/joradp/*")
    print("   ⚖️  Cour Suprême: /api/coursupreme/*")
    app.run(host=host, port=port, debug=debug_mode)
