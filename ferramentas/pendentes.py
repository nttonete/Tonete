"""Lista os lotes de transcrição e de revisão que ainda faltam, na ordem de prioridade."""
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
eds = json.loads((RAIZ / "dados/provas/edicoes.json").read_text())
ordem = sorted(eds, key=lambda e: (-e["ano"], ["fuvest", "unicamp", "unesp"].index(e["vestibular"])))
transc, rev = [], []
for e in ordem:
    if e["tipo"] != "objetiva" or e["id"] == "unicamp-2021-1":
        continue
    n = e["questoes"]
    t = 30 if n == 90 else 36
    for a in range(1, n + 1, t):
        lote = f"{a:03d}-{a + t - 1:03d}"
        pasta = RAIZ / "trabalho" / e["id"]
        if not (pasta / f"rascunho-{lote}.json").exists():
            transc.append(f"{e['id']} {a} {a + t - 1}")
        elif not (pasta / f"revisao-{lote}.json").exists():
            rev.append(f"{e['id']} {a} {a + t - 1}")
print(f"transcrição: {len(transc)} lotes")
print("\n".join(transc[:12]))
print(f"revisão: {len(rev)} lotes")
print("\n".join(rev[:12]))
