"""Mostra as questões de uma edição SEM o gabarito, para o revisor resolver às cegas.

Uso: python3 ferramentas/ver_questoes.py <edicao> <de> <ate>
"""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ed, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
d = json.loads((RAIZ / "dados/questoes" / f"{ed}.json").read_text())
usados = set()
for q in d["questoes"]:
    if a <= q["numero"] <= b:
        tb = q.get("texto_base")
        if tb and tb not in usados:
            usados.add(tb)
            print(f"\n######## TEXTO BASE {tb}\n{d['textos_base'][tb]}")
        print(f"\n======== QUESTÃO {q['numero']} ({q['materia']}{', anulada' if q.get('anulada') else ''})")
        if tb:
            print(f"[usa o texto base {tb}]")
        print(q["enunciado"])
        for letra, t in sorted((q.get("alternativas") or {}).items()):
            print(f"({letra}) {t}")
