"""Acha questões discursivas repetidas entre cadernos do mesmo ano (Unicamp, 2º dia).

Os cadernos de área da Unicamp (Exatas, Biológicas, Humanas) repetem questões:
as interdisciplinares, parte da Matemática, a Química. A questão repetida é
transcrita uma vez só, no primeiro caderno da ordem abaixo; nos outros ela
fica registrada em "repetidas" (dados/provas/edicoes.json) e não é transcrita.

Uso: python3 ferramentas/repetidas.py [--gravar] [ano ...]
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

import pymupdf

RAIZ = Path(__file__).resolve().parent.parent
ORDEM = ["d1", "d2", "d3", "cet", "cbs", "cha"]
NUMERO = re.compile(r"^\s*(?:QUEST[ÃA]O\s+)?(\d{1,2})\s*\.(?:\s+(.*))?$", re.I)


def normalizar(t):
    t = unicodedata.normalize("NFKD", t.lower())
    t = "".join(c for c in t if c.isalnum() or c.isspace())
    return " ".join(t.split())


def questoes(pdf):
    """Texto de cada questão do caderno, cortado nos números de questão no começo da linha.

    Na Unicamp cada questão começa numa página nova; isso descarta listas numeradas
    das instruções da capa.
    """
    blocos, atual, esperado, pag_atual = {}, None, 1, None
    for k, pagina in enumerate(pymupdf.open(pdf)):
        for linha in pagina.get_text().splitlines():
            m = NUMERO.match(linha)
            if m and int(m.group(1)) == esperado and k != pag_atual:
                atual, esperado, pag_atual = esperado, esperado + 1, k
                blocos[atual] = [m.group(2) or ""]
                continue
            if atual and not re.search(r"Resolução \(será|RASCUNHO|^\s*\d+\s*$", linha):
                blocos[atual].append(linha)
    return {n: trincas(normalizar(" ".join(v))) for n, v in blocos.items()}


def trincas(t):
    """Conjunto de sequências de três palavras: comparar conjuntos é rápido e tolera quebras de linha."""
    p = t.split()
    return {" ".join(p[i:i + 3]) for i in range(max(1, len(p) - 2))}


def semelhanca(a, b):
    return len(a & b) / len(a | b) if a and b else 0


def main():
    args = sys.argv[1:]
    gravar = "--gravar" in args
    anos = {int(a) for a in args if a.isdigit()}
    arq = RAIZ / "dados/provas/edicoes.json"
    eds = json.loads(arq.read_text())
    por_ano = {}
    for e in eds:
        if e["tipo"] == "discursiva" and e["vestibular"] == "unicamp" and (not anos or e["ano"] in anos):
            por_ano.setdefault(e["ano"], []).append(e)
    for ano, lista in sorted(por_ano.items()):
        lista.sort(key=lambda e: ORDEM.index(e["id"].rsplit("-", 1)[1]))
        textos = {e["id"]: questoes(RAIZ / e["pdf"]) for e in lista}
        vistos = []  # (id da questão, texto) já transcritas
        for e in lista:
            rep = {}
            for n, t in textos[e["id"]].items():
                melhor, nota = None, 0
                for qid, t2 in vistos:
                    r = semelhanca(t, t2)
                    if r > nota:
                        melhor, nota = qid, r
                if nota >= 0.8:
                    rep[str(n)] = melhor
                else:
                    vistos.append((f"{e['id']}-q{n:02d}", t))
                    if nota > 0.4:
                        print(f"  atenção: {e['id']} q{n} parecida ({nota:.2f}) com {melhor}, mas não igual")
            e["questoes"] = len(textos[e["id"]])
            if rep:
                e["repetidas"] = rep
            else:
                e.pop("repetidas", None)
            print(f"{e['id']}: {e['questoes']} questões, {len(rep)} repetidas: {', '.join(f'{k}→{v[len(f"unicamp-{ano}-2-"):]}' for k, v in rep.items())}")
    if gravar:
        arq.write_text(json.dumps(eds, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
