# Mizane – plan de développement

## Pourquoi un README *et* un script ?
- Le **README** (ou document de plan) fait office de mémoire et de checklist : il consigne le déroulé logique, les contraintes de qualité (lecture seule sur `harvester.db`, respect des palettes de couleur, modals IA) et les points de validation. Il est facile à partager et versionner.  
- Le **script** automatise l’initialisation : il crée la structure React/Flask de base, évite les erreurs de copier/coller et rend reproductible le démarrage d’un sprint. Les deux outils se complètent.

## Ordre d’exécution recommandé
1. **Lire ce document** puis exécuter `scripts/setup_library_component.sh` pour générer les fichiers de base.  
2. **Compléter les composants** (`FiltersPanel`, `DocumentTable`, `MetaModal`, etc.) dans `AA/src/pages/library` en respectant la palette (bleu foncé `#0b3d91`, orange `#f08d3c`, gris clair `#f6f7fb`).  
3. **Implémenter les endpoints** dans `AA/backend/mizane` pour `GET /api/mizane/...` et `POST /api/mizane/semantic-*`. Chaque endpoint fait uniquement des `SELECT` sur `harvester.db` et expose les URLs R2.  
4. **Préparer l’API AA** : installe les dépendances `pip install -r AA/backend/requirements.txt` (depuis le venv AA/venv) puis lance `python AA/backend/mizane/server.py` pour servir les données sur `http://localhost:5002`.  
5. **Valider l’intégration** : lancer `npm start` dans `AA`, `python3 api.py` pour la couche Flask, puis tester la page Bibliothèque juridique (JORADP + Cour suprême).  
6. **Tester la recherche IA** : le module “IA volante” appelle l’endpoint `semantic-response`; commence par une réponse statique puis branche le vrai LLM/embeddings.  
7. **Documenter les ajustements** (modals, pagination, performances) dans ce document pour garder la traçabilité.

## Bonnes pratiques supplémentaires
- Crée des composants réutilisables (`StatsCard`, `FilterChip`, `SemanticModal`) dans `AA/src/components/library`.  
- Maintiens la séparation : `AA` lit `harvester.db`, `BB` reste autonome et conserve la moisson.  
- Commits par petits pas : `LibraryPage.tsx` + `routes.py`, puis `git push` sur `zighedd/Mizane`.  
- Utilise `scripts/start_bb.sh` uniquement pour valider BB (backend 5001 + frontend 3001) quand tu dois vérifier les données R2.

Une fois la page Mizane stabilisée, on reviendra sur la migration de `harvester.db` vers un service cloud (phase 2).
