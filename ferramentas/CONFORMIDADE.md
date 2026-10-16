# Conformidade jurídica (direito autoral, LGPD, consumidor)

Auditoria feita em 15/10/2026 e plano de adequação. Os textos legais são **RASCUNHOS PARA REVISÃO JURÍDICA**: nada aqui substitui um advogado.

## Decisões do responsável

| Tema | Decisão |
|---|---|
| Respostas esperadas e comentários oficiais das bancas (requisito D) | **Mantidos por ora.** Voltar ao assunto depois do parecer jurídico. Se a decisão mudar: tirar `resposta_oficial` das discursivas e o "Objetivo da questão", e trocar por rubrica própria. |
| Modo "prova completa" (requisito A3) | **Mantido.** Risco conhecido: reconstrói uma prova original inteira. O teto de 30% vale só para simulados. |
| Prévia publicada (Artifact, privada) | **Mantida** (e atualizada com as mudanças abaixo). |
| Backend | **Opção A (Supabase, região São Paulo)** escolhida, ainda não construída. Falta criar a conta do projeto e definir provedor de IA e de pagamento. |
| E-mail de contato | Provisório: mvtonete@gmail.com (pedidos de remoção e contato do encarregado). Trocar pelo oficial antes do lançamento. |
| Triagem de terceiros | Adiada: não mexer agora. |

## O que já está feito (sem backend)

| Requisito | Situação | Como |
|---|---|---|
| A1 metadados e link | Parcial | Toda edição tem `citacao` e `link_oficial` (site da banca). O link direto para o PDF de cada edição entra no campo `url_pdf` de `dados/provas/edicoes.json` quando for confirmado; sem ele, vale o site da banca. |
| A2 citação visível | Atende | `ferramentas/conformidade.py` gera a citação no formato de cada banca; `montar_banco.py` grava; `validar.py` recusa edição sem ela; o app mostra "Fonte: …" sob cada questão. |
| A3 teto por prova | Parcial | Simulados usam no máximo 30% de uma mesma prova (`_regras.limite_mesma_prova` em `dados/provas/formatos.json`; 0 desliga). Se só houver uma prova disponível, o teto é relaxado. |
| B registro de terceiros | Parcial | `dados/provas/terceiros.json`: 2.718 itens (textos, fotos, charges, tirinhas, pinturas, gráficos, outros), todos `pendente`, com risco alto/médio/baixo. `autor`, `obra` e `ano_morte` ainda vazios. Itens conferidos aparecem na questão como "Conteúdo de terceiros". |
| B bloqueio de pendentes | Mecanismo pronto, **desligado** | `config.bloquear_pendentes` em `terceiros.json`. Ligar só depois da triagem, senão quase tudo some. |
| C ocultar com log | Atende (por linha de comando) | `ferramentas/moderar.py ocultar / restaurar / excluir / listar`. Reversível; exclusão definitiva é outro comando, com `--confirmar`. Tudo vai para `dados/provas/moderacao.json` (quem, quando, por quê). |
| C solicitações | Parcial | Página pública "Direitos autorais e remoção"; registro em `ferramentas/solicitacao.py` (prazo-alvo de 5 dias úteis; arquivo em `privado/`, fora do git). Falta o e-mail oficial e o formulário (precisa de servidor). |
| E marcas | Atende | Rodapé de independência; nomes só descritivos. |
| G (parte que existe hoje) | Atende | Fontes e KaTeX hospedados no próprio site: nenhum pedido a servidores de terceiros (o teste de navegador confere). Sem cookies, sem análise de uso, sem cadastro. |
| H documentos | Rascunhos | `dados/juridico/*.md`, abertos pelo rodapé com a faixa de rascunho. |
| I posicionamento | Ajustado | Textos falam em ferramenta de estudo e estimativa. |

## Como operar

- `python3 ferramentas/conformidade.py relatorio`: resumo (citações, terceiros por status e risco, ocultações, solicitações).
- `python3 ferramentas/conformidade.py levantar`: cria registros que faltam em `terceiros.json` sem apagar o que já foi preenchido.
- Preencher um conteúdo de terceiros: editar o item em `terceiros.json` (`status`, `autor`, `obra`, `ano_morte`). O validador exige autor e obra para liberar, e ano de morte para domínio público. Depois, `python3 ferramentas/montar_banco.py`.
- Ocultar tudo de uma banca: `python3 ferramentas/moderar.py ocultar --banca unesp --motivo "..." --por "Nome"`.

## Triagem sugerida de terceiros (sem tirar tudo do ar)

1. Risco alto primeiro (1.049 itens): charges, tirinhas, pinturas, fotografias e textos de português, literatura, inglês e artes.
2. Registrar autor, obra e ano de morte; domínio público = autor morto há mais de 70 anos. O restante entra como `citacao_com_autoria` quando for uso curto e com autoria, ou fica `pendente`.
3. Só quando a maior parte do risco alto estiver resolvida, ligar o bloqueio. O que continuar pendente sai da plataforma, sem apagar nada.

## Fica para quando houver backend

- Painel administrativo com fila de revisão antes de publicar e perfis de acesso (C1).
- Formulário de remoção (C3).
- Cadastro com data de nascimento e fluxo de menores; consentimento do responsável; exportar, corrigir e excluir conta; retenção; logs de acesso; banner de cookies se entrar análise de uso (G).
- Correção por IA: aviso, "estimativa para estudo", identificador sem nome, remoção de EXIF, opt-in separado para treino de modelos, amostra revisada por professores (F, G).
- Rubricas próprias em entidade com autor (D2).
- Compra com preço total, renovação e arrependimento de 7 dias (H).

## Proposta de backend

- **Opção A (ESCOLHIDA): Supabase (Postgres + login + arquivos + regras por perfil + funções no servidor), região São Paulo.** O site atual continua estático. A correção por IA roda numa função no servidor, que envia ao provedor só o texto ou a foto e a rubrica, com um identificador sem nome. Rápido de montar, baixo custo inicial, dados no Brasil. Contra: dependência de um fornecedor.
- **Opção B: servidor próprio (Python ou Node) com Postgres gerenciado em nuvem no Brasil (AWS, Google Cloud ou Azure).** Mais controle e mais trabalho: login, e-mail e painel ficam por nossa conta.
- **Opção C: Firebase (Google), região São Paulo.** Bom login, banco menos adequado ao log de moderação e aos relatórios.
- Pagamento: provedor com checkout hospedado (Asaas, Mercado Pago ou Stripe), para não tocar em dado de cartão. Análise de uso: evitar, ou usar ferramenta sem cookies.
- Em qualquer opção: contrato de tratamento de dados com cada fornecedor, país de processamento registrado na Política de Privacidade, e cláusula de não-treinamento no provedor de IA.

## Pontos para o advogado

- Manter ou tirar a resposta esperada e o comentário oficial das bancas (requisito D).
- Manter ou tirar o modo "prova completa".
- Uso de charges, tirinhas, pinturas e fotografias como recorte da prova (citação e autoria bastam?).
- Foro, lei aplicável, e-mail oficial, encarregado (DPO), prazos de retenção.

## Página de vendas (`site/`) · análise de 16/10/2026

RASCUNHO PARA REVISÃO JURÍDICA. Avaliação feita antes de a página ir ao público; ela continua privada.

### Ajustado na página

| Risco | Base | O que mudou |
|---|---|---|
| Números do professor sem prova e atribuídos à plataforma ("levou 10 mil à aprovação") | CDC arts. 36 (par. único), 37 e 38; CONAR arts. 23 e 27 | Viraram "ex-alunos aprovados ao longo da carreira", com nota de rodapé pedindo fonte e período. A Banca Aberta precisa guardar os documentos que comprovam os números |
| Telas e resultados (73%, 58%) podiam parecer resultado real de aluno | CDC art. 37 | Marcados como "exemplo" ou "dados de exemplo" |
| "Oficial" sugerindo vínculo com as bancas (calendário oficial, cronômetro oficial, questões oficiais) | LPI art. 189/195; CDC art. 37 | Trocado por "datas divulgadas pelas bancas", "tempo de prova do edital", "questões das provas". O rodapé diz que os nomes são marcas dos titulares |
| Escassez e "condição de fundador" sem definição ("acesso em ondas", "quem chega primeiro") | CDC arts. 30 e 37 | Retirado. A página promete só o que é verdade: o convite chega antes da abertura ao público e entrar na lista não obriga a comprar |
| Garantia de 7 dias apresentada como vantagem | CDC art. 49 | Virou "Direito de arrependimento", citando o artigo |
| Comparação com afirmação não comprovável ("Raramente") | CONAR art. 32 | "Depende da lista" e nota de que a comparação é com formas de estudo em geral, não com concorrentes |
| Formulário sem informação de tratamento de dados | LGPD arts. 6, 8, 9 e 14 | Aviso em camadas (quem trata, finalidade, base legal, prazo, direitos, menores) e consentimento não pré-marcado. Nada é enviado até o backend existir |
| Falta de identificação do fornecedor | Decreto 7.962/2013, art. 2º | Campo reservado no rodapé: razão social, CNPJ, endereço e e-mail, obrigatórios antes de vender |
| "Guias conferidos toda semana" | CDC art. 37 | Corrigido para "duas vezes por semana", que é o que o robô faz |

### Depende de pessoas (não se resolve no código)

1. **Direito de imagem do professor** (CC art. 20): autorização escrita para usar nome, foto e voz na divulgação, com prazo, meios e possibilidade de edição da imagem.
2. **Direito autoral da foto** (Lei 9.610, arts. 7º, VII, 24 e 29): a foto foi feita num evento da **Ycon**. É preciso licença do fotógrafo ou da Ycon para usar e para alterar a imagem (retiramos o logotipo da Ycon). Sem licença, trocar por fotos próprias.
3. **Contratos do professor com outras escolas:** conferir cláusulas de exclusividade, não concorrência e uso de imagem antes de associá-lo à Banca Aberta.
4. **Números do professor:** juntar a prova (lista de aprovados, painel do YouTube) e informar o período.
5. **Título OBA/MOBFOG 2026:** usar o texto exato e o nome oficial da olimpíada; não usar logotipos das olimpíadas sem autorização.
6. **Reprodução das questões das bancas:** a venda continua dependendo do parecer sobre as respostas da banca e a prova completa (decisão 1.b). A página não deve ir ao público antes disso.
7. **Preços:** quando definidos, mostrar o preço total, a periodicidade e as regras de renovação e cancelamento (CDC art. 31; Decreto 7.962/2013).
8. **Publicidade para adolescentes** (CONAR, seção 11, art. 37): o público tem menos de 18 anos. Manter o tom informativo, sem pressão por medo de reprovação e sem promessa de aprovação.
9. **E-mail de contato:** `contato@bancaaberta.com.br` só funciona depois de configurar o Google Workspace. O aviso de privacidade usa o contato provisório `mvtonete@gmail.com`, que deve ser trocado antes de publicar.
10. **Lista de espera:** antes de ligar o formulário, incluir link de descadastro nos e-mails, registrar a data e o texto do consentimento e fixar o prazo de guarda (hoje "12 meses", a confirmar).
