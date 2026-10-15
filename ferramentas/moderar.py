"""Ocultar, restaurar e excluir questões, com registro de quem fez, quando e por quê.

  python3 ferramentas/moderar.py ocultar   --banca unicamp --motivo "..." --por "Nome"
  python3 ferramentas/moderar.py ocultar   --ano 2019 --motivo "..." --por "Nome"
  python3 ferramentas/moderar.py ocultar   --banca fuvest --ano 2020 ...
  python3 ferramentas/moderar.py ocultar   --edicao unicamp-2023-1 ...
  python3 ferramentas/moderar.py ocultar   --questao unicamp-2023-1-q05 ...
  python3 ferramentas/moderar.py restaurar (mesmos seletores)       desfaz uma ocultação
  python3 ferramentas/moderar.py excluir   --questao ID --confirmar ... exclusão DEFINITIVA, separada da ocultação
  python3 ferramentas/moderar.py listar

Ocultar é reversível: a questão continua nos arquivos e some da plataforma (índice e telas).
Excluir move a questão para dados/provas/indisponiveis.json (o banco deixa de gerá-la).
Depois de qualquer mudança, o índice é refeito e a edição é regravada.
"""
import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import conformidade  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent


def seletor(a):
    escolhidos = [(k, v) for k, v in (("edicao", a.edicao), ("questao", a.questao)) if v]
    if a.banca and a.ano:
        escolhidos.append(("banca_ano", f"{a.banca}:{a.ano}"))
    elif a.banca:
        escolhidos.append(("banca", a.banca))
    elif a.ano:
        escolhidos.append(("ano", str(a.ano)))
    if len(escolhidos) != 1:
        sys.exit("Informe exatamente um alvo: --banca, --ano, --banca e --ano, --edicao ou --questao.")
    return escolhidos[0]


def agora():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def refazer(ed_ids):
    for ed in ed_ids:
        subprocess.run([sys.executable, str(RAIZ / "ferramentas/montar_banco.py"), ed], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("acao", choices=["ocultar", "restaurar", "excluir", "listar"])
    ap.add_argument("--banca", choices=sorted(conformidade.BANCAS))
    ap.add_argument("--ano", type=int)
    ap.add_argument("--edicao")
    ap.add_argument("--questao")
    ap.add_argument("--motivo")
    ap.add_argument("--por")
    ap.add_argument("--confirmar", action="store_true")
    a = ap.parse_args()
    mod = conformidade.carregar_moderacao()

    if a.acao == "listar":
        for r in mod["regras"]:
            print(("ATIVA   " if r["ativo"] else "desfeita"), r["escopo"], r["alvo"], "-", r["motivo"], f"({r['por']}, {r['quando']})")
        print(f"{len(mod['log'])} registro(s) no log")
        return
    if not a.motivo or not a.por:
        sys.exit("Informe --motivo e --por: toda mudança fica registrada.")
    escopo, alvo = seletor(a)
    if a.acao == "ocultar":
        if any(r["ativo"] and r["escopo"] == escopo and r["alvo"] == alvo for r in mod["regras"]):
            sys.exit("Já está oculto.")
        mod["regras"].append({"escopo": escopo, "alvo": alvo, "ativo": True, "motivo": a.motivo, "por": a.por, "quando": agora()})
    elif a.acao == "restaurar":
        achadas = [r for r in mod["regras"] if r["ativo"] and r["escopo"] == escopo and r["alvo"] == alvo]
        if not achadas:
            sys.exit("Não há ocultação ativa para esse alvo.")
        for r in achadas:
            r["ativo"] = False
    else:  # excluir
        if escopo != "questao":
            sys.exit("A exclusão definitiva é só por --questao, uma de cada vez.")
        if not a.confirmar:
            sys.exit("Exclusão definitiva: repita com --confirmar. Para esconder de forma reversível, use 'ocultar'.")
        ed_id, _, num = alvo.rpartition("-q")
        arq = RAIZ / "dados/provas/indisponiveis.json"
        ind = json.loads(arq.read_text())
        ind.setdefault(ed_id, {})[str(int(num))] = f"excluída: {a.motivo}"
        arq.write_text(json.dumps(ind, ensure_ascii=False, indent=1))
    mod["log"].append({"quando": agora(), "por": a.por, "acao": a.acao, "escopo": escopo, "alvo": alvo, "motivo": a.motivo})
    conformidade.ARQ_MODERACAO.write_text(json.dumps(mod, ensure_ascii=False, indent=1))
    print(f"{a.acao}: {escopo} {alvo}")
    # regrava o índice (e a edição, no caso de exclusão)
    if a.acao == "excluir":
        refazer([alvo.rpartition("-q")[0]])
    else:
        subprocess.run([sys.executable, str(RAIZ / "ferramentas/montar_banco.py"), "__nenhuma__"], check=True)


if __name__ == "__main__":
    main()
