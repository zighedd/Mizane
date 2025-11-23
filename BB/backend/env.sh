#!/usr/bin/env bash

# Charger les variables depuis backend/.env (non suivie) puis laisser les valeurs
# déjà présentes dans l'environnement les surcharger.
set -a
if [ -f "$(dirname "$0")/.env" ]; then
  source "$(dirname "$0")/.env"
fi
set +a

export TESSDATA_PREFIX=${TESSDATA_PREFIX:-/usr/local/opt/tesseract/share/tessdata}
export HARVESTER_R2_BUCKET=${HARVESTER_R2_BUCKET:-textes-juridiques}
export HARVESTER_R2_BASE_URL=${HARVESTER_R2_BASE_URL:-https://<account-id>.r2.cloudflarestorage.com/textes-juridiques}
export HARVESTER_R2_ACCOUNT_ID=${HARVESTER_R2_ACCOUNT_ID:-<account-id>}
export HARVESTER_R2_ACCESS_KEY_ID=${HARVESTER_R2_ACCESS_KEY_ID:-<access-key>}
export HARVESTER_R2_SECRET_ACCESS_KEY=${HARVESTER_R2_SECRET_ACCESS_KEY:-<secret-key>}
export COURSUPREME_ENABLE_SEMANTIC=${COURSUPREME_ENABLE_SEMANTIC:-1}
export FLASK_DEBUG=${FLASK_DEBUG:-0}
export API_HOST=${API_HOST:-0.0.0.0}
export API_PORT=${API_PORT:-5001}
