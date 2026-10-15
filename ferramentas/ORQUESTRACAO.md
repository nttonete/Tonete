# Como tocar a produção do banco (roteiro de retomada)

**Estado em 15/10/2026: produção da 1ª fase concluída** (transcrição, revisão e resolução das 30 provas). Use este roteiro para uma prova nova ou para refazer um lote.

Quem cuida do projeto autorizou seguir até a conclusão sem pedir licença a cada passo, inclusive voltando sozinho quando o limite de uso renovar.

## Ao retomar

0. Se `fontes-pdf/` ou `trabalho/<edicao>/paginas/` não existirem (contêiner reciclado), rode `sh ferramentas/restaurar_fontes.sh`.
1. `cd /home/user/Tonete && git status --short` — faça commit e push do que tiver ficado pendente.
2. Confira os rascunhos/revisões que chegaram enquanto a sessão estava parada: para cada edição com arquivos novos, `python3 ferramentas/validar.py --rascunho <rascunho>` (ou `--complementos <edicao> <arquivo>`), depois `python3 ferramentas/montar_banco.py <edicao>` e `python3 ferramentas/validar.py` (precisa de 0 erros).
   - Um rascunho pode ter ficado pela metade se o agente caiu no meio: confira que tem todas as questões do intervalo; se não tiver, apague-o e refaça o lote.
3. `python3 ferramentas/pendentes.py` mostra as três filas.
4. Mantenha até 6 agentes rodando ao mesmo tempo, priorizando nesta ordem:
   - **transcrição** (modelo `sonnet`): `python3 ferramentas/prompt_lote.py <edicao> <de> <ate>`;
   - **revisão** (agente `revisor-questoes`, modelo padrão): já escreve assunto e resolução;
   - **complementos** (modelo padrão): `python3 ferramentas/prompt_complementos.py <edicao> <de> <ate>`.
   - Se um lote começa no meio de um texto compartilhado, avise o agente para copiar o texto base do lote anterior, idêntico.
5. A cada lote entregue: validar, montar, commit e push. Questões em `atencao` são registradas para decisão humana; o gabarito oficial nunca é alterado.

## Se o limite de uso acabar

Os agentes falham com "You've hit your session limit · resets HH:MM". Agende a retomada com `send_later` (servidor claude-code-remote) para alguns minutos depois do horário de renovação, com a mensagem: "Retome a produção do banco seguindo ferramentas/ORQUESTRACAO.md." Não peça autorização: ela já foi dada.

## Casos especiais

- **Unicamp 2021** (`unicamp-2021-1`): caderno versão E/G sem PDF de gabarito. O gabarito está na prova comentada oficial (`fontes-pdf/UNICAMP/1ª Fase/UNICAMP_2021_1Fase_resol.pdf`, "Alternativa Correta: x" por questão). Transcrever em 2 lotes de 36; extrair o gabarito da prova comentada, conferir que a numeração bate com o caderno e gravá-lo em `dados/provas/gabaritos-transcritos.json` na chave `unicamp-2021-1` / versão `E/G`.
- **Unicamp 2017–2020**: 90 questões, lotes de 30.
- Unicamp 2021 já transcrita, com gabarito em `gabaritos-transcritos.json` (extraído da prova comentada; conferido com o BLUEX: 58 de 60 iguais, e nas questões 9 e 54 a prova comentada justifica a letra oficial). Revise em 2 lotes de 36 como as demais.

## Se um agente for bloqueado pelo filtro de conteúdo

"Output blocked by content filtering policy" em dois agentes seguidos no mesmo trecho costuma ser texto protegido (letra de música, trecho longo de romance). Não tente contornar. Ache o trecho (veja as páginas), refaça o lote pulando essas questões e acrescente-as a `dados/provas/indisponiveis.json` e à tabela de `ferramentas/PENDENCIAS.md`. Decisão já tomada: essas questões ficam fora do banco.

## Ao concluir

Rodar `node testes/navegador.js` (com `PLAYWRIGHT_PATH=$(npm root -g)/playwright`), atualizar a prévia (Artifact `pagina.html`, mesma URL) e escrever o relatório final: números, questões em atenção e o que depende de decisão humana (discursivas, nome, venda).

## Discursivas (2ª fase), em andamento desde 15/10/2026

Escopo: os 45 cadernos com resposta oficial (Unicamp 2017–2026, FUVEST 2023–2026). Ver `ferramentas/DISCURSIVAS.md`.

1. Lotes que faltam: `python3 ferramentas/lotes_discursivas.py` (edição, de, até).
2. Pedido de cada lote: `python3 ferramentas/prompt_discursiva.py <edicao> <de> <ate>`; agente com `model: sonnet`, até 6 em paralelo, do ano mais recente para o mais antigo.
3. Quando um lote termina: `python3 ferramentas/validar.py --rascunho <arquivo>`; questões puladas por direito autoral vão para `dados/provas/indisponiveis.json`; commit.
4. Revisão: agente `revisor-questoes` com "edição <id>, questões <de> a <ate> (discursiva: siga a seção Discursivas)". Depois `montar_banco.py <edicao>` e `validar.py`.
