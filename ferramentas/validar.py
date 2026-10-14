"""Validador automático do banco de questões.

  python3 ferramentas/validar.py                      valida dados/questoes/*.json (banco final)
  python3 ferramentas/validar.py --rascunho ARQ.json  valida um rascunho de transcrição

Erros impedem a publicação; avisos merecem olhar humano. Sai com código 1 se houver erro.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MATERIAS = {
    "portugues", "literatura", "ingles", "historia", "geografia", "filosofia",
    "sociologia", "biologia", "quimica", "fisica", "matematica", "artes",
}
LETRAS = {"unicamp": "ABCD", "fuvest": "ABCDE", "unesp": "ABCDE"}


def edicoes():
    return {e["id"]: e for e in json.loads((RAIZ / "dados/provas/edicoes.json").read_text())}


class Relatorio:
    def __init__(self):
        self.erros, self.avisos = [], []

    def erro(self, ref, msg):
        self.erros.append(f"ERRO  {ref}: {msg}")

    def aviso(self, ref, msg):
        self.avisos.append(f"aviso {ref}: {msg}")


def textos_da_questao(q):
    """(rótulo, texto) de todos os campos de texto de uma questão."""
    yield "enunciado", q.get("enunciado") or ""
    for letra, t in (q.get("alternativas") or {}).items():
        yield f"alternativa {letra}", t
    for item in q.get("itens") or []:
        yield f"item {item.get('rotulo')}", item.get("texto") or ""
        if item.get("resposta_oficial"):
            yield f"resposta {item.get('rotulo')}", item["resposta_oficial"]
    if q.get("resposta_oficial"):
        yield "resposta oficial", q["resposta_oficial"]


def checar_texto(rel, ref, t):
    if not isinstance(t, str):
        rel.erro(ref, "texto não é string")
        return
    # "R$ 5,00" sem barra abre fórmula por engano; "$R$" (variável R) é legítimo
    if re.search(r"(?<![\\$\w{])R\$(?=\s?\d)", t):
        rel.erro(ref, 'cifrão de "R$" sem barra (use R\\$)')
    if re.search(r"[a-zà-ú]-\n[a-zà-ú]", t):
        rel.aviso(ref, "possível hifenização de fim de linha não desfeita")
    if re.search(r"Confidencial até|Rascunho|RASCUNHO", t):
        rel.erro(ref, "sobrou cabeçalho/rodapé do caderno")
    if "�" in t or "" in t or "" in t:
        rel.erro(ref, "caractere inválido (símbolo perdido na extração)")
    if re.search(r"(?<![\\$])\$\s+\$(?!\$)", t):
        rel.aviso(ref, "fórmula vazia")


def checar_render(rel, itens):
    """Roda o renderizador real (app/render.js + KaTeX) em todos os textos."""
    r = subprocess.run(
        ["node", str(RAIZ / "ferramentas/checar_render.js")],
        input=json.dumps(itens), capture_output=True, text=True, check=True,
    )
    saida = json.loads(r.stdout)
    for e in saida["erros"]:
        rel.erro(e["ref"], "não renderiza: " + e["erro"])
    return saida["figuras"]


def checar_questoes(rel, dados, ed, final):
    vest = ed["vestibular"]
    tipo = ed["tipo"]
    textos_base = dados.get("textos_base") or {}
    numeros = set()
    usados = set()
    para_render = []
    for tb_id, tb in textos_base.items():
        ref = f"{ed['id']} texto {tb_id}"
        checar_texto(rel, ref, tb)
        para_render.append({"ref": ref, "texto": tb})
    for q in dados.get("questoes", []):
        n = q.get("numero")
        ref = f"{ed['id']} q{n}"
        if not isinstance(n, int) or not 1 <= n <= ed.get("questoes", 999):
            rel.erro(ref, "número de questão inválido")
        if n in numeros:
            rel.erro(ref, "questão repetida")
        numeros.add(n)
        if q.get("materia") not in MATERIAS:
            rel.erro(ref, f"matéria inválida: {q.get('materia')!r}")
        for m in q.get("materias_extra") or []:
            if m not in MATERIAS or m == q.get("materia"):
                rel.erro(ref, f"matéria extra inválida: {m!r}")
        tb = q.get("texto_base")
        if tb is not None:
            if tb not in textos_base:
                rel.erro(ref, f"texto base {tb!r} não existe")
            usados.add(tb)
        if not (q.get("enunciado") or "").strip() and tb is None:
            rel.erro(ref, "sem enunciado")
        if tipo == "objetiva":
            alts = q.get("alternativas") or {}
            if "".join(sorted(alts)) != LETRAS[vest]:
                rel.erro(ref, f"alternativas {''.join(sorted(alts))} (esperado {LETRAS[vest]})")
            for letra, t in alts.items():
                if not str(t).strip():
                    rel.erro(ref, f"alternativa {letra} vazia")
                elif re.match(r"^\s*\(?[A-Ea-e][\).]\s", str(t)):
                    rel.erro(ref, f"alternativa {letra} começa com a letra")
            valores = [re.sub(r"\s+", " ", str(t)).strip() for t in alts.values()]
            if len(set(valores)) != len(valores):
                rel.aviso(ref, "alternativas repetidas")
            if final:
                g = q.get("gabarito")
                if q.get("anulada"):
                    if g not in (None, "*"):
                        rel.erro(ref, "questão anulada com gabarito")
                elif g not in alts:
                    rel.erro(ref, f"gabarito {g!r} fora das alternativas")
        else:
            if "itens" not in q:
                rel.erro(ref, "discursiva sem campo itens")
        if q.get("observacoes"):
            rel.aviso(ref, "observação do transcritor: " + q["observacoes"][:200])
        for rotulo, t in textos_da_questao(q):
            checar_texto(rel, f"{ref} {rotulo}", t)
            para_render.append({"ref": f"{ref} {rotulo}", "texto": t})
    for tb_id in textos_base:
        if tb_id not in usados:
            rel.aviso(f"{ed['id']} texto {tb_id}", "texto base não usado por nenhuma questão")
    figuras = checar_render(rel, para_render)
    pasta = (RAIZ / "img/questoes" / ed["id"]) if final else (RAIZ / "trabalho" / ed["id"] / "figuras")
    for f in figuras:
        if not (pasta / f"{f['id']}.webp").exists():
            rel.erro(f["ref"], f"figura {f['id']} não encontrada em {pasta.relative_to(RAIZ)}")
    return numeros


def main():
    eds = edicoes()
    rel = Relatorio()
    if len(sys.argv) > 2 and sys.argv[1] == "--rascunho":
        for arq in sys.argv[2:]:
            dados = json.loads(Path(arq).read_text())
            ed = eds.get(dados.get("edicao"))
            if not ed:
                rel.erro(arq, f"edição desconhecida: {dados.get('edicao')!r}")
                continue
            checar_questoes(rel, dados, ed, final=False)
    else:
        for arq in sorted((RAIZ / "dados/questoes").glob("*.json")):
            dados = json.loads(arq.read_text())
            ed = eds[dados["edicao"]["id"]]
            numeros = checar_questoes(rel, dados, ed, final=True)
            faltam = sorted(set(range(1, ed["questoes"] + 1)) - numeros)
            if faltam and ed["tipo"] == "objetiva":
                rel.erro(ed["id"], f"faltam as questões {faltam}")
    for linha in rel.erros + rel.avisos:
        print(linha)
    print(f"\n{len(rel.erros)} erro(s), {len(rel.avisos)} aviso(s)")
    sys.exit(1 if rel.erros else 0)


if __name__ == "__main__":
    main()
