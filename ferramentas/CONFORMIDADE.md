# Conformidade jurídica (direito autoral, LGPD, consumidor)

Auditoria feita em 15/10/2026 e plano de adequação. Os textos legais são **RASCUNHOS PARA REVISÃO JURÍDICA**: nada aqui substitui um advogado.

## Decisões do responsável

| Tema | Decisão |
|---|---|
| Respostas esperadas e comentários oficiais das bancas (requisito D) | **Mantidos por ora.** Voltar ao assunto depois do parecer jurídico. Se a decisão mudar: tirar `resposta_oficial` das discursivas e o "Objetivo da questão", e trocar por rubrica própria. |
| Modo "prova completa" (requisito A3) | **Mantido.** Risco conhecido: reconstrói uma prova original inteira. O teto de 30% vale só para simulados. |
| Prévia publicada (Artifact, privada) | **Mantida** (e atualizada com as mudanças abaixo). |
| Backend | Ainda não escolhido; proposta abaixo. |

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

- **Opção A (recomendada): Supabase (Postgres + login + arquivos + regras por perfil + funções no servidor), região São Paulo.** O site atual continua estático. A correção por IA roda numa função no servidor, que envia ao provedor só o texto ou a foto e a rubrica, com um identificador sem nome. Rápido de montar, baixo custo inicial, dados no Brasil. Contra: dependência de um fornecedor.
- **Opção B: servidor próprio (Python ou Node) com Postgres gerenciado em nuvem no Brasil (AWS, Google Cloud ou Azure).** Mais controle e mais trabalho: login, e-mail e painel ficam por nossa conta.
- **Opção C: Firebase (Google), região São Paulo.** Bom login, banco menos adequado ao log de moderação e aos relatórios.
- Pagamento: provedor com checkout hospedado (Asaas, Mercado Pago ou Stripe), para não tocar em dado de cartão. Análise de uso: evitar, ou usar ferramenta sem cookies.
- Em qualquer opção: contrato de tratamento de dados com cada fornecedor, país de processamento registrado na Política de Privacidade, e cláusula de não-treinamento no provedor de IA.

## Pontos para o advogado

- Manter ou tirar a resposta esperada e o comentário oficial das bancas (requisito D).
- Manter ou tirar o modo "prova completa".
- Uso de charges, tirinhas, pinturas e fotografias como recorte da prova (citação e autoria bastam?).
- Foro, lei aplicável, e-mail oficial, encarregado (DPO), prazos de retenção.
