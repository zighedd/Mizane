import os
import json
from pathlib import Path
from openai import OpenAI
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

# Charge la .env locale, puis la .env à la racine du projet si elle existe.
load_dotenv()
root_env = Path(__file__).resolve().parents[3] / ".env"
if root_env.exists():
    load_dotenv(root_env)

class CourSupremeAnalyzer:
    def __init__(self):
        self.client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
        self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
    
    def analyze_decision(self, text_ar, text_fr):
        """Analyse complète d'une décision AR + FR"""

        results = {
            'summary_ar': None,
            'summary_fr': None,
            'title_ar': None,
            'title_fr': None,
            'keywords_ar': None,
            'keywords_fr': None,
            'entities_ar': None,
            'entities_fr': None,
            'embedding_ar': None,
            'embedding_fr': None
        }

        # 1. Résumé + Titre + Mots-clés AR
        if text_ar:
            ar_analysis = self._analyze_text(text_ar, 'ar')
            results['summary_ar'] = ar_analysis['summary']
            results['title_ar'] = ar_analysis['title']
            results['keywords_ar'] = json.dumps(ar_analysis['keywords'], ensure_ascii=False)
            results['entities_ar'] = json.dumps(ar_analysis['entities'], ensure_ascii=False)

        # 2. Résumé + Titre + Mots-clés FR
        if text_fr:
            fr_analysis = self._analyze_text(text_fr, 'fr')
            results['summary_fr'] = fr_analysis['summary']
            results['title_fr'] = fr_analysis['title']
            results['keywords_fr'] = json.dumps(fr_analysis['keywords'], ensure_ascii=False)
            results['entities_fr'] = json.dumps(fr_analysis['entities'], ensure_ascii=False)
        
        # 3. Embeddings (un pour chaque langue)
        if text_ar:
            results['embedding_ar'] = self.embedding_model.encode(text_ar[:5000]).tobytes()

        if text_fr:
            results['embedding_fr'] = self.embedding_model.encode(text_fr[:5000]).tobytes()
        
        return results
    
    def _analyze_text(self, text, lang):
        """Analyse un texte dans une langue donnée"""
        
        lang_instruction = "Réponds en ARABE" if lang == 'ar' else "Réponds en FRANÇAIS"
        
        prompt = f"""{lang_instruction}. Analyse cette décision juridique et retourne un JSON avec:
1. "summary": résumé de 3-4 lignes
2. "title": titre court et descriptif (max 100 caractères)
3. "keywords": liste de 5-8 mots-clés juridiques pertinents
4. "entities": liste des entités nommées (personnes, institutions, lieux)

Décision:
{text[:3000]}

IMPORTANT: Toutes tes réponses (summary, title, keywords, entities) doivent être dans la langue du texte ({"arabe" if lang == "ar" else "français"}).
Réponds UNIQUEMENT avec un JSON valide, sans markdown."""

        try:
            response = self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "Tu es un assistant juridique expert. Réponds uniquement en JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=800
            )
            
            content = response.choices[0].message.content.strip()
            content = content.replace('```json', '').replace('```', '').strip()
            
            return json.loads(content)
            
        except Exception as e:
            print(f"Erreur analyse {lang}: {e}")
            return {
                'summary': None,
                'title': None,
                'keywords': [],
                'entities': []
            }

analyzer = CourSupremeAnalyzer()
