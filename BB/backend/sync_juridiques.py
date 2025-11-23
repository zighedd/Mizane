import os
from collections import defaultdict

from shared.r2_storage import generate_presigned_url, upload_bytes
import requests

LOCAL_BASE = "/Users/djamel/Documents/Textes_juridiques_DZ/joradp.dz"
R2_PREFIX = "Textes_juridiques_DZ/joradp.dz"

missing_pairs = []
stats = defaultdict(lambda: {"pdf": 0, "txt": 0, "uploaded": []})
errors = []


def remote_exists(key):
    signed = generate_presigned_url(f"textes-juridiques/{key}")
    if not signed:
        return False
    try:
        resp = requests.get(signed, timeout=10, stream=True)
        ok = resp.status_code < 300
        resp.close()
        return ok
    except Exception as exc:
        errors.append((key, repr(exc)))
        return False


def upload_file(local_path, key):
    with open(local_path, "rb") as f:
        upload_bytes(key, f.read(), content_type="text/plain; charset=utf-8" if key.endswith(".txt") else "application/pdf")


for year in sorted(os.listdir(LOCAL_BASE)):
    year_dir = os.path.join(LOCAL_BASE, year)
    if not os.path.isdir(year_dir):
        continue
    items = sorted(os.listdir(year_dir))
    pdfs = {os.path.splitext(name)[0] for name in items if name.lower().endswith(".pdf")}
    txts = {os.path.splitext(name)[0] for name in items if name.lower().endswith(".txt")}
    common = sorted(pdfs | txts)
    stats[year]["pdf"] = len(pdfs)
    stats[year]["txt"] = len(txts)

    for name in common:
        pdf_path = os.path.join(year_dir, f"{name}.pdf")
        txt_path = os.path.join(year_dir, f"{name}.txt")
        pdf_key = f"{R2_PREFIX}/{year}/{name}.pdf"
        txt_key = f"{R2_PREFIX}/{year}/{name}.txt"

        if os.path.exists(pdf_path):
            if not remote_exists(pdf_key):
                upload_file(pdf_path, pdf_key)
                stats[year]["uploaded"].append(pdf_key)
        else:
            missing_pairs.append((year, name, "pdf missing locally"))

        if os.path.exists(txt_path):
            if not remote_exists(txt_key):
                upload_file(txt_path, txt_key)
                stats[year]["uploaded"].append(txt_key)
        else:
            missing_pairs.append((year, name, "txt missing locally"))

print("=== Résumé par année ===")
for year, data in sorted(stats.items()):
    print(f"{year}: {data['pdf']} PDF / {data['txt']} TXT, {len(data['uploaded'])} fichier(s) uploadé(s)")

if missing_pairs:
    print("\nDocuments locaux incomplets :")
    for entry in missing_pairs:
        print(f"{entry[0]} {entry[1]} -> {entry[2]}")

if errors:
    print("\nExceptions R2 :")
    for entry in errors[:10]:
        print(entry)
