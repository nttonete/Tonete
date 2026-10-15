"""Liga cada obra de leitura obrigatória (dados/conteudo/obras.json) às questões do banco que falam dela.

Procura só termos inequívocos: o título, nomes de personagens marcantes e o nome do autor quando ele
tem uma única obra cobrada (Machado, Clarice, Lima Barreto e outros têm várias obras em provas antigas,
então só o título conta). Grava a lista em "questoes" de cada obra. Rode depois de montar o banco.
"""
import json
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ARQ = RAIZ / "dados/conteudo/obras.json"

TERMOS = {
    "opusculo-humanitario": ["Opúsculo humanitário", "Nísia Floresta"],
    "nebulosas": ["Nebulosas", "Narcisa Amália"],
    "memorias-de-martha": ["Memórias de Martha", "Memórias de Marta", "Julia Lopes de Almeida", "Júlia Lopes de Almeida"],
    "caminho-de-pedras": ["Caminho de pedras"],
    "a-paixao-segundo-gh": ["Paixão segundo G.H", "Paixão segundo G. H"],
    "geografia": ["Sophia de Mello Breyner"],
    "balada-de-amor-ao-vento": ["Balada de amor ao vento", "Paulina Chiziane", "Sarnau", "Mwando"],
    "cancao-para-ninar-menino-grande": ["Canção para ninar menino grande", "Fio Jasmim"],
    "a-visao-das-plantas": ["A visão das plantas", "Djaimilia"],
    "prosas-seguidas-de-odes-minimas": ["Prosas seguidas de odes mínimas", "José Paulo Paes"],
    "cancoes-escolhidas-paulo-cesar-pinheiro": ["Paulo César Pinheiro"],
    "os-funerais-da-mamae-grande": ["Mamãe Grande"],
    "morangos-mofados": ["Morangos mofados", "Caio Fernando Abreu"],
    "olhos-dagua": ["Olhos d'água", "Olhos d’água", "Ana Davenga", "Duzu-Querença"],
    "no-seu-pescoco": ["No seu pescoço", "Chimamanda", "Adichie"],
    "vida-e-morte-de-mj-gonzaga-de-sa": ["Gonzaga de Sá"],
    "memorias-postumas-de-bras-cubas": ["Memórias póstumas de Brás Cubas", "Brás Cubas"],
    "a-vida-nao-e-util": ["A vida não é útil", "Krenak"],
}


def main():
    obras = json.loads(ARQ.read_text())
    textos = []
    for arq in sorted((RAIZ / "dados/questoes").glob("*.json")):
        d = json.loads(arq.read_text())
        if d["edicao"]["vestibular"] not in ("fuvest", "unicamp"):
            continue
        for q in d["questoes"]:
            if q.get("anulada") or q["materia"] not in ("portugues", "literatura"):
                continue
            t = q["enunciado"] + " " + (d["textos_base"].get(q.get("texto_base") or "", "")) + " " + json.dumps(q.get("alternativas") or {}, ensure_ascii=False)
            for it in q.get("itens", []):
                t += " " + it.get("texto", "")
            textos.append((d["edicao"], q, t.lower()))
    for oid, ob in obras["obras"].items():
        termos = [x.lower() for x in TERMOS.get(oid, [ob["titulo"]])]
        achadas = []
        for ed, q, t in textos:
            if any(x in t for x in termos):
                achadas.append({"id": q["id"], "ed": ed["id"], "n": q["numero"], "ano": ed["ano"], "tipo": ed["tipo"]})
        ob["questoes"] = achadas
        print(f"{oid}: {len(achadas)} questões")
    ARQ.write_text(json.dumps(obras, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
