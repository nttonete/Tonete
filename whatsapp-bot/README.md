# Atendimento automático do WhatsApp (golpe do Pix)

Robô de triagem para os contatos da campanha de golpe do Pix. Ele responde na hora, a qualquer hora:

1. Se apresenta como assistente virtual do escritório da advogada Nayara Tonete.
2. Acolhe a pessoa e reúne as informações do caso: o que aconteceu, quando, valor, banco, se já contestou no banco (MED), se fez B.O. e se tem os comprovantes.
3. Avisa a Nayara no WhatsApp pessoal dela com um resumo e o link da conversa, e para de responder aquele contato.

Ele também avisa a Nayara na hora quando a pessoa pede atendimento humano, quer contratar, pergunta sobre honorários ou quando o caso é urgente.

As regras da OAB estão nas instruções do robô (`src/prompt.js`):
- não dá parecer nem promete resultado;
- não fala de honorários;
- nunca pede senha nem pagamento;
- não cita leis nem decisões.

Para mudar o tom ou as perguntas, edite esse arquivo e publique de novo.

## Como funciona

- **Mesmo número no app e na API ("coexistência").** A Nayara continua vendo e respondendo tudo pelo app WhatsApp Business no celular. Quando alguém do escritório responde uma conversa pelo app, o robô sai daquela conversa sozinho.
- **Mensagens em sequência.** Quem manda várias mensagens seguidas recebe uma só resposta. O robô espera 8 segundos sem mensagem nova antes de responder.
- **Áudios, fotos e documentos.** O robô ainda não ouve áudios nem lê imagens. Ele pede que a pessoa escreva e diz que o arquivo fica guardado para a advogada.
- **Se a IA falhar.** O robô tenta 3 vezes. Se não conseguir, manda uma mensagem educada à pessoa e avisa a Nayara.
- **Onde roda.** Num Cloudflare Worker, com um Durable Object por cliente guardando o histórico. As respostas são geradas pelo Claude (Anthropic).

## Colocando no ar

### 1. Ligar o número à API sem tirar do app (360dialog)

Pelas regras da Meta, só dá para usar o mesmo número no app e na API ao mesmo tempo passando por um parceiro oficial. A 360dialog é um desses parceiros e usa o mesmo formato de mensagens da Cloud API.

1. Crie a conta na 360dialog e conecte o número (31) 99693-6688 escolhendo a opção de conectar um app WhatsApp Business existente (coexistência). O app mostra um QR code para confirmar.
2. Gere a API key do número. Ela será o `WHATSAPP_TOKEN`.

Ao ativar a coexistência, o app deixa de ter listas de transmissão, mensagens temporárias, visualização única e localização em tempo real nas conversas individuais. O app precisa ficar instalado e ser aberto de tempos em tempos.

### 2. Publicar o robô no Cloudflare

```bash
cd whatsapp-bot
npm install
npx wrangler login
npx wrangler secret put WHATSAPP_TOKEN      # API key da 360dialog
npx wrangler secret put ANTHROPIC_API_KEY   # chave da API do Claude (console.anthropic.com)
npx wrangler secret put WEBHOOK_KEY         # uma senha longa qualquer, inventada por você
```

Em `wrangler.toml`, preencha:
- `NOTIFY_TO`: WhatsApp pessoal da Nayara, só números com 55 e o DDD. Ele não pode ser o número do escritório.
- `ALLOWED_NUMBERS`: por enquanto, só o seu número, para testar sem atender clientes reais.

Depois publique:

```bash
npx wrangler deploy
```

O comando mostra o endereço do robô, algo como `https://nt-whatsapp-bot.SEU-USUARIO.workers.dev`.

### 3. Apontar o webhook da 360dialog para o robô

```bash
curl -X POST https://waba-v2.360dialog.io/v1/configs/webhook \
  -H "D360-API-KEY: SUA_API_KEY" -H "Content-Type: application/json" \
  -d '{"url": "https://nt-whatsapp-bot.SEU-USUARIO.workers.dev/webhook?chave=SUA_WEBHOOK_KEY"}'
```

Confirme com a 360dialog que as mensagens enviadas pelo app ("message echoes" / `smb_message_echoes`) também chegam nesse webhook. Sem elas, o robô não percebe quando a Nayara assume uma conversa pelo celular.

### 4. Testar e liberar

1. Do número que está em `ALLOWED_NUMBERS`, mande "oi" para o escritório e simule um caso até o fim. Confira o aviso no WhatsApp da Nayara.
2. Responda uma conversa pelo app e confira que o robô para de responder nela.
3. Para liberar para todos, deixe `ALLOWED_NUMBERS = ""` e rode `npx wrangler deploy` de novo.

### Aviso fora da janela de 24h (recomendado)

O WhatsApp só entrega texto livre para quem escreveu ao número do escritório nas últimas 24h. Para o aviso chegar sempre, crie um modelo de mensagem na categoria **Utilidade**, por exemplo com o nome `novo_contato_pix`:

> Novo contato do golpe do Pix: {{1}}. Prioridade: {{2}}. {{3}}

Depois que a Meta aprovar, preencha `NOTIFY_TEMPLATE = "novo_contato_pix"` e publique de novo.

### Usando a Cloud API direta da Meta (sem 360dialog)

Esse caminho só serve se o número sair do app WhatsApp Business. Nesse caso:
- use `WHATSAPP_PROVIDER = "meta"` e `PHONE_NUMBER_ID`;
- cadastre os segredos `WHATSAPP_TOKEN` (token permanente de usuário do sistema), `APP_SECRET` e `VERIFY_TOKEN`;
- cadastre o webhook `https://.../webhook` no app da Meta, assinando o campo `messages`.

## Custos aproximados

- **Claude:** alguns centavos de dólar por conversa de triagem. O modelo pode ser trocado em `CLAUDE_MODEL`.
- **Meta:** responder a quem escreveu primeiro é gratuito. O aviso por modelo de Utilidade custa centavos.
- **360dialog:** mensalidade do plano.
- **Cloudflare:** o plano gratuito atende o volume esperado.

## Desenvolvimento

```bash
npm test   # testes sem internet, com WhatsApp e Claude simulados
```
