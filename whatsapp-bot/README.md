# Atendimento automático do WhatsApp (golpe do Pix)

Robô de triagem para a campanha de golpe do Pix. Ele funciona num número de WhatsApp só dele, e os anúncios dessa campanha apontam para esse número. O WhatsApp da Nayara continua como está, sem robô.

## O que o robô faz

1. Responde na hora, a qualquer hora, e se apresenta como assistente virtual do escritório da advogada Nayara Tonete.
2. Acolhe a pessoa e reúne as informações do caso:
   - o que aconteceu e quando;
   - o valor e o banco;
   - se já contestou no banco (MED);
   - se fez B.O. e se tem os comprovantes.
3. Avisa a Nayara com um resumo e manda para a pessoa um link do WhatsApp do escritório, com uma mensagem pronta. É a própria pessoa que chama a Nayara, já triada.

Ele também avisa na hora quando a pessoa pede atendimento humano, quer contratar, pergunta sobre honorários ou quando o caso é urgente.

As regras da OAB estão nas instruções do robô (`src/prompt.js`):
- não dá parecer nem promete resultado;
- não fala de honorários;
- nunca pede senha nem pagamento;
- não cita leis nem decisões.

Para mudar o tom ou as perguntas, edite esse arquivo e publique de novo.

## Como funciona

- **Mensagens em sequência.** Quem manda várias mensagens seguidas recebe uma só resposta. O robô espera 8 segundos sem mensagem nova antes de responder.
- **Depois da triagem.** Se a pessoa voltar a escrever no número do robô, recebe de novo o link do escritório, no máximo uma vez a cada 6 horas. Depois de 30 dias sem contato, uma nova mensagem começa uma triagem nova.
- **Áudios, fotos e documentos.** O robô ainda não ouve áudios nem lê imagens. Ele pede que a pessoa escreva.
- **Se a IA falhar.** O robô tenta 3 vezes. Se não conseguir, pede desculpas, manda o link do escritório e avisa a Nayara.
- **Anúncio de origem.** Contatos que vêm de anúncio de WhatsApp da Meta chegam com o título do anúncio. O robô usa isso como contexto.
- **Onde roda.** Num Cloudflare Worker, com um Durable Object por cliente guardando o histórico. As respostas são geradas pelo Claude (Anthropic).

## Nada funciona sozinho

O robô só começa a atender quando as quatro etapas abaixo estiverem feitas. Mesmo publicado, ele fica em modo de teste (`ALLOWED_NUMBERS`) e só responde aos números liberados, até vocês liberarem para todos.

## Colocando no ar

### 1. Número novo na API da Meta

Você precisa de um chip novo ou de um telefone fixo que **não** esteja no WhatsApp e que receba SMS ou ligação para o código de verificação.

1. Em developers.facebook.com, crie um app do tipo **Empresa**, vinculado ao Gerenciador de Negócios do escritório (o mesmo da campanha), e adicione o produto **WhatsApp**.
2. No WhatsApp Manager (business.facebook.com), adicione o número novo:
   - nome de exibição "NT Advocacia" ou parecido, que passa por aprovação da Meta;
   - verificação por SMS ou ligação.
3. Cadastre um cartão de pagamento no WhatsApp Manager. Ele só é usado nos avisos por modelo, e responder clientes é gratuito.
4. Anote o **ID do número de telefone** e o **ID da conta do WhatsApp Business**. Ficam no app, em WhatsApp > Configuração da API.
5. Crie um token permanente:
   1. Em Configurações do negócio > Usuários do sistema, crie um usuário administrador.
   2. Atribua a ele o app e a conta do WhatsApp.
   3. Gere um token com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
6. Ative o número na API, escolhendo um PIN de 6 dígitos:

```bash
curl -X POST "https://graph.facebook.com/v23.0/ID_DO_NUMERO/register" \
  -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: application/json" \
  -d '{"messaging_product": "whatsapp", "pin": "123456"}'
```

### 2. Publicar o robô no Cloudflare

Em `wrangler.toml`, preencha:
- `PHONE_NUMBER_ID`: o ID do número.
- `ALLOWED_NUMBERS`: por enquanto, só os números de vocês, para testar sem atender clientes reais.
- `NUMERO_ESCRITORIO` e `NOTIFY_TO`: já estão com o WhatsApp do escritório, 5531996936688. O aviso de cada caso chega do número do robô para esse número.

```bash
cd whatsapp-bot
npm install
npx wrangler login
npx wrangler secret put WHATSAPP_TOKEN      # token permanente do passo 1
npx wrangler secret put APP_SECRET          # app da Meta > Configurações > Básico > Chave secreta do app
npx wrangler secret put VERIFY_TOKEN        # uma senha qualquer, inventada por você
npx wrangler secret put ANTHROPIC_API_KEY   # chave da API do Claude (console.anthropic.com)
npx wrangler deploy
```

O último comando mostra o endereço do robô, algo como `https://nt-whatsapp-bot.SEU-USUARIO.workers.dev`.

### 3. Ligar o webhook

1. No app da Meta, em WhatsApp > Configuração > Webhook, preencha:
   - URL de retorno de chamada: `https://nt-whatsapp-bot.SEU-USUARIO.workers.dev/webhook`
   - Token de verificação: o mesmo `VERIFY_TOKEN`
2. Assine o campo **messages**.
3. Inscreva o app na conta do WhatsApp:

```bash
curl -X POST "https://graph.facebook.com/v23.0/ID_DA_CONTA_WHATSAPP/subscribed_apps" \
  -H "Authorization: Bearer SEU_TOKEN"
```

4. Mande "oi" para o número do robô a partir de um número liberado. Simule um caso até o fim e confira o aviso no WhatsApp do escritório e o link final.

### 4. Trocar o número na campanha (Meta)

1. Conecte o número do robô à página do Facebook que assina os anúncios. O caminho é Configurações da página > Contas vinculadas > WhatsApp.
2. No Gerenciador de Anúncios, **duplique** o conjunto de anúncios da campanha do golpe do Pix e escolha o número do robô em "Local da conversão: WhatsApp". Editar o anúncio ativo manda ele para revisão e pode zerar o aprendizado.
3. Na mensagem de boas-vindas do anúncio, deixe só o texto pronto do cliente, como "Olá, quero ajuda com um golpe do Pix". O robô faz o resto.
4. Libere o robô para todos: `ALLOWED_NUMBERS = ""` e `npx wrangler deploy`.
5. Publique o novo conjunto e pause o antigo quando o novo começar a entregar.

### Aviso fora da janela de 24h (recomendado)

O WhatsApp só entrega texto livre para quem escreveu ao número do robô nas últimas 24h. Para o aviso chegar sempre ao escritório:

1. Crie um modelo de mensagem na categoria **Utilidade**, por exemplo com o nome `novo_contato_pix`:

   > Novo contato do golpe do Pix: {{1}}. Prioridade: {{2}}. {{3}}

2. Depois que a Meta aprovar, preencha `NOTIFY_TEMPLATE = "novo_contato_pix"` e publique de novo.

Enquanto o modelo não existir, uma alternativa é o escritório mandar um "oi" para o número do robô uma vez por dia. O robô ignora mensagens do número que recebe os avisos. Por isso, os testes de triagem devem ser feitos de outro número.

### Alternativa: mesmo número no app ("coexistência")

O código também funciona no número do escritório, mantendo o app, por meio da 360dialog. Para isso:
- use `WHATSAPP_PROVIDER = "360dialog"` e o segredo `WEBHOOK_KEY`;
- aponte o webhook para `.../webhook?chave=SUA_WEBHOOK_KEY`.

Nesse modo, o robô sai da conversa quando alguém responde pelo app. Não é o caminho escolhido agora.

## Custos aproximados

- **Claude:** alguns centavos de dólar por conversa de triagem. O modelo pode ser trocado em `CLAUDE_MODEL`.
- **Meta:** conversas que começam em anúncio de WhatsApp ficam gratuitas por 72h, e responder a quem escreveu é gratuito. O aviso por modelo de Utilidade custa centavos.
- **Cloudflare:** o plano gratuito atende o volume esperado.

## Desenvolvimento

```bash
npm test   # testes sem internet, com WhatsApp e Claude simulados
```
