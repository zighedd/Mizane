# Mizane (AA + BB)

Ce dépôt regroupe deux modules distincts :

- `AA/` (alias `A`, projets Misan) contient l’application principale qui lit `BB/` en lecture seule.
- `BB/` (alias `B`) est la copie propre de `harvester-new` que l’on propose à AA : rien ne doit être modifié dans ses contenus (PDFs, `harvester.db`, R2/E2 paths).
- `BB-old/` stocke l’archive de la version précédente de `BB` au cas où il faudrait revenir en arrière.

## Objectif

1. ??Préserver la continuité de `AA` en lui exposant simplement les artefacts `BB` sans toucher aux données.
2. ??Garantir qu’une nouvelle base `BB` propre peut être copiée depuis `/Users/djamel/Sites/Mizane/B` (ou le repo `harvester-new`) puis poussée vers `zighedd/Mizane` sans secrets ni venv.
3. ??Documenter la procédure pour que les sauvegardes/follow-ups soient claires d’un seul coup d’oeil.

## Procédure de mise à jour de BB

1. **Préparer la source**  
   - Veille à ce que `/Users/djamel/Sites/Mizane/B` soit la source saine (par exemple une copie fraîche de `/Users/djamel/Sites/harvester-new`).  
   - Supprime les dossiers lourds (`backend/venv`, `frontend/harvester-ui/node_modules`) et les fichiers sensibles avant de copier.

2. **Archiver l’ancienne version**  
   ```bash
   rm -rf /Users/djamel/Sites/Mizane/BB-old
   mv /Users/djamel/Sites/Mizane/BB /Users/djamel/Sites/Mizane/BB-old
   ```

3. **Copier la nouvelle version**  
   ```bash
   cp -R /Users/djamel/Sites/Mizane/B/. /Users/djamel/Sites/Mizane/BB
   ```
   (ou utilise `rsync -a --delete ...` pour gagner du temps).

4. **Nettoyer les secrets**  
   - Supprime toute clé, `.env*`, `.rtf` contenant un mot de passe de `BB` ou `BB-old`.  
   - Mets en place `BB/.../.git.backup` éventuelles et ajoute les chemins dans `.gitignore`.

5. **Mettre à jour Git**  
   ```bash
   cd /Users/djamel/Sites/Mizane/C=A+B
   git add BB BB-old
   git commit -m "BB refresh"
   git push
   ```
   - Si GitHub signale une clé, reproduis la procédure ci-dessus (remove + amend).

## Conseils d’exploitation quotidienne

- Pour démarrer le backend/frontend, utilise les commandes dans `AA/README.md` ou `BB/backend/README_EXTRACTION_INTELLIGENTE.md`. Garde un terminal pour `BB/backend` (venv + `python3 api.py`) et un pour `BB/frontend/harvester-ui` (`npm install && npm start`).
- Garde `BB/` en lecture seule pour `AA`: ne lui permets pas de modifier `harvester.db` ou les fichiers remontés depuis R2/E2.
- Documente les changements importants (mise à jour de B, purge des secrets, migration de données) directement dans ce README pour tracer la démarche.

## Démarrage local de BB

- Utilise `scripts/start_bb.sh` pour lancer l’API (`5001`) puis le front (`3001`). Le script recrée le `venv`, installe les dépendances, démarre l’API en tâche de fond, puis démarre Vite sur `http://localhost:3001`.
- Tu peux relancer le script autant que nécessaire ; quand tu quittes le front (`Ctrl+C`), le backend est également arrêté (via le `trap`).
- Si tu préfères démarrer les services manuellement, suis toujours la procédure décrite plus haut : backend (`venv`, `pip install -r ../requirements.txt`, `python3 api.py`) puis `npm run dev -- --port 3001` dans `BB/frontend/harvester-ui/`.

## Maintien du dépôt Mizane

- Le `main` de `https://github.com/zighedd/Mizane.git` doit contenir uniquement les dossiers `AA`, `BB`, `BB-old` et le présent README.  
- Après chaque copy/purge, vérifie `git status`, commit et pousse.  
- Si tu veux isoler AA ou BB dans des dépôts indépendants, garde les `.git.backup` sous `AA/` et `BB/` avant de reconfigurer leurs remotes.

Si tu veux que je t’aide à écrire un script d’automatisation (copy + nettoyage + commit), dis le moi et je te le prépare.
