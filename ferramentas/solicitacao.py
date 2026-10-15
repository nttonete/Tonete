"""Registro das solicitações de remoção de conteúdo (direitos autorais).

Cada solicitação guarda data, solicitante, conteúdo e status, com prazo-alvo de resposta de
5 dias úteis (sábados e domingos não contam; feriados não são descontados).
O arquivo fica em privado/ (fora do git e fora da plataforma): tem dados pessoais de quem pede.

  python3 ferramentas/solicitacao.py registrar --solicitante "Nome <e-mail>" --conteudo "unicamp-2023-1-q05" --detalhe "..."
  python3 ferramentas/solicitacao.py atualizar ID --status em_analise|atendida|recusada --nota "..."
  python3 ferramentas/solicitacao.py listar
"""
import argparse
import datetime
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ARQ = RAIZ / "privado/solicitacoes.json"
STATUS = ("recebida", "em_analise", "atendida", "recusada")
PRAZO_DIAS_UTEIS = 5


def somar_dias_uteis(dia, n):
    while n:
        dia += datetime.timedelta(days=1)
        if dia.weekday() < 5:
            n -= 1
    return dia


def carregar():
    return json.loads(ARQ.read_text()) if ARQ.exists() else []


def gravar(lista):
    ARQ.parent.mkdir(exist_ok=True)
    ARQ.write_text(json.dumps(lista, ensure_ascii=False, indent=1))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("acao", choices=["registrar", "atualizar", "listar"])
    ap.add_argument("id", nargs="?")
    ap.add_argument("--solicitante")
    ap.add_argument("--conteudo")
    ap.add_argument("--detalhe", default="")
    ap.add_argument("--status", choices=STATUS)
    ap.add_argument("--nota", default="")
    a = ap.parse_args()
    lista = carregar()
    hoje = datetime.date.today()
    if a.acao == "registrar":
        if not a.solicitante or not a.conteudo:
            sys.exit("Informe --solicitante e --conteudo.")
        nova = {"id": len(lista) + 1, "recebida_em": hoje.isoformat(), "solicitante": a.solicitante,
                "conteudo": a.conteudo, "detalhe": a.detalhe, "status": "recebida",
                "prazo_alvo": somar_dias_uteis(hoje, PRAZO_DIAS_UTEIS).isoformat(), "historico": []}
        lista.append(nova)
        gravar(lista)
        print(f"solicitação {nova['id']} registrada; responder até {nova['prazo_alvo']}")
    elif a.acao == "atualizar":
        s = next((x for x in lista if str(x["id"]) == str(a.id)), None)
        if not s or not a.status:
            sys.exit("Informe um ID existente e --status.")
        s["status"] = a.status
        s["historico"].append({"quando": hoje.isoformat(), "status": a.status, "nota": a.nota})
        gravar(lista)
        print(f"solicitação {s['id']}: {a.status}")
    else:
        for s in lista:
            atraso = s["status"] in ("recebida", "em_analise") and datetime.date.fromisoformat(s["prazo_alvo"]) < hoje
            print(f"#{s['id']} {s['status']:<10} prazo {s['prazo_alvo']}{' ATRASADA' if atraso else ''} | {s['conteudo']} | {s['solicitante']}")
        print(f"{len(lista)} solicitação(ões)")


if __name__ == "__main__":
    main()
