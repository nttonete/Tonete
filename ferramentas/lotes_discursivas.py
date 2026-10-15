"""Lista os lotes de transcrição das discursivas que ainda faltam.

Cada lote tem até 11 questões próprias do caderno (as repetidas de outro
caderno não contam). Lotes já gravados em trabalho/<edicao>/rascunho-*.json
ficam de fora.

Uso: python3 ferramentas/lotes_discursivas.py
"""
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MAX = 11


def lotes(ed):
    rep = {int(k) for k in ed.get("repetidas") or {}}
    proprias = [n for n in range(1, ed["questoes"] + 1) if n not in rep]
    partes = -(-len(proprias) // MAX)
    tam = -(-len(proprias) // partes)
    saida = []
    for i in range(partes):
        grupo = proprias[i * tam:(i + 1) * tam]
        if grupo:
            # o intervalo cobre as repetidas do meio, que o pedido manda pular
            a = grupo[0] if i else 1
            b = grupo[-1] if i < partes - 1 else ed["questoes"]
            saida.append((a, b))
    return saida


def main():
    for ed in json.loads((RAIZ / "dados/provas/edicoes.json").read_text()):
        if ed["tipo"] != "discursiva":
            continue
        feitos = {tuple(json.loads(f.read_text()).get("intervalo") or ())
                  for f in (RAIZ / "trabalho" / ed["id"]).glob("rascunho-*.json")}
        for a, b in lotes(ed):
            if (a, b) not in feitos:
                print(ed["id"], a, b)


if __name__ == "__main__":
    main()
