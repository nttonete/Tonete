# Equipe virtual da Banca Aberta

Quem faz o quê, com que modelo e a partir de qual arquivo. Atualize quando um agente entrar, mudar de função ou sair. O organograma visual é a página `ferramentas/organograma.html` (publicada como Artifact).

Situações: **Em uso** (trabalhando agora), **Automático** (roda sozinho por agenda), **Pronto** (terminou o trabalho e volta quando houver material novo), **Futuro** (planejado), **Adiado** (decidido esperar).

## Pessoas (decidem)

| Quem | Papel |
|---|---|
| Marcos | Dono do projeto: decide produto, preço e o que vai ao ar. Aprova as branches do robô de editais e as questões em `atencao` |
| Jurídico (Nayara ou advogado indicado) | Parecer sobre respostas da banca e prova completa; revisão dos rascunhos em `dados/juridico/`; marca no INPI |
| Professores (a contratar) | Revisão pedagógica dos guias das obras; amostra das correções por IA |

## Coordenação

| Agente | Modelo | Situação | O que faz | Onde |
|---|---|---|---|---|
| Coordenador | Opus, esforço alto | Em uso | Divide o trabalho, chama os agentes, valida, integra, publica a prévia e mantém `CLAUDE.md`, `PENDENCIAS.md` e este arquivo | Sessão "Plataforma de questões vestibular"; roteiro em `ORQUESTRACAO.md` |

## 1. Banco de questões

| Agente | Modelo | Situação | O que faz | Onde |
|---|---|---|---|---|
| Transcritor de objetivas | Sonnet | Pronto (30 provas) | Transcreve lotes de 30–36 questões, fiel ao caderno, com figuras e LaTeX | `prompt_lote.py`, `INSTRUCOES-TRANSCRICAO.md` |
| Transcritor de discursivas | Sonnet | Pronto (45 cadernos) | Enunciado + resposta oficial publicada pela banca | `prompt_discursiva.py`, `DISCURSIVAS.md` |
| Revisor de questões | Opus | Pronto, volta a cada edição | Confere com a página original, resolve, compara com o gabarito oficial, escreve assunto e resolução; se discorda, marca `atencao` | `.claude/agents/revisor-questoes.md`, `prompt_revisao_discursiva.py` |
| Comentarista | Opus | Pronto | Assunto e resolução comentada dos lotes revisados antes da regra nova | `prompt_complementos.py` |
| Corretor de discursivas por IA | Opus | Futuro | Compara a resposta do aluno com a resposta oficial; "estimativa para estudo", com aviso | Depende do backend |

Provas de 2027: a mesma esteira (transcritor → revisor) roda assim que as bancas publicarem cadernos e gabaritos.

## 2. Conteúdo de estudo

| Agente | Modelo | Situação | O que faz | Onde |
|---|---|---|---|---|
| Pesquisador de editais | Opus | Pronto | Datas, horários e regras só de documentos oficiais | `dados/provas/calendario.json`, `formatos.json` |
| Robô de editais | Opus | Automático (seg e qui, 7h59) | Confere os documentos oficiais; mudança vira branch para aprovação | Sessão "Robô de editais (sessão fixa)", `robo_editais.py` |
| Redator de guias das obras | Opus | Pronto, aguarda professor | 18 guias da equipe (nunca trechos das obras) | `dados/conteudo/obras.json`, `ligar_obras.py` |
| Curador de temas de redação | Opus | Pronto | 32 propostas anteriores com fonte | `dados/conteudo/redacao-temas.json` |
| Corretor de redação por IA | Opus | Futuro | Rubrica própria da equipe, estimativa, opt-in, amostra revisada por professores | Depende do backend |
| Tutor de dúvidas | Opus | Futuro (a avaliar) | Explica a resolução quando o aluno não entendeu, sem mudar gabarito | Depende do backend |

## 3. Produto e tecnologia

| Agente | Modelo | Situação | O que faz | Onde |
|---|---|---|---|---|
| Designer de interface | Opus | Em uso (papel do Coordenador) | Layout, gráficos de desempenho, prévia | `pagina.html`, `app/` |
| Engenheiro de backend | Opus, esforço alto | Em uso | Supabase, login, sincronização, Mercado Pago | Sessão "Migração Supabase e backend", `supabase/LEIAME.md` |
| Testador e segurança | Opus | Futuro | Antes de cada publicação: validador, teste de navegador, revisão de código e de segurança | `validar.py`, `testes/navegador.js` |
| Analista de dados | Sonnet | Futuro | Uso, conversão, ranking semanal e questões com erro fora do normal (pista de erro de transcrição) | Depende do backend |

## 4. Jurídico e conformidade

| Agente | Modelo | Situação | O que faz | Onde |
|---|---|---|---|---|
| Auditor de conformidade | Opus | Pronto (papel do Coordenador) | Auditoria A–I: direito autoral, LGPD, consumidor; textos sempre "RASCUNHO PARA REVISÃO JURÍDICA" | `CONFORMIDADE.md`, `dados/juridico/` |
| Triagem de direitos de terceiros | Opus | Adiado | Classifica os itens de risco (charges, fotos, textos): autor, obra, domínio público | `conformidade.py`, `dados/provas/terceiros.json` |
| Atendente LGPD | Sonnet | Futuro | Pedidos do titular: cópia, correção, exclusão; responde com o encarregado humano | `privacidade@` |
| Moderador do fórum | Sonnet | Futuro | Fila de revisão de comentários, ocultar e restaurar com log | `moderar.py` |

## 5. Negócio e relacionamento

| Agente | Modelo | Situação | O que faz | Onde |
|---|---|---|---|---|
| Marketing e Instagram | Sonnet | Futuro | Posts e calendário do @bancaaberta, agendamento | Modelo: skill do Primeiro Contato |
| Suporte ao aluno | Sonnet | Futuro | Dúvidas de acesso e pagamento; erro de questão reportado vai para o Revisor | `suporte@` |
| Financeiro | Sonnet | Futuro | Conciliação do Mercado Pago, reembolso de 7 dias (arrependimento), relatórios | Depende do backend |

## Portões de qualidade (scripts, não agentes)

Nenhum agente passa por cima deles: `gabaritos.py` (gabarito só do PDF oficial), `validar.py` (0 erros), `testes/navegador.js`, `comparar_bluex.py` (conferência independente).

## Regras que valem para todos

1. Gabarito só do PDF oficial; agente nunca escreve gabarito.
2. Nunca inventar resposta de discursiva: só a publicada pela banca.
3. Texto fiel ao caderno; nada de trecho protegido.
4. Tudo em português do Brasil; texto legal é rascunho até revisão jurídica.
5. Volume repetitivo → Sonnet; julgamento, revisão, jurídico e código → Opus.
