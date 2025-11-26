#!/usr/bin/env python3
"""
Script de complétion automatique des analyses de la Cour Suprême
Traite toutes les décisions manquantes (téléchargement, traduction, analyse, embeddings)
"""

import os
import sys
import sqlite3
import time
from bs4 import BeautifulSoup
from modules.coursupreme.analyzer import CourSupremeAnalyzer
from datetime import datetime
import re

DB_PATH = 'harvester.db'

class CourSupremeCompleter:
    """Complète les traitements manquants pour les décisions"""

    def __init__(self):
        self.analyzer = CourSupremeAnalyzer()
        self.stats = {
            'total': 0,
            'analyzed': 0,
            'failed': 0,
            'skipped': 0
        }
        self.start_time = time.time()

    def extract_text_from_html(self, html_content):
        """Extraire le texte d'un contenu HTML"""
        if not html_content:
            return ""

        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            # Retirer les scripts et styles
            for script in soup(["script", "style"]):
                script.decompose()

            # Extraire le texte
            text = soup.get_text(separator='\n', strip=True)
            return text
        except Exception as e:
            print(f"      ⚠️ Erreur extraction HTML: {e}")
            return ""

    @staticmethod
    def _normalize_date(value: str | None) -> str | None:
        """Normaliser une date au format ISO (YYYY-MM-DD) si possible."""
        if not value:
            return None
        candidates = [
            '%d/%m/%Y', '%d-%m-%Y', '%d.%m.%Y',
            '%Y-%m-%d', '%Y/%m/%d', '%Y.%m.%d',
            '%m/%d/%Y', '%m-%d-%Y',
        ]
        for fmt in candidates:
            try:
                dt = datetime.strptime(value, fmt)
                return dt.strftime('%Y-%m-%d')
            except ValueError:
                continue
        return None

    def extract_date_from_text(self, text: str) -> str | None:
        """Cherche une date dans le texte (formats JJ/MM/AAAA, JJ-MM-AAAA, AAAA-MM-JJ, etc.)."""
        if not text:
            return None
        # Chercher d'abord une mention explicite de date
        patterns = [
            r'\b(\d{1,2}[/-\.]\d{1,2}[/-\.]\d{4})\b',
            r'\b(\d{4}[/-\.]\d{1,2}[/-\.]\d{1,2})\b',
        ]
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                normalized = self._normalize_date(match.group(1))
                if normalized:
                    return normalized
        return None

    def analyze_decision(self, dec_id, decision):
        """Analyser une décision et mettre à jour la base"""

        print(f"\n{'='*70}")
        print(f"📄 Décision {dec_id}: {decision['decision_number']}")
        print(f"   Date: {decision['decision_date']}")
        print(f"{'='*70}")

        # Vérifier si déjà analysée
        if decision['title_ar'] and decision['title_fr'] and \
           decision['summary_ar'] and decision['summary_fr'] and \
           decision['keywords_ar'] and decision['keywords_fr'] and \
           decision['entities_ar'] and decision['entities_fr']:
            print("   ✅ Déjà analysée complètement, ignorée")
            self.stats['skipped'] += 1
            return True

        # Lire le texte depuis les fichiers
        print("   📝 Lecture du texte depuis les fichiers...")
        text_ar = ""
        text_fr = ""

        if decision['file_path_ar'] and os.path.exists(decision['file_path_ar']):
            try:
                with open(decision['file_path_ar'], 'r', encoding='utf-8') as f:
                    text_ar = f.read()
            except Exception as e:
                print(f"      ⚠️ Erreur lecture fichier AR: {e}")

        if decision['file_path_fr'] and os.path.exists(decision['file_path_fr']):
            try:
                with open(decision['file_path_fr'], 'r', encoding='utf-8') as f:
                    text_fr = f.read()
            except Exception as e:
                print(f"      ⚠️ Erreur lecture fichier FR: {e}")

        # Fallback: essayer le HTML si pas de fichiers
        if not text_ar:
            text_ar = self.extract_text_from_html(decision.get('html_content_ar'))
        if not text_fr:
            text_fr = self.extract_text_from_html(decision.get('html_content_fr'))

        if not text_ar and not text_fr:
            print("   ❌ Aucun texte à analyser")
            self.stats['failed'] += 1
            return False

        print(f"   ✅ Texte extrait: AR={len(text_ar)} chars, FR={len(text_fr)} chars")

        # Extraire une date si absente
        extracted_date = None
        if not decision.get('decision_date'):
            extracted_date = self.extract_date_from_text(text_fr) or self.extract_date_from_text(text_ar)
            if extracted_date:
                print(f"   📅 Date détectée et normalisée: {extracted_date}")

        # Analyser avec OpenAI
        print("   🤖 Analyse IA en cours...")
        try:
            results = self.analyzer.analyze_decision(text_ar, text_fr)

            # Afficher les résultats
            print("   ✅ Analyse terminée:")
            if results['title_ar']:
                print(f"      📌 Titre AR: {results['title_ar'][:60]}...")
            if results['title_fr']:
                print(f"      📌 Titre FR: {results['title_fr'][:60]}...")
            if results['keywords_ar']:
                import json
                kw_ar = json.loads(results['keywords_ar'])
                print(f"      🔑 Mots-clés AR: {', '.join(kw_ar[:5])}")
            if results['keywords_fr']:
                import json
                kw_fr = json.loads(results['keywords_fr'])
                print(f"      🔑 Mots-clés FR: {', '.join(kw_fr[:5])}")

            # Mettre à jour la base de données
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE supreme_court_decisions
                SET
                    title_ar = ?,
                    title_fr = ?,
                    summary_ar = ?,
                    summary_fr = ?,
                    keywords_ar = ?,
                    keywords_fr = ?,
                    entities_ar = ?,
                    entities_fr = ?,
                    embedding_ar = ?,
                    embedding_fr = ?,
                    decision_date = COALESCE(?, decision_date),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (
                results['title_ar'],
                results['title_fr'],
                results['summary_ar'],
                results['summary_fr'],
                results['keywords_ar'],
                results['keywords_fr'],
                results['entities_ar'],
                results['entities_fr'],
                results['embedding_ar'],
                results['embedding_fr'],
                extracted_date,
                dec_id
            ))

            conn.commit()
            conn.close()

            print("   💾 Base de données mise à jour")
            self.stats['analyzed'] += 1
            return True

        except Exception as e:
            print(f"   ❌ Erreur analyse: {e}")
            import traceback
            traceback.print_exc()
            self.stats['failed'] += 1
            return False

    def print_progress(self, current, total):
        """Afficher la progression"""
        elapsed = time.time() - self.start_time
        rate = current / elapsed if elapsed > 0 else 0
        remaining = (total - current) / rate if rate > 0 else 0

        print(f"\n{'='*70}")
        print(f"📊 PROGRESSION: {current}/{total} ({current/total*100:.1f}%)")
        print(f"   ⏱️  Temps écoulé:  {elapsed/60:.1f} minutes")
        print(f"   ⚡ Vitesse:       {rate*60:.1f} décisions/heure")
        print(f"   ⏳ Temps restant: {remaining/60:.1f} minutes (estimation)")
        print(f"   ✅ Analysées:    {self.stats['analyzed']}")
        print(f"   ⏭️  Ignorées:     {self.stats['skipped']}")
        print(f"   ❌ Échecs:       {self.stats['failed']}")
        print(f"{'='*70}")

    def print_final_stats(self):
        """Afficher les statistiques finales"""
        elapsed = time.time() - self.start_time

        print(f"\n\n{'='*70}")
        print(f"🎉 TRAITEMENT TERMINÉ")
        print(f"{'='*70}")
        print(f"📊 Statistiques:")
        print(f"   Total traité:    {self.stats['total']}")
        print(f"   ✅ Analysées:     {self.stats['analyzed']}")
        print(f"   ⏭️  Ignorées:      {self.stats['skipped']}")
        print(f"   ❌ Échecs:        {self.stats['failed']}")
        print(f"   ⏱️  Durée totale:  {elapsed/60:.1f} minutes")
        if self.stats['analyzed'] > 0:
            print(f"   ⚡ Vitesse moy.:  {self.stats['analyzed']/elapsed*60:.1f} décisions/heure")
        print(f"{'='*70}\n")


def main():
    """Point d'entrée principal"""

    print("""
╔════════════════════════════════════════════════════════════════════╗
║                                                                    ║
║        COMPLÉTION DES ANALYSES COUR SUPRÊME                        ║
║                                                                    ║
║  Ce script complète les analyses manquantes:                      ║
║    - Titre (AR + FR)                                               ║
║    - Résumé (AR + FR)                                              ║
║    - Mots-clés (AR + FR)                                           ║
║    - Entités nommées (AR + FR)                                     ║
║    - Embeddings                                                    ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
    """)

    # Vérifier la clé API
    if not os.getenv('OPENAI_API_KEY'):
        print("❌ Erreur: OPENAI_API_KEY non définie")
        print("   Définissez-la avec: export OPENAI_API_KEY='votre-clé'")
        sys.exit(1)

    # Initialiser le completer
    try:
        completer = CourSupremeCompleter()
    except Exception as e:
        print(f"❌ Erreur initialisation: {e}")
        sys.exit(1)

    # Récupérer les décisions à analyser
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Décisions avec fichiers téléchargés mais analyse incomplète
    cursor.execute("""
        SELECT
            id,
            decision_number,
            decision_date,
            file_path_ar,
            file_path_fr,
            html_content_ar,
            html_content_fr,
            title_ar,
            title_fr,
            summary_ar,
            summary_fr,
            keywords_ar,
            keywords_fr,
            entities_ar,
            entities_fr
        FROM supreme_court_decisions
        WHERE (file_path_ar IS NOT NULL OR file_path_fr IS NOT NULL OR html_content_ar IS NOT NULL OR html_content_fr IS NOT NULL)
        AND (
            title_ar IS NULL OR title_fr IS NULL OR
            summary_ar IS NULL OR summary_fr IS NULL OR
            keywords_ar IS NULL OR keywords_fr IS NULL OR
            entities_ar IS NULL OR entities_fr IS NULL
        )
        ORDER BY id
    """)

    decisions = cursor.fetchall()
    conn.close()

    total = len(decisions)
    print(f"\n📋 {total} décisions à analyser\n")

    if total == 0:
        print("✅ Toutes les décisions sont déjà analysées !")
        return

    # Traiter les décisions
    completer.stats['total'] = total

    for idx, decision in enumerate(decisions, 1):
        completer.analyze_decision(decision['id'], decision)

        # Afficher la progression tous les 10 documents
        if idx % 10 == 0 or idx == total:
            completer.print_progress(idx, total)

        # Petite pause pour ne pas surcharger l'API
        if idx < total:
            time.sleep(1)

    # Afficher les statistiques finales
    completer.print_final_stats()


if __name__ == '__main__':
    main()
