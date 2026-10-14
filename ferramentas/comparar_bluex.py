"""Compara as alternativas do banco com o dataset BLUEX (mesma versão do caderno) e aponta divergências.

Conferência independente: o BLUEX foi digitado por outra equipe. Diferença alta indica possível erro
de transcrição (nosso ou deles) e merece olhar humano na página original.
Uso: python3 ferramentas/comparar_bluex.py <pasta-bluex/questions> <edicao>
"""
import difflib
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def limpar(t):
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)|\[\[\d+\]\]|<[^>]+>|[*$\\{}^_]|\\text|\\mathrm", " ", t or "")
    t = re.sub(r"^\s*[a-eA-E]\)\s*", "", t)
    # compara só letras e números: a formatação das fórmulas (LaTeX x texto) não conta
    t = re.sub(r"\\?(frac|text|mathrm|cdot|times|left|right|quad|dfrac|sqrt)\b", " ", t)
    return re.sub(r"[^0-9a-zà-ÿ]+", "", t.lower())


pasta, ed = Path(sys.argv[1]), sys.argv[2]
vest, ano = ed.split("-")[0], ed.split("-")[1]
d = json.loads((RAIZ / "dados/questoes" / f"{ed}.json").read_text())
pb = pasta / {"fuvest": "USP", "unicamp": "UNICAMP"}[vest] / ano
suspeitas = 0
for q in d["questoes"]:
    arq = pb / f"{q['numero']}.json"
    if not arq.exists():
        continue
    b = json.loads(arq.read_text())
    if b.get("alternatives_type") != "string":
        continue
    nossas = [limpar(q["alternativas"][k]) for k in sorted(q["alternativas"])]
    deles = [limpar(x) for x in b["alternatives"]]
    for letra, a, c in zip("ABCDE", nossas, deles):
        if "fig:" in (q["alternativas"].get(letra) or "") or not c:
            continue
        r = difflib.SequenceMatcher(None, a, c).ratio()
        if r < 0.85:
            suspeitas += 1
            print(f"q{q['numero']} {letra} ({r:.2f})\n  nosso: {a[:140]}\n  bluex: {c[:140]}")
print(f"{suspeitas} alternativa(s) com diferença relevante")
