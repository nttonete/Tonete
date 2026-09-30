# Tonete: contexto para o Claude

Repositório da NT Advocacia (Nayara Tonete, advogada, OAB/SP 479.459). **O repositório é público** (o GitHub Pages publica a raiz inteira): nunca grave aqui senhas, tokens, chaves, PIN nem e-mails.

As pessoas que usam este repositório não são técnicas e costumam trabalhar pelo celular. Explique em português, passo a passo, com links diretos. Não peça que colem tokens na conversa.

## O que existe

- `escola-pcd/`: landing page da dedução da escola de PcD no IR. Os botões levam a `escola-pcd/obrigado/`, que registra a conversão no Google Ads e abre o WhatsApp do escritório (31) 99693-6688.
- `privacidade/`: política de privacidade (LGPD), exigida pela Meta para o app do WhatsApp.
- `whatsapp-bot/`: robô de triagem da campanha "golpe do Pix". É um Cloudflare Worker com Durable Objects e usa Claude (`@anthropic-ai/sdk`).
  - Número do robô: +55 17 99772-2969 (Cloud API da Meta, ID `1257704010769958`).
  - No fim da triagem, avisa a advogada no (31) 99693-6688 e passa ao cliente o número e o cartão de contato do escritório, sem links.
  - O robô ignora mensagens do número da advogada (`NOTIFY_TO`).
- `docs/robo-whatsapp-guia.md`: guia para o escritório. Traz o mapa das contas, os segredos (onde gerar), o diagnóstico, os problemas já resolvidos, as pendências e como repetir em outra campanha. **Leia antes de mexer no robô.**

## Publicação

- Site: `.github/workflows/pages.yml`, a cada push no `main`.
- Robô: `.github/workflows/robo.yml`, a cada push no `main` que mude `whatsapp-bot/**`, ou por Run workflow. Ele roda `npm test`, depois `wrangler deploy`, e envia os 5 segredos do GitHub ao Worker.
- O fluxo é sempre por PR no GitHub. A equipe faz o merge.

## Robô: comandos e convenções

- `cd whatsapp-bot && npm test`: testes em Node, com WhatsApp e Claude simulados. `test/cloudflare-stub.mjs` substitui `cloudflare:workers`.
- `npx wrangler deploy --dry-run --outdir <tmp>`: confere se o Worker compila.
- As classes de Durable Object (`Conversa`, `Diagnostico`) precisam estender `DurableObject`, porque usam armazenamento SQLite.
- Instruções do robô e regras da OAB: `whatsapp-bot/src/prompt.js`. O prompt é fixo, para aproveitar o cache; a data entra como mensagem de sistema no fim.
- Diagnóstico: `/diagnostico?chave=<VERIFY_TOKEN>`, e `&zerar=ultimo` para refazer testes. É a principal ferramenta para investigar problemas, porque este ambiente não acessa `*.workers.dev` nem o painel da Meta.
- O comentário, o texto e os nomes no código são em português, como no resto do projeto.
