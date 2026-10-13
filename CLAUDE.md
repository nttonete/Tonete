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
| `app/app.js` | Lógica: modos, sorteio, correção, histórico (localStorage) |
| `app/render.js` | Markdown simplificado + LaTeX (KaTeX, saída MathML). Roda no navegador e no Node |
| `dados/provas/edicoes.json` | Cada edição: PDF, gabarito, versão do caderno, nº de questões |
| `dados/provas/gabaritos-transcritos.json` | Gabaritos que só existem como imagem (Unicamp 2018) |
| `dados/questoes/<edicao>.json` | Banco final, gerado. Não edite à mão |
| `dados/indice.json` | Índice lido pela plataforma ao abrir |
| `img/questoes/<edicao>/` | Figuras das questões (WebP) |
| `ferramentas/` | Pipeline (abaixo) |
| `.claude/agents/revisor-questoes.md` | Agente revisor |
| `testes/navegador.js` | Teste de ponta a ponta no Chromium |
| `trabalho/` | Área de trabalho, fora do git: páginas renderizadas, rascunhos, revisões |
| `fontes-pdf` | Link para os PDFs oficiais (fora do git) |

## Pipeline de uma edição

1. `python3 ferramentas/preparar_prova.py <edicao>`: renderiza páginas, extrai texto na ordem de leitura e recorta figuras candidatas em `trabalho/<edicao>/`.
2. Transcrição por agentes, em lotes de 30–36 questões: `python3 ferramentas/prompt_lote.py <edicao> <de> <ate>` gera o pedido. As regras estão em `ferramentas/INSTRUCOES-TRANSCRICAO.md`. Saída: `trabalho/<edicao>/rascunho-NNN-NNN.json`.
3. `python3 ferramentas/montar_banco.py <edicao>`: junta lotes, acrescenta o **gabarito oficial da versão do caderno**, aplica as correções do revisor e copia as figuras usadas.
4. Revisão pelo agente `revisor-questoes` (lotes iguais): `trabalho/<edicao>/revisao-NNN-NNN.json`. Depois rode `montar_banco.py` de novo.
5. `python3 ferramentas/validar.py` (precisa de 0 erros) e `node testes/navegador.js` (precisa de `PLAYWRIGHT_PATH=$(npm root -g)/playwright`).

## Regras que não podem ser quebradas

- **O gabarito vem só do PDF oficial**, lido por `ferramentas/gabaritos.py`, na versão do caderno (FUVEST V/V1, Unicamp Q, UNESP versão 1). Agentes nunca escrevem gabarito. Se o revisor discorda, a questão fica em `atencao` para uma pessoa decidir.
- **Nunca invente resposta de discursiva.** Só entra resposta publicada pela banca.
- Texto fiel ao caderno, inclusive erros de digitação do original (anote em `observacoes`).
- Questões anuladas ficam no banco marcadas e fora dos simulados e da nota.

## Fontes

- PDFs de provas e gabaritos: repositório público `diogopelaes/provas-vestibulares` (cópias dos arquivos das bancas).
- Conferência independente de gabarito: dataset acadêmico BLUEX (FUVEST e Unicamp, 2018–2024).
- Os sites oficiais (fuvest.br, comvest.unicamp.br, vunesp.com.br) estão bloqueados na rede do ambiente de nuvem. Liberá-los permite baixar as respostas esperadas das discursivas e os cadernos de 2ª fase completos.

## Como trabalhar aqui

- Tudo em português do Brasil: código, comentários, commits e textos da plataforma.
- Explique as decisões em linguagem simples, sem jargão.
- Commits com título curto no presente; o corpo explica o porquê.
