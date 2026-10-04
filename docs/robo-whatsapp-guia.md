# Guia do robô de WhatsApp (campanha golpe do Pix)

Guia para o escritório: o que foi montado, onde fica cada coisa, como manter e como repetir em outra campanha. A parte técnica está em [`whatsapp-bot/README.md`](../whatsapp-bot/README.md).

> **Este repositório é público.** Não coloque aqui senhas, tokens, chaves, PIN nem e-mails. Eles ficam num gerenciador de senhas (Bitwarden, 1Password ou o do Google), com um item para cada um. Este guia só diz onde cada coisa está.

## 1. Como funciona, em uma página

```
Anúncio (Meta)  ──►  WhatsApp do robô  ──►  robô (Cloudflare + Claude)
                     +55 17 99772-2969          │
                                                ├─► faz as perguntas da triagem
                                                ├─► avisa a Nayara: resumo no (31) 99693-6688
                                                └─► passa ao cliente o número e o cartão de contato do escritório
Cliente  ──►  chama a Nayara no (31) 99693-6688, já triado
```

- **O robô:**
  - se apresenta como assistente virtual;
  - não dá parecer, não promete resultado e não fala de honorários;
  - nunca pede senha nem pagamento.
- **Quando ele avisa a Nayara na hora:** quando a pessoa pede atendimento humano, quer contratar, pergunta de honorários ou está em situação urgente.
- **O WhatsApp da Nayara** continua no app normal, sem robô. O robô **ignora** mensagens vindas do (31) 99693-6688.
- **Depois da triagem**, se a pessoa voltar a escrever para o robô, ele manda de novo o contato do escritório, no máximo uma vez a cada 6 horas.
- **Sem links.** No fim, o robô escreve o número por extenso e manda o cartão de contato do WhatsApp. Quem acabou de cair num golpe desconfia de links.

## 2. Mapa das contas

| Serviço | Para que serve | Onde fica / como entrar | Dados (não são senhas) |
|---|---|---|---|
| **Meta – portfólio empresarial** | Dono do app, do número e dos anúncios | business.facebook.com, com o **Facebook pessoal da Nayara** ("Nayara Alves Tonete"). Não use o login do Instagram: ele pede verificação num e-mail antigo. | Portfólio "Nayara Karina" |
| **Meta – app** | Liga o número ao robô | developers.facebook.com/apps, app **NT Advocacia Robo** (publicado) | – |
| **Meta – conta do WhatsApp** | Conta WhatsApp Business do robô | WhatsApp Manager: business.facebook.com/wa/manage/phone-numbers | Conta "NT Advocacia", ID 29028500753400413 |
| **Meta – número do robô** | Número que recebe os clientes da campanha | Chip do número (17) 99772-2969. **Nunca** ative WhatsApp nesse chip, senão o número sai da API. | ID do número 1257704010769958 |
| **Meta – usuário do sistema** | "Dono" do token permanente | business.facebook.com/settings/system-users, usuário **robo-whatsapp** | – |
| **Cloudflare** | Onde o robô roda | dash.cloudflare.com, com o Gmail da Nayara. Worker **nt-whatsapp-bot**. | Subdomínio `nayaraktonete.workers.dev`, Account ID no `wrangler.toml` |
| **Anthropic (Claude)** | A IA que conversa | console.anthropic.com (platform.claude.com), organização **NT Advocacia**, chave **robo-whatsapp** | Crédito pré-pago |
| **GitHub** | Código, site e publicação automática | github.com/nttonete/Tonete | 5 segredos em Settings > Secrets and variables > Actions |
| **Site** | Página de privacidade exigida pela Meta | nttonete.github.io/Tonete/privacidade/ | – |

## 3. Segredos (guardar no gerenciador de senhas)

| Nome no GitHub | O que é | Onde gerar de novo |
|---|---|---|
| `WHATSAPP_TOKEN` | Token permanente da Meta (começa com "EAA") | Meta > Configurações do negócio > Usuários do sistema > robo-whatsapp > Gerar token. App NT Advocacia Robo, validade **Nunca**, permissões `whatsapp_business_messaging`, `whatsapp_business_management` e `business_management`. |
| `APP_SECRET` | Chave secreta do app (32 caracteres) | developers.facebook.com > NT Advocacia Robo > Configurações do app > Básico > Chave secreta do app > Mostrar |
| `VERIFY_TOKEN` | Senha de conferência do webhook (a mesma cadastrada na Meta) | Vocês inventam. Se trocar, troque também na Meta, em Configurar webhooks. |
| `ANTHROPIC_API_KEY` | Chave da IA (começa com "sk-ant-") | Claude Console > Chaves de API > Criar chave |
| `CLOUDFLARE_API_TOKEN` | Permite ao GitHub publicar o robô (começa com "cfut_") | dash.cloudflare.com/profile/api-tokens > Edit Cloudflare Workers > … > Roll |

Guarde também o **PIN de 6 dígitos** do número do robô, usado no registro. A Meta pede esse PIN se o número for registrado de novo.

**Ao trocar qualquer segredo no GitHub, é preciso publicar de novo:** github.com/nttonete/Tonete/actions/workflows/robo.yml > **Run workflow**.

## 4. Links do dia a dia

- **Diagnóstico** (últimas ocorrências do robô, sem conteúdo das conversas):
  `https://nt-whatsapp-bot.nayaraktonete.workers.dev/diagnostico?chave=VERIFY_TOKEN`
- **Zerar uma conversa de teste**, apagando a conversa de quem mandou a última mensagem:
  `…/diagnostico?chave=VERIFY_TOKEN&zerar=ultimo`
- **O robô está no ar?** Abra `https://nt-whatsapp-bot.nayaraktonete.workers.dev/saude`. Deve aparecer "ok".
- **Publicações do robô:** github.com/nttonete/Tonete/actions

**Como ler o diagnóstico** (as linhas mais novas ficam no topo):

| Aparece | Significa |
|---|---|
| "mensagem recebida" → "gerando resposta" → "resposta enviada ao cliente" | Tudo funcionando |
| "webhook recusado: assinatura inválida" | `APP_SECRET` errado no GitHub |
| "erro ao enviar… WHATSAPP_TOKEN tem caractere inválido" ou "Invalid header value" | Token da Meta colado errado. Gere outro e cole pelo botão **Copiar**. |
| "erro ao gerar resposta (Claude)" | Chave da Anthropic errada ou **sem crédito** |
| "robô em silêncio: triagem já encaminhada…" | Normal: a pessoa já foi passada para a Nayara. Em teste, use o zerar. |
| Nada aparece depois de mandar mensagem | A Meta não está entregando. Confira o webhook e a chave "Assinar webhooks" na Meta. |

## 5. Rotina de manutenção

- **Crédito da Anthropic:** confira uma vez por semana no Claude Console, ou ative a **recarga automática**. Sem crédito, o robô para de responder e o diagnóstico mostra "erro ao gerar resposta".
- **Validade da chave da Anthropic:** confira em Chaves de API. Se foi criada com validade, anote a data para trocar antes de vencer.
- **Aviso para a Nayara:**
  - Hoje o aviso de novo caso vai como texto livre. O WhatsApp só entrega texto livre se o (31) 99693-6688 tiver mandado alguma mensagem para o número do robô nas últimas 24h.
  - Até existir um modelo aprovado, mande um "oi" do WhatsApp da Nayara para o (17) 99772-2969 **uma vez por dia**. O robô ignora essa mensagem de propósito.
  - A solução definitiva é o modelo de Utilidade (seção 7).
- **Mudar o texto ou as regras do robô:**
  1. No GitHub, abra `whatsapp-bot/src/prompt.js`, clique no lápis, edite e salve com "Commit changes".
  2. A publicação é automática.
  3. Ou peça ao Claude numa sessão deste repositório.
- **Se o robô parar de responder:** abra o diagnóstico e veja a tabela da seção 4.

## 6. Problemas que já enfrentamos (e a solução)

| Problema | Causa | Solução |
|---|---|---|
| developers.facebook.com mostrava "conteúdo não disponível" ou "WorkPlatform" | Login com a conta empresarial ou do Instagram, e não com o Facebook pessoal | Sair e entrar com o Facebook pessoal da Nayara |
| "Nenhuma configuração disponível" no Explorador da API | Apps novos da Meta não geram token de usuário ali | Usar o token do **usuário do sistema** (robo-whatsapp) colado no Explorador |
| Botão "Registrar" do número dava erro genérico | Falha do painel | Registrar pelo Explorador da API: POST `1257704010769958/register?messaging_product=whatsapp&pin=XXXXXX` |
| Verificação pedia código num e-mail sem acesso | O e-mail antigo estava no perfil do **Instagram** | Gerar o token logado pelo Facebook pessoal, em que a verificação usa o Gmail atual |
| "Assinar webhooks" dava "Falha na inscrição" | O webhook ainda não estava configurado | Primeiro "Configurar webhooks" (URL + verify token), depois ligar a chave |
| Publicação do robô falhou com "Invalid format for Authorization header" | Token do Cloudflare colado com o comando `curl` junto | Gerar outro (Roll) e copiar só o token |
| Webhook "assinatura inválida" | `APP_SECRET` com o valor errado | Copiar de novo a Chave secreta do app |
| Resposta gerada, mas não enviada ("Invalid header value") | `WHATSAPP_TOKEN` com caractere errado no meio | Gerar token novo, copiar pelo botão e conferir no Bloco de Notas antes de colar |
| Depois de consertar, o robô encaminhou para a Nayara logo de cara | Respostas que falharam tinham ficado no histórico | Corrigido: o histórico só guarda o que foi entregue |
| Celular dizia "não está no WhatsApp" | O aparelho guardava a conta antiga daquele chip | Apagar a conversa e o contato antigos, ou testar de outro aparelho |
| "Zerar" não surtia efeito | O WhatsApp informa o número sem o 9 extra (12 dígitos) | Usar `zerar=ultimo` |
| Mensagens enviadas do (31) 99693-6688 não tinham resposta | O robô ignora o número da Nayara de propósito | Testar de outro número |

## 7. Pendências

- [ ] **Trocar o número na campanha da Meta**:
  1. Conectar o (17) 99772-2969 à página do Facebook.
  2. No Gerenciador de Anúncios, **duplicar** o conjunto de anúncios da campanha do Pix e escolher o número do robô.
  3. Pausar o conjunto antigo quando o novo estiver entregando.
- [ ] **Modelo de mensagem "Utilidade"** para o aviso à Nayara (ex.: `novo_contato_pix`). Depois de aprovado, preencher `NOTIFY_TEMPLATE` no `whatsapp-bot/wrangler.toml`.
- [ ] **Foto de perfil** do número do robô, em WhatsApp Manager > Números de telefone > Perfil.
- [ ] **Verificação da empresa** na Meta (Central de segurança), que aumenta os limites e dá mais credibilidade.
- [ ] **Segundo administrador** no portfólio da Meta, na Anthropic e no Cloudflare, para o escritório não depender de um único login.
- [ ] **Trocar a senha do Instagram**, que apareceu num print durante a configuração.
- [ ] **Recarga automática** de crédito na Anthropic.

## 8. Como repetir para outra campanha

O caminho mais simples é **outro número e outra cópia do robô**:

1. **Número novo:** um chip ou fixo **sem WhatsApp**. Adicione-o à mesma conta do WhatsApp em developers.facebook.com > NT Advocacia Robo > WhatsApp > Configuração da produção > Adicionar número. Sem a verificação da empresa, o limite é de 2 números.
2. **Registrar o número** pelo Explorador da API, como na seção 6, e guardar o PIN.
3. **Pedir ao Claude**, numa sessão deste repositório: "criar uma cópia do robô para a campanha X". Ele cria outra pasta com as instruções da nova campanha (`prompt.js`), outro nome de Worker e outro webhook.
4. **Webhook:** um app da Meta tem um só endereço de webhook. Para um segundo robô, o mais simples é o mesmo robô atender os dois números e escolher as instruções pelo número que recebeu a mensagem. Peça isso ao Claude.
5. **Testar** com o diagnóstico e o `zerar=ultimo` antes de trocar o número no anúncio.
