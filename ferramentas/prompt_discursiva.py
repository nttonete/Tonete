"""Gera o pedido de transcrição de um lote de discursivas (enunciados + respostas oficiais).

Uso: python3 ferramentas/prompt_discursiva.py <edicao> <de> <ate>
"""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
NOTAS = {
    "fuvest": "Na FUVEST cada questão tem um código impresso (M01, F03, B06...) ou, no 1º dia, só o número. As respostas estão nas \"Abordagens esperadas\"/\"Guia de respostas\"; até 2025 o mesmo documento cobre os dois dias da prova: ache a parte do seu caderno.",
    "unicamp": "Na Unicamp cada questão começa numa página nova, com o número seguido de ponto (\"4.\"). As respostas estão nas \"Respostas esperadas\", com o título \"QUESTÃO 4\".",
}


def prompt(ed_id, a, b):
    ed = next(e for e in json.loads((RAIZ / "dados/provas/edicoes.json").read_text()) if e["id"] == ed_id)
    lote = f"{a:03d}-{b:03d}"
    arq = f"trabalho/{ed_id}/rascunho-{lote}.json"
    repetidas = {int(k): v for k, v in (ed.get("repetidas") or {}).items() if a <= int(k) <= b}
    numeros = [n for n in range(a, b + 1) if n not in repetidas]
    extra = ""
    if repetidas:
        extra += ("\nQuestões repetidas de outro caderno, que NÃO entram neste lote (já foram transcritas lá): "
                  + ", ".join(f"{n} (= {v})" for n, v in sorted(repetidas.items())) + ".")
    if ed.get("codigos"):
        extra += ("\nCódigos das questões na ordem do caderno (o `numero` é a posição; grave também `codigo`): "
                  + ", ".join(f"{i}={c}" for i, c in enumerate(ed["codigos"], 1) if a <= i <= b) + ".")
    return f"""Você vai transcrever questões discursivas de vestibular, com a resposta esperada publicada pela banca, para um banco de questões que será vendido a estudantes. Fidelidade ao original é essencial.

Diretório do projeto: /home/user/Tonete (branch `vestibular`). Leia primeiro, inteiro, o arquivo /home/user/Tonete/ferramentas/INSTRUCOES-TRANSCRICAO.md (inclusive a seção "Discursivas (2ª fase)") e siga-o à risca.

Tarefa: edição `{ed_id}` ({ed['vestibular'].upper()} {ed['ano']}, 2ª fase, {ed.get('caderno', '')}), questões {', '.join(map(str, numeros))}.{extra}
Material: /home/user/Tonete/trabalho/{ed_id}/ (caderno em paginas/pNN.png e texto.md; respostas oficiais em respostas/rNN.png e respostas.md)
Grave o resultado em: /home/user/Tonete/{arq} (com "intervalo": [{a}, {b}])
Arquivos temporários: só em /home/user/Tonete/trabalho/{ed_id}/tmp-{lote}/

{NOTAS[ed['vestibular']]}

Se algum texto do caderno for letra de canção ou trecho literário longo que você não consiga reproduzir, pule só essa questão e explique no resumo.

Confira cada página na imagem, não confie só no texto extraído; isso vale em dobro para as respostas, que têm muitas fórmulas. Grave o arquivo aos poucos (depois de cada duas ou três questões), para não perder trabalho se for interrompido. Ao terminar, rode `python3 ferramentas/validar.py --rascunho {arq}` (a partir de /home/user/Tonete) e corrija até não haver erros. Não altere nenhum arquivo fora de trabalho/{ed_id}/ (exceto criar figuras com a ferramenta de recorte). Não faça commits.

Responda com um resumo curto (até 10 linhas): quantas questões gravou, quantas respostas oficiais, recortes refeitos e dúvidas que ficaram."""


if __name__ == "__main__":
    print(prompt(sys.argv[1], int(sys.argv[2]), int(sys.argv[3])))
