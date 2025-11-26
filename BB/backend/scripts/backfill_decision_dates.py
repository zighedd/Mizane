#!/usr/bin/env python3
"""
Renseigne les dates manquantes des décisions Cour Suprême
en les extrayant des fichiers/fragments HTML existants.
"""

import os
import re
import sqlite3
from datetime import datetime
from bs4 import BeautifulSoup
import requests
import sys
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from shared.r2_storage import generate_presigned_url, normalize_key, get_r2_client, get_bucket_name
from dotenv import load_dotenv

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'harvester.db')
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))


def normalize_date(value: str | None) -> str | None:
    if not value:
        return None
    formats = [
        '%d/%m/%Y', '%d-%m-%Y', '%d.%m.%Y',
        '%Y-%m-%d', '%Y/%m/%d', '%Y.%m.%d',
        '%m/%d/%Y', '%m-%d-%Y',
    ]
    for fmt in formats:
        try:
            return datetime.strptime(value, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return None


def extract_date_from_text(text: str) -> str | None:
    if not text:
        return None
    patterns = [
        r'\b(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{4})\b',
        r'\b(\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2})\b',
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            normalized = normalize_date(m.group(1))
            if normalized:
                return normalized
    return None


def extract_text_from_html(html_content: str | None) -> str:
    if not html_content:
        return ""
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        for tag in soup(['script', 'style']):
            tag.decompose()
        return soup.get_text(separator='\n', strip=True)
    except Exception:
        return ""


def backfill_dates():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("""
        SELECT id, decision_number, decision_date, file_path_fr, file_path_ar, html_content_fr, html_content_ar
        FROM supreme_court_decisions
        WHERE decision_date IS NULL OR decision_date = '' OR decision_date = 'SANS_DATE'
    """)
    rows = cur.fetchall()
    print(f"📋 {len(rows)} décisions sans date explicite")

    updated = 0
    for row in rows:
        text = ""
        if row['file_path_fr']:
            path_fr = row['file_path_fr']
            fetch_url = path_fr
            if path_fr.startswith('http'):
                fetch_url = generate_presigned_url(path_fr) or path_fr
            elif normalize_key(path_fr):
                fetch_url = generate_presigned_url(path_fr)

            if fetch_url and fetch_url.startswith('http'):
                try:
                    resp = requests.get(fetch_url, timeout=15)
                    if resp.ok:
                        resp.encoding = 'utf-8'
                        text = resp.text
                except Exception:
                    text = ""
            elif os.path.exists(path_fr):
                try:
                    with open(path_fr, 'r', encoding='utf-8') as f:
                        text = f.read()
                except Exception:
                    text = ""
            elif normalize_key(path_fr):
                try:
                    client = get_r2_client()
                    bucket = get_bucket_name()
                    obj = client.get_object(Bucket=bucket, Key=normalize_key(path_fr))
                    text = obj['Body'].read().decode('utf-8', errors='ignore')
                except Exception:
                    text = ""

        if not text and row['html_content_fr']:
            text = extract_text_from_html(row['html_content_fr'])

        if not text and row['file_path_ar']:
            path_ar = row['file_path_ar']
            fetch_url = path_ar
            if path_ar.startswith('http'):
                fetch_url = generate_presigned_url(path_ar) or path_ar
            elif normalize_key(path_ar):
                fetch_url = generate_presigned_url(path_ar)

            if fetch_url and fetch_url.startswith('http'):
                try:
                    resp = requests.get(fetch_url, timeout=15)
                    if resp.ok:
                        resp.encoding = 'utf-8'
                        text = resp.text
                except Exception:
                    text = ""
            elif os.path.exists(path_ar):
                try:
                    with open(path_ar, 'r', encoding='utf-8') as f:
                        text = f.read()
                except Exception:
                    text = ""
            elif normalize_key(path_ar):
                try:
                    client = get_r2_client()
                    bucket = get_bucket_name()
                    obj = client.get_object(Bucket=bucket, Key=normalize_key(path_ar))
                    text = obj['Body'].read().decode('utf-8', errors='ignore')
                except Exception:
                    text = ""

        if not text and row['html_content_ar']:
            text = extract_text_from_html(row['html_content_ar'])

        extracted = extract_date_from_text(text)
        if extracted:
            cur.execute(
                "UPDATE supreme_court_decisions SET decision_date = ? WHERE id = ?",
                (extracted, row['id'])
            )
            updated += 1
            if updated % 50 == 0:
                conn.commit()
                print(f"   ➜ {updated} dates mises à jour…")

    conn.commit()
    conn.close()
    print(f"✅ Dates mises à jour pour {updated} décision(s).")


if __name__ == "__main__":
    backfill_dates()
