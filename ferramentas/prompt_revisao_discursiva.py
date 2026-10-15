"""Gera o pedido de revisão de um lote de discursivas.

Junta ao pedido as notas específicas da edição registradas em
ferramentas/ORQUESTRACAO.md (linhas que começam com "- <edicao>").

Uso: python3 ferramentas/prompt_revisao_discursiva.py <edicao> <de> <ate>
"""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def prompt(ed_id, a, b):
    ed = next(e for e in json.loads((RAIZ / "dados/provas/edicoes.json").read_text()) if e["id"] == ed_id)
    fora = json.loads((RAIZ / "dados/provas/indisponiveis.json").read_text()).get(ed_id, {})
    rep = ed.get("repetidas") or {}
    pular = sorted({int(n) for n in list(fora) + list(rep) if a <= int(n) <= b})
    notas = [l[2:] for l in (RAIZ / "ferramentas/ORQUESTRACAO.md").read_text().splitlines()
             if l.startswith(f"- {ed_id}") or (ed["vestibular"] == "unicamp" and l.startswith("- Unicamp 2018–2021") and ed["ano"] <= 2021)]
    lote = f"{a:03d}-{b:03d}"
    extra = ""
    if pular:
        extra += f"\nNão cubra as questões {', '.join(map(str, pular))} (repetidas de outro caderno ou fora por direito autoral)."
    if ed["vestibular"] == "unicamp":
        extra += ("\nO `respostas.pdf` traz, depois das respostas esperadas, a prova comentada oficial: use-a para conferir trechos duvidosos e a matéria. "
                  "Garanta que cada questão tenha o \"**Objetivo da questão:**\" da prova comentada em `resposta` (só o objetivo, frases inteiras, sem itens do programa nem desempenho) e que não haja pontuação \"(2 pontos)\" que não esteja nas respostas esperadas; corrija em `respostas_corrigidas`.")
    if notas:
        extra += "\nPedidos específicos para esta edição:\n" + "\n".join("- " + n for n in notas)
    return f"""Revise a edição `{ed_id}` (discursiva: {ed['vestibular'].upper()} {ed['ano']}, 2ª fase, {ed.get('caderno', '')}), questões {a} a {b}, seguindo a seção "Discursivas (2ª fase)" das suas instruções e as regras de ferramentas/INSTRUCOES-TRANSCRICAO.md (leia-as). Grave trabalho/{ed_id}/revisao-{lote}.json com "intervalo": [{a}, {b}].{extra}
Descrições de figura não podem entregar o que o item pede nem omitir o que ele manda analisar. Leia as `observacoes` do transcritor e decida cada uma. Não faça commits. Responda em português, com um resumo curto."""


if __name__ == "__main__":
    print(prompt(sys.argv[1], int(sys.argv[2]), int(sys.argv[3])))
