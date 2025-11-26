import sqlite3
import time
import requests
import numpy as np
from sentence_transformers import SentenceTransformer

DB_PATH = "harvester.db"
MODEL_NAME = "all-MiniLM-L6-v2"

model = SentenceTransformer(MODEL_NAME)
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

cursor.execute("""
SELECT d.id, d.url, d.text_path
FROM documents d
LEFT JOIN document_embeddings e ON d.id = e.document_id
WHERE e.document_id IS NULL AND d.text_path IS NOT NULL
""")
rows = cursor.fetchall()

upsert = """
INSERT INTO document_embeddings (document_id, embedding, model_name, dimension)
VALUES (?, ?, ?, ?)
ON CONFLICT(document_id) DO UPDATE SET
  embedding = excluded.embedding,
  model_name = excluded.model_name,
  dimension = excluded.dimension
"""

processed = 0
for doc_id, url, text_path in rows:
    if not text_path:
        continue
    try:
        resp = requests.get(text_path, timeout=60)
        resp.raise_for_status()
        text = resp.text.strip()
    except Exception as exc:
        print("skip", doc_id, url, exc)
        continue
    if not text:
        continue
    embedding = model.encode(text[:10000], convert_to_numpy=True).astype(np.float32)
    cursor.execute(upsert, (doc_id, embedding.tobytes(), MODEL_NAME, embedding.shape[0]))
    processed += 1
    if processed % 100 == 0:
        conn.commit()
        print("processed", processed)
        time.sleep(0.05)

conn.commit()
print("finished", processed)
conn.close()
