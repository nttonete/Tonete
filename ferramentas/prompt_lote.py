"""Gera o pedido de transcrição de um lote para um agente."""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
NOTAS = {
    "fuvest": 'Na FUVEST o número da questão aparece em negrito e sozinho no alto do bloco (ex.: "21"); textos compartilhados vêm com "TEXTO PARA AS QUESTÕES 10 E 11". 5 alternativas (A–E).',
    "unesp": 'Na UNESP as questões são marcadas por "QUESTÃO 01" numa faixa colorida; textos compartilhados vêm com "Leia o texto para responder às questões..." ou "Para responder às questões de 01 a 07, leia...". Atenção à numeração de parágrafos/linhas na margem. 5 alternativas (A–E).',
    "unicamp": 'Na Unicamp as questões são marcadas por "QUESTÃO 13" (ou só o número); textos compartilhados vêm como "Texto comum às questões 13 e 14". 4 alternativas (a–d no caderno; grave como A–D).',
}


def prompt(ed_id, a, b):
    ed = next(e for e in json.loads((RAIZ / "dados/provas/edicoes.json").read_text()) if e["id"] == ed_id)
    lote = f"{a:03d}-{b:03d}"
    arq = f"trabalho/{ed_id}/rascunho-{lote}.json"
    return f"""Você vai transcrever questões de vestibular para um banco de questões que será vendido a estudantes. Fidelidade ao original é essencial.

Diretório do projeto: /home/user/Tonete (branch `vestibular`). Leia primeiro, inteiro, o arquivo /home/user/Tonete/ferramentas/INSTRUCOES-TRANSCRICAO.md e siga-o à risca.

Tarefa: edição `{ed_id}` ({ed['vestibular'].upper()} {ed['ano']}, 1ª fase, prova {ed['versao']}), questões {a} a {b}.
Material: /home/user/Tonete/trabalho/{ed_id}/
Grave o resultado em: /home/user/Tonete/{arq}
Arquivos temporários: só em /home/user/Tonete/trabalho/{ed_id}/tmp-{lote}/

{NOTAS[ed['vestibular']]}

Confira cada página na imagem (paginas/pNN.png), não confie só no texto extraído. Ao terminar, rode `python3 ferramentas/validar.py --rascunho {arq}` (a partir de /home/user/Tonete) e corrija até não haver erros. Não altere nenhum arquivo fora de trabalho/{ed_id}/ (exceto criar figuras com a ferramenta de recorte). Não faça commits.

Responda com um resumo curto (até 10 linhas): quantas questões gravou, recortes refeitos e dúvidas que ficaram."""


if __name__ == "__main__":
    print(prompt(sys.argv[1], int(sys.argv[2]), int(sys.argv[3])))
