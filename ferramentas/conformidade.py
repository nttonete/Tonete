"""Conformidade jurídica: citação da fonte, conteúdo de terceiros e ocultação de questões.

Usado por montar_banco.py (grava a citação em cada edição e calcula o que fica oculto no
índice) e por validar.py (recusa edição sem citação). Também é um comando:

  python3 ferramentas/conformidade.py levantar     cria/atualiza dados/provas/terceiros.json
  python3 ferramentas/conformidade.py relatorio    mostra o estado (citações, terceiros, ocultas)

Os textos legais e as decisões estão em ferramentas/CONFORMIDADE.md.
"""
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ARQ_TERCEIROS = RAIZ / "dados/provas/terceiros.json"
ARQ_MODERACAO = RAIZ / "dados/provas/moderacao.json"

# Citação exigida por cada banca e página oficial para consulta (o link direto para o PDF de cada
# edição fica em "url_pdf" de edicoes.json quando for confirmado; até lá, o site da banca).
BANCAS = {
    "fuvest": {"site": "https://www.fuvest.br", "nome": "Fuvest"},
    "unicamp": {"site": "https://www.comvest.unicamp.br", "nome": "Comvest/Vestibular Unicamp"},
    "unesp": {"site": "https://www.vunesp.com.br", "nome": "Vunesp/Unesp"},
}
STATUS = ("dominio_publico", "citacao_com_autoria", "pendente")
TIPOS = ("texto", "foto", "charge", "tirinha", "gráfico", "pintura", "outro")


def citacao(vestibular, ano, fase):
    """Formato pedido por cada banca: Comvest não leva a fase."""
    if vestibular == "unicamp":
        return f"Comvest/Vestibular Unicamp {ano}"
    if vestibular == "fuvest":
        return f"Fuvest {ano} – {fase}ª fase"
    if vestibular == "unesp":
        return f"Vunesp/Unesp {ano} – {fase}ª fase"
    raise ValueError(f"vestibular desconhecido: {vestibular}")


def link_oficial(vestibular):
    return BANCAS[vestibular]["site"]


# ---------- conteúdo de terceiros ----------
def carregar_terceiros():
    if ARQ_TERCEIROS.exists():
        return json.loads(ARQ_TERCEIROS.read_text())
    return {"config": {"bloquear_pendentes": False}, "itens": {}}


def atribuicoes(terceiros, qid):
    """Itens já conferidos (com autor e obra), que a plataforma mostra junto da questão."""
    saida = []
    for it in terceiros.get("itens", {}).get(qid, []):
        if it.get("status") in ("dominio_publico", "citacao_com_autoria") and it.get("autor"):
            saida.append({k: it.get(k) for k in ("tipo", "autor", "obra", "ano_morte", "status") if it.get(k) is not None})
    return saida


def tem_pendente(terceiros, qid):
    return any(it.get("status") == "pendente" for it in terceiros.get("itens", {}).get(qid, []))


# ---------- moderação ----------
def carregar_moderacao():
    if ARQ_MODERACAO.exists():
        return json.loads(ARQ_MODERACAO.read_text())
    return {"regras": [], "log": []}


def regra_vale(regra, ed, qid):
    if not regra.get("ativo"):
        return False
    esc, alvo = regra["escopo"], str(regra["alvo"])
    if esc == "banca":
        return ed["vestibular"] == alvo
    if esc == "ano":
        return str(ed["ano"]) == alvo
    if esc == "banca_ano":
        return f"{ed['vestibular']}:{ed['ano']}" == alvo
    if esc == "edicao":
        return ed["id"] == alvo
    if esc == "questao":
        return qid == alvo
    return False


def ocultas_da_edicao(dados, moderacao, terceiros):
    """Números das questões que não devem aparecer: regra de ocultação ou, quando o bloqueio
    está ligado, conteúdo de terceiros pendente de revisão."""
    ed = dados["edicao"]
    bloquear = terceiros.get("config", {}).get("bloquear_pendentes", False)
    saida = []
    for q in dados["questoes"]:
        if any(regra_vale(r, ed, q["id"]) for r in moderacao["regras"]) or (bloquear and tem_pendente(terceiros, q["id"])):
            saida.append(q["numero"])
    return saida


# ---------- levantamento automático ----------
def tipo_da_figura(alt):
    a = alt.lower()
    regras = [
        ("charge", "charge", "alto"), ("tirinha", "tirinha", "alto"), ("tira ", "tirinha", "alto"),
        ("pintura", "pintura", "alto"), ("quadro", "pintura", "alto"), ("gravura", "pintura", "alto"),
        ("escultura", "pintura", "alto"), ("fotografia", "foto", "alto"), ("foto ", "foto", "alto"),
        ("cartaz", "outro", "alto"), ("propaganda", "outro", "alto"), ("anúncio", "outro", "alto"),
        ("capa ", "outro", "alto"), ("ilustração", "outro", "alto"), ("desenho", "outro", "alto"),
        ("gráfico", "gráfico", "baixo"), ("mapa", "gráfico", "baixo"), ("esquema", "gráfico", "baixo"),
        ("tabela", "gráfico", "baixo"), ("diagrama", "gráfico", "baixo"), ("fluxograma", "gráfico", "baixo"),
        ("circuito", "gráfico", "baixo"), ("heredograma", "gráfico", "baixo"), ("árvore", "gráfico", "baixo"),
    ]
    for chave, tipo, risco in regras:
        if chave in a:
            return tipo, risco
    return "outro", "médio"


FIG = re.compile(r"!\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(fig:([A-Za-z0-9_-]+)\)")
FONTE_NO_TEXTO = re.compile(r"Dispon[ií]vel em|Acesso em|Fonte:|Adaptado de|Adaptada de")


def itens_automaticos(dados, q):
    itens = []
    textos = [q["enunciado"], json.dumps(q.get("alternativas", ""), ensure_ascii=False)]
    base = q.get("texto_base")
    if base and base in dados.get("textos_base", {}):
        textos.append(dados["textos_base"][base])
        itens.append({"ref": f"texto_base:{base}", "tipo": "texto", "risco": _risco_texto(q)})
        for alt, fid in FIG.findall(dados["textos_base"][base]):
            t, r = tipo_da_figura(alt)
            itens.append({"ref": f"fig:{fid}", "tipo": t, "risco": r})
    elif FONTE_NO_TEXTO.search(q["enunciado"]):
        itens.append({"ref": "enunciado", "tipo": "texto", "risco": _risco_texto(q)})
    for t in textos[:1] + textos[2:]:
        for alt, fid in FIG.findall(t):
            tipo, risco = tipo_da_figura(alt)
            if not any(i["ref"] == f"fig:{fid}" for i in itens):
                itens.append({"ref": f"fig:{fid}", "tipo": tipo, "risco": risco})
    return itens


def _risco_texto(q):
    return "alto" if q["materia"] in ("portugues", "literatura", "ingles", "artes") else "médio"


def levantar():
    """Cria os registros que faltam (status pendente) sem apagar nada que alguém já preencheu."""
    terceiros = carregar_terceiros()
    itens = terceiros.setdefault("itens", {})
    novos = 0
    for arq in sorted((RAIZ / "dados/questoes").glob("*.json")):
        dados = json.loads(arq.read_text())
        for q in dados["questoes"]:
            existentes = {i["ref"]: i for i in itens.get(q["id"], [])}
            lista = []
            for auto in itens_automaticos(dados, q):
                if auto["ref"] in existentes:
                    lista.append(existentes.pop(auto["ref"]))
                else:
                    novos += 1
                    lista.append({**auto, "autor": None, "obra": None, "ano_morte": None,
                                  "status": "pendente", "origem": "levantamento automático"})
            lista += [i for i in existentes.values() if i.get("origem") != "levantamento automático"]
            if lista:
                itens[q["id"]] = lista
            else:
                itens.pop(q["id"], None)
    ARQ_TERCEIROS.write_text(json.dumps(terceiros, ensure_ascii=False, indent=1))
    print(f"terceiros.json: {sum(len(v) for v in itens.values())} itens em {len(itens)} questões ({novos} novos)")


def relatorio():
    terceiros = carregar_terceiros()
    moderacao = carregar_moderacao()
    por_status, por_risco, por_tipo = {}, {}, {}
    for lista in terceiros["itens"].values():
        for it in lista:
            por_status[it["status"]] = por_status.get(it["status"], 0) + 1
            if it["status"] == "pendente":
                por_risco[it.get("risco", "?")] = por_risco.get(it.get("risco", "?"), 0) + 1
                por_tipo[it["tipo"]] = por_tipo.get(it["tipo"], 0) + 1
    print("Conteúdo de terceiros:", por_status)
    print("  pendentes por risco:", por_risco)
    print("  pendentes por tipo:", por_tipo)
    print("  bloqueio de pendentes ligado:", terceiros["config"].get("bloquear_pendentes"))
    ativas = [r for r in moderacao["regras"] if r.get("ativo")]
    print(f"Ocultação: {len(ativas)} regra(s) ativa(s), {len(moderacao['log'])} registro(s) no log")
    sem = 0
    for arq in sorted((RAIZ / "dados/questoes").glob("*.json")):
        ed = json.loads(arq.read_text())["edicao"]
        if ed.get("citacao") != citacao(ed["vestibular"], ed["ano"], ed["fase"]):
            sem += 1
    print(f"Edições sem a citação correta: {sem}")
    priv = RAIZ / "privado/solicitacoes.json"
    if priv.exists():
        sol = json.loads(priv.read_text())
        abertas = [s for s in sol if s["status"] not in ("atendida", "recusada")]
        print(f"Solicitações de remoção: {len(sol)} ({len(abertas)} abertas)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "relatorio"
    {"levantar": levantar, "relatorio": relatorio}[cmd]()
