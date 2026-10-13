"""Lê os PDFs de gabarito oficial da 1ª fase (FUVEST, Unicamp e UNESP).

Cada banca publica várias versões da mesma prova (FUVEST: V, K, Q, X, Z ou
V1..V4; Unicamp: "PROVAS Q e Y"...; UNESP: "Versão 1"). O resultado é um
dicionário {versão: {número: letra}}, onde a letra "*" indica questão anulada.

Uso: python3 ferramentas/gabaritos.py caminho/gabarito.pdf
"""
import json
import re
import subprocess
import sys

# Par "número letra" nos formatos: "1 - B", "1-B", "01‐B", "01   B", "3 *"
PAR = re.compile(r"(?<![\d,.])(\d{1,2})\s*[-‐–]?\s*([A-E*])(?![A-Za-zÀ-ú])")
CABECALHO = re.compile(r"PROVAS?\s+([A-Z]\d?(?:\s+e\s+[A-Z]\d?)?)|Vers[ãa]o\s+(\d+)", re.I)
FIM = re.compile(r"CORRESPOND[ÊE]NCIA", re.I)


def texto_pdf(caminho):
    return subprocess.run(
        ["pdftotext", "-layout", caminho, "-"], capture_output=True, text=True, check=True
    ).stdout


def nomes_versoes(linha):
    """Extrai os nomes de versão de uma linha de cabeçalho."""
    nomes = []
    for m in CABECALHO.finditer(linha):
        if m.group(1):
            nomes.append(re.sub(r"\s+e\s+", "/", m.group(1).strip()).upper())
        else:
            nomes.append("VERSAO" + m.group(2))
    return nomes


def ler_gabarito(caminho):
    versoes = {}
    atuais = []
    for linha in texto_pdf(caminho).splitlines():
        if FIM.search(linha):
            break  # daqui em diante vem a tabela de correspondência entre versões
        # cabeçalho de versões (a linha não tem pares número-letra)
        if CABECALHO.search(linha) and not PAR.search(linha.split("PROVA")[0] if "PROVA" in linha.upper() else ""):
            nomes = nomes_versoes(linha)
            if nomes and not re.search(r"CONHECIMENTOS|PROVA DE", linha, re.I):
                atuais = nomes
                for n in nomes:
                    versoes.setdefault(n, {})
                continue
        if not atuais:
            continue
        pares = [(int(n), l) for n, l in PAR.findall(linha)]
        if not pares:
            continue
        # várias versões lado a lado: um novo grupo começa quando o número diminui
        grupos, anterior = [[]], 0
        for num, letra in pares:
            if num < anterior:
                grupos.append([])
            grupos[-1].append((num, letra))
            anterior = num
        if len(grupos) > len(atuais):
            raise ValueError(f"{caminho}: linha com mais grupos que versões: {linha!r}")
        for nome, grupo in zip(atuais, grupos):
            for num, letra in grupo:
                if num in versoes[nome] and versoes[nome][num] != letra:
                    raise ValueError(f"{caminho}: questão {num} repetida na versão {nome}")
                versoes[nome][num] = letra
    return {v: dict(sorted(g.items())) for v, g in versoes.items() if g}


if __name__ == "__main__":
    g = ler_gabarito(sys.argv[1])
    for v, d in g.items():
        faltando = [n for n in range(1, max(d) + 1) if n not in d]
        print(v, len(d), "faltando:", faltando, "anuladas:", [n for n, l in d.items() if l == "*"])
    if len(sys.argv) > 2:
        print(json.dumps(g, ensure_ascii=False))
