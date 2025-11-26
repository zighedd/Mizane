from flask import Flask
from flask_cors import CORS

from .routes import mizane_bp


def create_mizane_app() -> Flask:
    app = Flask(__name__)
    CORS(app, origins="*")
    app.register_blueprint(mizane_bp)
    app.config['JSON_SORT_KEYS'] = False
    return app
