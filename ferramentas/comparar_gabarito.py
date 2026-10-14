"""Compara as respostas do revisor com o gabarito oficial. Use só DEPOIS de gravar suas respostas.

Uso: python3 ferramentas/comparar_gabarito.py <edicao> <arquivo-respostas.json>
O arquivo de respostas é {"31": "B", "32": "D", ...} com a sua resolução de cada questão.
"""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ed, arq = sys.argv[1], sys.argv[2]
d = json.loads((RAIZ / "dados/questoes" / f"{ed}.json").read_text())
oficial = {q["numero"]: ("anulada" if q.get("anulada") else q.get("gabarito")) for q in d["questoes"]}
minhas = {int(k): v.upper() for k, v in json.loads(Path(arq).read_text()).items()}
iguais, diferentes = [], []
for n in sorted(minhas):
    (iguais if oficial.get(n) == minhas[n] else diferentes).append(n)
print(f"concordam: {len(iguais)}")
for n in diferentes:
    print(f"DIVERGE q{n}: sua resposta {minhas[n]}, gabarito oficial {oficial.get(n)}")
