"""Junta os rascunhos de transcrição com o gabarito oficial e gera o banco final.

Para cada edição com rascunhos em trabalho/<edicao>/rascunho-*.json:
  - junta os lotes (textos base com o mesmo id precisam ser idênticos);
  - acrescenta o gabarito oficial da versão do caderno (anuladas ficam marcadas);
  - copia só as figuras usadas para img/questoes/<edicao>/;
  - grava dados/questoes/<edicao>.json.
Depois gera dados/indice.json, que a plataforma lê ao abrir.

Uso: python3 ferramentas/montar_banco.py [edicao ...]   (sem argumentos: todas)
"""
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gabaritos import ler_gabarito  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
NOMES = {"fuvest": "FUVEST (USP)", "unicamp": "Unicamp", "unesp": "UNESP (VUNESP)"}
FIG = re.compile(r"\(fig:([A-Za-z0-9_-]+)\)")


def gabarito_oficial(ed):
    transcritos = json.loads((RAIZ / "dados/provas/gabaritos-transcritos.json").read_text())
    if ed["id"] in transcritos:
        versoes = transcritos[ed["id"]]
    elif ed.get("gabarito"):
        versoes = ler_gabarito(str(RAIZ / ed["gabarito"]))
    else:
        return None
    g = versoes.get(ed["versao"])
    if g is None:
        raise SystemExit(f"{ed['id']}: versão {ed['versao']} não está no gabarito ({list(versoes)})")
    return {int(k): v for k, v in g.items()}


def respostas_discursivas(ed):
    arq = RAIZ / "dados/provas/respostas" / f"{ed['id']}.json"
    return json.loads(arq.read_text()) if arq.exists() else {}


def montar(ed):
    pasta = RAIZ / "trabalho" / ed["id"]
    rascunhos = sorted(pasta.glob("rascunho-*.json"))
    if not rascunhos:
        return None
    textos_base, questoes = {}, {}
    for arq in rascunhos:
        dados = json.loads(arq.read_text())
        for tb_id, tb in (dados.get("textos_base") or {}).items():
            if tb_id in textos_base and textos_base[tb_id] != tb:
                raise SystemExit(f"{arq.name}: texto base {tb_id} difere de outro lote")
            textos_base[tb_id] = tb
        for q in dados["questoes"]:
            if q["numero"] in questoes:
                raise SystemExit(f"{arq.name}: questão {q['numero']} aparece em dois lotes")
            questoes[q["numero"]] = q

    # correções do agente revisor substituem a transcrição; o relatório dá o status
    status = {}
    for arq in sorted(pasta.glob("revisao-*.json")):
        rev = json.loads(arq.read_text())
        for tb_id, tb in (rev.get("textos_base") or {}).items():
            textos_base[tb_id] = tb
        for q in rev.get("questoes_corrigidas", []):
            if q["numero"] not in questoes:
                raise SystemExit(f"{arq.name}: correção da questão {q['numero']}, que não foi transcrita")
            questoes[q["numero"]] = q
        for r in rev.get("relatorio", []):
            status[r["numero"]] = {"status": r["status"], "notas": r.get("notas", "")}

    gab = gabarito_oficial(ed) if ed["tipo"] == "objetiva" else None
    respostas = respostas_discursivas(ed) if ed["tipo"] == "discursiva" else {}
    saida = []
    for n in sorted(questoes):
        q = dict(questoes[n])
        q.pop("observacoes", None)
        item = {"id": f"{ed['id']}-q{n:02d}"}
        item.update(q)
        if ed["tipo"] == "objetiva":
            letra = gab.get(n) if gab else None
            item["anulada"] = letra == "*"
            item["gabarito"] = None if letra in (None, "*") else letra
        else:
            r = respostas.get(str(n)) or {}
            item["resposta_oficial"] = r.get("resposta")
            for it in item.get("itens", []):
                it["resposta_oficial"] = (r.get("itens") or {}).get(it["rotulo"])
        rev = status.get(n)
        item["revisao"] = rev["status"] if rev else "transcrita"
        if rev and rev["status"] == "atencao":
            item["revisao_notas"] = rev["notas"]
        saida.append(item)

    # figuras: só as usadas
    destino = RAIZ / "img/questoes" / ed["id"]
    if destino.exists():
        shutil.rmtree(destino)
    destino.mkdir(parents=True)
    usadas = set(FIG.findall(json.dumps([textos_base, saida], ensure_ascii=False)))
    for fig_id in usadas:
        origem = pasta / "figuras" / f"{fig_id}.webp"
        if origem.exists():
            shutil.copy2(origem, destino / origem.name)

    meta = {k: ed[k] for k in ("id", "vestibular", "ano", "fase", "tipo", "versao")}
    meta["nome"] = f"{NOMES[ed['vestibular']]} {ed['ano']} – {ed['fase']}ª fase"
    meta["fonte"] = {
        "caderno": Path(ed["pdf"]).name,
        "gabarito": Path(ed["gabarito"]).name if ed.get("gabarito") else None,
    }
    final = {"edicao": meta, "textos_base": textos_base, "questoes": saida}
    (RAIZ / "dados/questoes" / f"{ed['id']}.json").write_text(json.dumps(final, ensure_ascii=False, indent=1))
    return final


def indice():
    edicoes = []
    for arq in sorted((RAIZ / "dados/questoes").glob("*.json")):
        d = json.loads(arq.read_text())
        materias = {}
        for q in d["questoes"]:
            materias[q["materia"]] = materias.get(q["materia"], 0) + 1
        validas = [q for q in d["questoes"] if not q.get("anulada")]
        edicoes.append({
            **d["edicao"],
            "arquivo": f"dados/questoes/{arq.name}",
            "total": len(d["questoes"]),
            "validas": len(validas),
            "com_resposta": sum(1 for q in validas if q.get("gabarito") or q.get("resposta_oficial")
                                or any(i.get("resposta_oficial") for i in q.get("itens", []))),
            "materias": materias,
        })
    edicoes.sort(key=lambda e: (e["vestibular"], e["fase"], e["ano"]))
    (RAIZ / "dados/indice.json").write_text(json.dumps({"edicoes": edicoes}, ensure_ascii=False, indent=1))
    print(f"índice: {len(edicoes)} edições, {sum(e['total'] for e in edicoes)} questões")


def main():
    eds = json.loads((RAIZ / "dados/provas/edicoes.json").read_text())
    alvo = set(sys.argv[1:])
    for ed in eds:
        if alvo and ed["id"] not in alvo:
            continue
        r = montar(ed)
        if r:
            print(f"{ed['id']}: {len(r['questoes'])} questões")
    indice()


if __name__ == "__main__":
    main()
