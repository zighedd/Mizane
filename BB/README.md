# 📚 Doc Harvester V1.0

Application de moissonnage et gestion de documents juridiques algériens (JORADP).

## ✨ Fonctionnalités

- 🌾 **Moissonnage exhaustif** : Récupération complète d'une année
- 🔄 **Moissonnage incrémental** : Mise à jour automatique
- 📥 **Téléchargement automatique** des PDFs
- 👁️ **Visualisation** : locale ou en ligne
- 🗑️ **Suppression** de documents
- 📊 **Interface hiérarchique** : Sites > Sessions > Documents

## 🚀 Installation

### Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 api.py
```

### Frontend
```bash
cd frontend/harvester-ui
npm install
npm start
```

## ℹ️ Cour Suprême (routes API)

- L’endpoint avancé actif est `/api/coursupreme/search/advanced` exposé par `backend/modules/coursupreme/routes.py`.
- L’ancienne implémentation `backend/routes/routes_coursupreme_viewer.py` est désactivée (renvoie 410 si jamais le blueprint legacy est enregistré). Conserver ce fichier comme archive uniquement.

## 🛠️ Routines automatisées

- `./scripts/setup_env.sh` remplit `backend/.env` avec tes valeurs (utilise `FORCE=1` pour écraser). Tu peux surcharger chaque clé via la variable d’environnement correspondante (utile quand tu scripts le déploiement).
- `./scripts/start_backend.sh` active le `venv`, recharge `env.sh` et lance gunicorn avec `${WORKERS:-4}`. Parfait pour relancer proprement le serveur sans retaper les commandes.
- `./scripts/build_frontend.sh` va dans `frontend/harvester-ui`, installe les dépendances (si `package-lock.json` existe) puis lance `npm run build`. À utiliser avant d’envoyer le dossier `build/` vers ton CDN/back.
- `python scripts/refresh_document_statuses.py` ajoute les colonnes `file_exists`/`text_exists` si nécessaire et actualise leur valeur en interrogeant R2 (n’oublie pas `source backend/env.sh` avant de l’exécuter).
- `./scripts/run_checks.sh` enchaîne `build_frontend`, `pytest backend/test_full_pipeline.py` (depuis le venv) et un `curl /api/health` pour valider la stack locale (veille à ce que gunicorn soit déjà démarré via `./scripts/start_backend.sh`).

Ces scripts sont destinés à ton terminal “instructions ponctuelles” : ils réduisent les copier/coller et gardent la configuration en un seul point.

## ☁️ Stockage R2 (Cloudflare)

L'application ne lit plus aucun fichier local. Pour servir les PDF/TXT :

1. **Configurer l'accès R2**  
   Copie `backend/.env.example` en `backend/.env`, renseigne les variables avec tes propres clés et recharge l'environnement (le script `env.sh` charge automatiquement `.env`) :  
   `cd backend && source env.sh && source venv/bin/activate`.

2. **Convertir les chemins existants**  
   ```bash
   cd harvester-new
   source backend/env.sh
   python migrate_paths_to_r2.py                # documents JORADP
   python migrate_coursupreme_paths_to_r2.py    # décisions Cour Suprême
   ```

3. **Valider**  
   - `curl -I http://localhost:5001/api/joradp/documents/<id>/view` doit répondre `302` vers une URL `https://…r2.cloudflarestorage.com`.
   - Dans le front, l'ouverture d'un document Cour Suprême affiche toujours les contenus AR/FR (stream depuis R2).

## 📦 Version 1.1

Date : 21 novembre 2025  
Statut : ✅ Stable et fonctionnelle  
Notes : Export Cours Suprême robuste (fallback R2) + confirmation côté UI. Voir `CHANGELOG.md`.

## 🚧 Roadmap V2

- Ajout de nouveaux sites à moissonner
- Analyse IA améliorée
- Recherche sémantique avancée

## 🧹 Nettoyage

- Lancer `scripts/list_legacy_files.py` pour lister les fichiers `.bak/.backup`/`.old` encore présents et les supprimer en sécurité (`--delete --confirm` une fois validé).
