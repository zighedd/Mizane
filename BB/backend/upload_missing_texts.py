import os
from shared.r2_storage import upload_bytes

missing_file = "missing_texts.txt"
base_local_dir = "/Users/djamel/Documents/Textes_juridiques_DZ/joradp.dz"

with open(missing_file) as fh:
    for line in fh:
        doc_id, r2_path, reason = line.strip().split("|")
        filename = os.path.basename(r2_path)
        year = os.path.basename(os.path.dirname(r2_path))
        local_path = os.path.join(base_local_dir, year, filename)
        if not os.path.exists(local_path):
            print(f"[{doc_id}] fichier local introuvable: {local_path}")
            continue
        with open(local_path, "rb") as f:
            bytes_data = f.read()
        key = f"Textes_juridiques_DZ/joradp.dz/{year}/{filename}"
        url = upload_bytes(key, bytes_data, content_type="text/plain; charset=utf-8")
        print(f"[{doc_id}] Uploaded {key} -> {url}")

