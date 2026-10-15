# CLAUDE.md

Contexto do projeto para o Claude Code. Mantenha curto e atualizado.

## O projeto

**Banca Aberta** (nome provisório): plataforma paga de treino para vestibular com questões reais da **FUVEST (USP)**, **Unicamp (Comvest)** e **UNESP (VUNESP)**, edições de 2017 a 2026. O aluno faz simulados sorteados por vestibular, provas completas, treinos por matéria e discursivas; as respostas só aparecem quando ele termina.

Esta branch (`vestibular`) é independente do site da NT Advocacia (branch `main`): não compartilha histórico e nada aqui é publicado pelo workflow do site. O plano é mover tudo para um repositório próprio.

## Estrutura

| Caminho | O que é |
|---|---|
| `pagina.html` | Fonte da página (CSS inline). É publicada como prévia (Artifact) |
| `index.html` | Gerado por `ferramentas/gerar_index.py` a partir de `pagina.html`, para hospedagem própria. Não edite à mão |
| `trabalho/previa/` | Gerado por `ferramentas/gerar_previa.py`: arquivos da prévia publicada, com as figuras embutidas no JSON de cada prova (a prévia aceita poucos arquivos) |
| `app/app.js` | Lógica: modos, sorteio, correção, histórico (localStorage) |
| `app/render.js` | Markdown simplificado + LaTeX (KaTeX, saída MathML). Roda no navegador e no Node |
| `dados/provas/edicoes.json` | Cada edição: PDF, gabarito, versão do caderno, nº de questões |
| `dados/provas/gabaritos-transcritos.json` | Gabaritos que não vêm em PDF próprio: Unicamp 2018 (imagem) e Unicamp 2021 (extraído por script da prova comentada oficial) |
| `dados/provas/indisponiveis.json` | Questões fora do banco por depender de texto protegido (ver `ferramentas/PENDENCIAS.md`) |
| `dados/questoes/<edicao>.json` | Banco final, gerado. Não edite à mão |
| `dados/indice.json` | Índice lido pela plataforma ao abrir |
| `img/questoes/<edicao>/` | Figuras das questões (WebP) |
| `ferramentas/` | Pipeline (abaixo) |
| `.claude/agents/revisor-questoes.md` | Agente revisor |
| `ferramentas/EQUIPE.md`, `organograma.html` | Equipe virtual: cada agente, modelo, situação e arquivos. Atualize quando um agente entrar ou mudar |
| `testes/navegador.js` | Teste de ponta a ponta no Chromium |
| `trabalho/` | Área de trabalho. No git ficam só rascunhos, revisões, complementos e recortes manuais (`*-cK.webp`); páginas renderizadas e figuras automáticas se regeneram |
| `dados/provas/terceiros.json`, `moderacao.json` | Conteúdo de terceiros por questão (status, autor, obra) e regras de ocultação com log. Ver `ferramentas/CONFORMIDADE.md` |
| `dados/provas/calendario.json` | Datas, horários e regras do dia da prova de cada vestibular, só de documentos oficiais (com fonte e data de conferência) |
| `dados/conteudo/obras.json`, `redacao-temas.json` | Obras de leitura obrigatória com guia da equipe e questões ligadas (`ferramentas/ligar_obras.py`); temas de redação anteriores |
| `ferramentas/robo_editais.py` | Robô que confere os documentos oficiais e avisa mudanças (roda sozinho segundas e quintas; prepara a atualização numa branch para aprovação) |
| `supabase/` | Backend (Supabase, São Paulo): migrações do banco e, depois, as funções de servidor. Ver `supabase/LEIAME.md` |
| `dados/juridico/` | Rascunhos de Termos, Privacidade e Direitos autorais (para revisão jurídica) |
| `fontes-pdf` | Link para os PDFs oficiais (fora do git) |

## Pipeline de uma edição

1. `python3 ferramentas/preparar_prova.py <edicao>`: renderiza páginas, extrai texto na ordem de leitura e recorta figuras candidatas em `trabalho/<edicao>/`.
2. Transcrição por agentes, em lotes de 30–36 questões: `python3 ferramentas/prompt_lote.py <edicao> <de> <ate>` gera o pedido. As regras estão em `ferramentas/INSTRUCOES-TRANSCRICAO.md`. Saída: `trabalho/<edicao>/rascunho-NNN-NNN.json`.
3. `python3 ferramentas/montar_banco.py <edicao>`: junta lotes, acrescenta o **gabarito oficial da versão do caderno**, aplica as correções do revisor e copia as figuras usadas.
4. Revisão pelo agente `revisor-questoes` (lotes iguais): `trabalho/<edicao>/revisao-NNN-NNN.json`. Depois rode `montar_banco.py` de novo.
5. `python3 ferramentas/validar.py` (precisa de 0 erros) e `node testes/navegador.js` (precisa de `PLAYWRIGHT_PATH=$(npm root -g)/playwright`).
6. Prévia: `python3 ferramentas/gerar_previa.py` e publicar `pagina.html` com os arquivos de `trabalho/previa/`.

Situação: as 30 provas de 1ª fase (2017–2026) estão transcritas, revisadas e com resolução comentada. As 45 discursivas de 2ª fase com resposta oficial publicada (FUVEST 2023–2026, Unicamp 2017–2026) também estão transcritas e revisadas, com assunto e, na Unicamp, o objetivo da questão (inventário em `ferramentas/DISCURSIVAS.md`); FUVEST 2017–2022 e UNESP ficam de fora por não ter resposta oficial (UNESP: o site da VUNESP nega acesso daqui e não achamos respostas esperadas publicadas; resoluções de cursinhos não valem; ver `ferramentas/DISCURSIVAS.md`). O que depende de decisão humana está em `ferramentas/PENDENCIAS.md`.

## Recursos da plataforma

- Simulado no formato do edital vigente (`dados/provas/formatos.json`: FUVEST 2027 = 80 questões; Unicamp 72 com cotas por matéria; UNESP 90). Atualize esse arquivo a cada edital.
- Cronômetro regressivo com o tempo oficial (proporcional ao tamanho); a prova é entregue quando o tempo acaba.
- Correção com resolução comentada (`resolucao`) e assunto (`assunto`, lista fixa em `dados/provas/assuntos.json`).
- Desempenho (guardado no aparelho): evolução, mapa de assuntos por vestibular, "onde focar", medalhas e "refazer questões que errei".
- Tabela periódica da prova nas questões de química da UNESP (`img/tabela-periodica/`).
- Ainda sem servidor: fórum de comentários, ranking semanal, login e pagamento dependem de backend.

## Plano de estudos e guias

- Telas: Treinar, Plano (plano de estudos + caderno de erros), Guias (dia da prova, obras, redação) e Desempenho. Tudo guardado no aparelho do aluno (localStorage) até haver backend.
- O plano gera as tarefas de cada dia até a prova: matérias pelo peso do edital puxando as de menor acerto, assuntos fracos, revisão espaçada de erros (1, 3, 7 e 21 dias), simulado semanal no horário real, leituras e redação. Dias passados ficam como foram gerados; os futuros se ajustam ao desempenho.
- Regras do dia da prova vêm só do edital/manual oficial. Dicas gerais ficam separadas como "Dicas da equipe".
- Guias das obras são texto da equipe (nunca trechos das obras) e ficam com `revisao: "pendente"` até um professor revisar.

## Assunto e resolução

- O agente revisor escreve `complementos` (assunto + resolução) em `revisao-*.json`. Lotes revisados antes disso recebem só complementos: `python3 ferramentas/prompt_complementos.py <edicao> <de> <ate>` → `complementos-*.json`.
- A resolução termina em `**Resposta: X**` com a letra do gabarito oficial; o validador recusa se divergir.

## Regras que não podem ser quebradas

- **O gabarito vem só do PDF oficial**, lido por `ferramentas/gabaritos.py`, na versão do caderno (FUVEST V/V1, Unicamp Q, UNESP versão 1). Agentes nunca escrevem gabarito. Se o revisor discorda, a questão fica em `atencao` para uma pessoa decidir.
- **Nunca invente resposta de discursiva.** Só entra resposta publicada pela banca.
- Texto fiel ao caderno, inclusive erros de digitação do original (anote em `observacoes`).
- Questões anuladas ficam no banco marcadas e fora dos simulados e da nota.

## Conformidade jurídica

- Toda edição leva `citacao` no formato da banca e `link_oficial`; o validador recusa sem eles. A plataforma não faz pedidos a servidores de terceiros (fontes e KaTeX são locais; o teste de navegador confere).
- Simulados limitam a 30% as questões de uma mesma prova (`_regras` em `formatos.json`). Ocultar/restaurar/excluir questões: `ferramentas/moderar.py` (com log). Terceiros: `ferramentas/conformidade.py`. Decisões e pendências: `ferramentas/CONFORMIDADE.md`.
- Textos legais são sempre **RASCUNHO PARA REVISÃO JURÍDICA**.

## Fontes

- PDFs de provas e gabaritos: repositório público `diogopelaes/provas-vestibulares` (cópias dos arquivos das bancas).
- Conferência independente de gabarito: dataset acadêmico BLUEX (FUVEST e Unicamp, 2018–2024).
- Os sites oficiais (fuvest.br, comvest.unicamp.br, vunesp.com.br) estão bloqueados na rede do ambiente de nuvem. Liberá-los permite baixar as respostas esperadas das discursivas e os cadernos de 2ª fase completos.

## Como trabalhar aqui

- Tudo em português do Brasil: código, comentários, commits e textos da plataforma.
- Explique as decisões em linguagem simples, sem jargão.
- Commits com título curto no presente; o corpo explica o porquê.
