# CLAUDE.md

Contexto do repositório para o Claude Code. Este arquivo é lido no início de cada sessão: mantenha-o curto e atualizado. Quando surgir uma regra ou decisão nova que valha para as próximas sessões, anote aqui.

## O projeto

Site e atendimento da **NT Advocacia**: Nayara Tonete, advogada, OAB/SP 479.459. O público são famílias de pessoas com deficiência (PcD, TEA) e vítimas de golpe do Pix, que chegam por anúncios do Google e da Meta.

| Pasta | O que é |
|---|---|
| `escola-pcd/` | Landing page: dedução integral da escola de PcD no IR (Tema 324 da TNU) |
| `plano-saude-autismo/` | Landing page: negativa e limitação de terapias (ABA, fono, TO, psicologia) pelo plano de saúde |
| `*/obrigado/` | Página intermediária: registra a conversão do Google Ads e abre o WhatsApp |
| `privacidade/` | Política de privacidade do site e do robô. A Meta exige essa URL para publicar o app |
| `whatsapp-bot/` | Robô de triagem da campanha golpe do Pix (Cloudflare Worker + Claude). Veja `whatsapp-bot/README.md` |
| `img/` | Imagens compartilhadas. `nayara-tonete.jpg` tem 560×700 e já está otimizada |

## Publicação

- **Site:** `.github/workflows/pages.yml` publica o repositório inteiro no GitHub Pages a cada push no `main`. Não há build: os arquivos são servidos como estão (`.nojekyll`).
- **Robô:** `.github/workflows/robo.yml` roda `npm test` e `wrangler deploy` quando algo em `whatsapp-bot/` muda no `main`. As chaves ficam nos Secrets do GitHub e nunca entram no código.
- O que entra no `main` vai ao ar. Por isso, todo trabalho é feito numa branch e entra por PR, que a Nayara revisa e mergeia.

## Landing pages

Cada página é um `index.html` autocontido, com CSS e JS inline. Não há framework nem dependências. Para criar uma página nova, copie a estrutura de uma existente (a mais recente é `plano-saude-autismo/`).

- **Identidade visual:** tokens CSS em `:root` (`--cafe`, `--dourado`, `--creme`, `--papel`, `--tinta`...) com variante para modo escuro. Fontes Cormorant Garamond (títulos) e Poppins (texto), carregadas sem bloquear a exibição. Largura máxima de `--largura: 1120px`.
- **Celular primeiro:** a maior parte do tráfego vem de anúncios no celular. Há um botão fixo de WhatsApp na tela do celular.
- **Foto da advogada:** sem `loading="lazy"` quando aparece no começo da página.
- **Fluxo de contato:** todo botão de WhatsApp aponta para `obrigado/`. Essa página dispara a conversão e abre `wa.me/5531996936688` com uma mensagem pronta sobre o tema.
- **Origem do visitante:** um script lê `utm_source` e `gclid` e repassa `?origem=instagram|facebook|meta|google` ao `obrigado/`. A mensagem do WhatsApp indica de onde a pessoa veio.
- **Google Ads:** tag `AW-18475335228` em todas as páginas. A conversão "Contato WhatsApp" é `AW-18475335228/-4NuCMzw7oodELz83OlE` e é disparada na página `obrigado/`, que abre o WhatsApp no `event_callback` (no máximo 2,5 s). Não existe GA4 no site.

## Regras de conteúdo (OAB)

Todo texto público, das páginas e do robô, segue o Código de Ética da OAB e o Provimento 205/2021 (publicidade da advocacia):

- Tom informativo e sóbrio. Nada de promessa de resultado, garantia ou "ganhe sua causa".
- Sem superlativos nem comparação com outros advogados. Exemplo: "caminhos possíveis", e não "melhor caminho".
- Não falar de preços, honorários ou "consulta grátis".
- Não citar leis, artigos nem decisões nas landing pages. O tema pode ser explicado em linguagem simples.
- Sempre identificar a advogada com nome e OAB/SP 479.459.
- Na dúvida, prefira a formulação mais conservadora e avise na PR.

## Robô do WhatsApp (`whatsapp-bot/`)

- **Arquitetura:** Cloudflare Worker `nt-whatsapp-bot` (conta `nayaraktonete.workers.dev`), com um Durable Object `Conversa` por cliente e um `Diagnostico`. A API é a Cloud API da Meta, e o robô tem um número próprio: +55 (17) 99772-2969.
- **Arquivos:** `src/index.js` (webhook e diagnóstico), `src/conversa.js` (estado, espera de 8 s, encaminhamento), `src/claude.js` (chamada ao modelo), `src/whatsapp.js` (envio e aviso à advogada), `src/prompt.js` (instruções e regras da OAB do robô).
- **Configuração:** `wrangler.toml`, que guarda o modelo em `CLAUDE_MODEL`, o número do escritório em `NUMERO_ESCRITORIO`/`NOTIFY_TO` e o modo de teste em `ALLOWED_NUMBERS`.
- **Testes:** `cd whatsapp-bot && npm test`. Rodam offline, com WhatsApp e Claude simulados. Rode sempre antes de abrir uma PR que mexa no robô.
- **Diagnóstico:** `/diagnostico?chave=VERIFY_TOKEN`, com `&zerar=ultimo` ou `&zerar=<número>` para refazer um teste. A página nunca mostra o conteúdo das conversas.
- **Contato do escritório:** o robô passa o número por extenso e o cartão de contato, **sem links**, porque quem caiu num golpe desconfia de links.
- O texto de `src/prompt.js` é fixo de propósito, para aproveitar o cache de prompt. Dados variáveis, como a data, entram como mensagem de sistema.

## Como trabalhar aqui

- **Idioma:** tudo em português do Brasil, inclusive código, comentários, commits e PRs. A Nayara não é programadora: explique em linguagem simples, sem jargão.
- **Commits:** título curto no presente, com prefixo quando ajuda. Exemplos: `Robô: ...` e `Página "Plano de saúde e autismo"`. O corpo explica o porquê.
- **PRs:** uma PR por assunto, com descrição do que muda para o visitante ou cliente.
- **Dados pessoais:** nunca coloque no repositório conteúdo de conversas, nomes de clientes ou chaves (tokens, API keys).
