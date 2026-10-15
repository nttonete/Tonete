"""Lista o que falta, por fila, na ordem de prioridade (edições mais recentes primeiro).

  transcrição  : lote sem rascunho
  revisão      : lote transcrito sem revisao-*.json (o revisor já escreve assunto e resolução)
  complementos : lote revisado antes da resolução comentada, sem complementos-*.json
"""
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
eds = json.loads((RAIZ / "dados/provas/edicoes.json").read_text())
ordem = sorted(eds, key=lambda e: (-e["ano"], ["fuvest", "unicamp", "unesp"].index(e["vestibular"])))
filas = {"transcrição": [], "revisão": [], "complementos": []}
for e in ordem:
    if e["tipo"] != "objetiva" or e["id"] == "unicamp-2021-1":
        continue
    n = e["questoes"]
    t = 30 if n == 90 else 36
    for a in range(1, n + 1, t):
        lote = f"{a:03d}-{a + t - 1:03d}"
        pasta = RAIZ / "trabalho" / e["id"]
        item = f"{e['id']} {a} {a + t - 1}"
        rev = pasta / f"revisao-{lote}.json"
        if not (pasta / f"rascunho-{lote}.json").exists():
            filas["transcrição"].append(item)
        elif not rev.exists():
            filas["revisão"].append(item)
        elif not json.loads(rev.read_text()).get("complementos") and not (pasta / f"complementos-{lote}.json").exists():
            filas["complementos"].append(item)
for nome, itens in filas.items():
    print(f"{nome}: {len(itens)} lotes")
    print("\n".join("  " + i for i in itens[:8]))
