"""Scoped Stage 4 unlock-copy fix for Block Island develop.

Only modifies three user-facing phrases in index.html. No rules, images,
JavaScript logic, resource costs, save data, or layout are changed.
Refuse if source is not independently identified alpha7.25 TEST-03.
"""
from __future__ import annotations
from hashlib import sha256
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "index.html"
EXPECTED_SHA256 = "9af4aedcd8128e2a8a716a8c8598c1ed68842636987d4a1d084d3a54407ac003"
PATCHES = (
    ("'第4段階完成！','集中探索を解放'", "'第4段階完成！','集中探索と港プロジェクトを解放'", 2),
    ("'第4段階完成','集中探索：1探索1回、手札3枚を1系統Lv1へ'", "'第4段階完成','集中探索：1探索1回、手札3枚を1系統Lv1へ／港プロジェクト解放'", 1),
)

def main():
    original = SOURCE.read_bytes()
    digest = sha256(original).hexdigest()
    if digest != EXPECTED_SHA256:
        raise SystemExit(f"Unexpected source SHA256 {digest}. Not patching.")
    body = original.decode("utf-8")
    for old, new, expected in PATCHES:
        n = body.count(old)
        if n != expected:
            raise SystemExit(f"Anchor count mismatch: {n} != {expected} for {old}")
        body = body.replace(old, new)
    updated = body.encode("utf-8")
    required_delta = sum((len(new.encode("utf-8"))-len(old.encode("utf-8")))*n for old,new,n in PATCHES)
    if len(updated) - len(original) != required_delta:
        raise SystemExit("Unexpected patch size; refusing to write.")
    SOURCE.write_bytes(updated)
    print("PATCH_OK: Stage4 describes focus exploration AND port project")
    print("OLD_SHA256", digest)
    print("NEW_SHA256", sha256(updated).hexdigest())
    print("REPLACED", sum(n for _,_,n in PATCHES))

if __name__ == "__main__":
    main()
