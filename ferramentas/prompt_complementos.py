"""Gera o pedido de complementos (assunto + resolução comentada) para um lote já revisado."""
import sys

ed, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
lote = f"{a:03d}-{b:03d}"
print(f"""Você vai escrever o assunto e a resolução comentada de questões de vestibular que já foram transcritas e revisadas. Estudantes pagantes vão ler essas resoluções depois de errar a questão: elas precisam estar certas e ser claras.

Trabalhe a partir de /home/user/Tonete. Leia a seção "Assunto e resolução comentada" de /home/user/Tonete/.claude/agents/revisor-questoes.md e siga as regras dela. O formato de texto (markdown simplificado + LaTeX) está em ferramentas/INSTRUCOES-TRANSCRICAO.md.

Tarefa: edição `{ed}`, questões {a} a {b}.

1. Leia as questões com `python3 ferramentas/ver_questoes.py {ed} {a} {b}` (mostra tudo menos o gabarito). Figuras citadas como `fig:pNN-xK` estão em `img/questoes/{ed}/pNN-xK.webp`; abra as que a questão exige. Não leia dados/questoes/{ed}.json diretamente.
2. Resolva cada questão você mesmo e grave suas respostas em `trabalho/{ed}/tmp-comp-{lote}/respostas.json` ({{"{a}": "B", ...}}).
3. Rode `python3 ferramentas/comparar_gabarito.py {ed} trabalho/{ed}/tmp-comp-{lote}/respostas.json`. Onde você divergir, refaça com cuidado. A resolução sempre explica e conclui o gabarito oficial. Se você continuar sem se convencer do gabarito oficial, explique a resposta oficial e registre a polêmica numa linha `**Observação:**`, e cite a questão no seu resumo.
4. Grave `trabalho/{ed}/complementos-{lote}.json` com {{"edicao": "{ed}", "intervalo": [{a}, {b}], "complementos": {{"{a}": {{"assunto": "...", "resolucao": "..."}}, ...}}}}, uma entrada por questão.
5. Rode `python3 ferramentas/validar.py --complementos {ed} trabalho/{ed}/complementos-{lote}.json` e corrija até não haver erros.

Arquivos temporários só em trabalho/{ed}/tmp-comp-{lote}/. Não altere mais nada. Não faça commits.
Responda com um resumo curto (até 8 linhas): quantas questões, em quantas você divergiu do gabarito de início e quais ficaram com observação de polêmica.""")
