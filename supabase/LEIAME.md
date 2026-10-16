# Backend (Supabase)

Projeto `banca-aberta`, região São Paulo (sa-east-1), código `egfglvvjdnrxjsikespe`.

## Situação

O código está pronto e testado, mas **ainda não foi aplicado no projeto**. Duas tentativas em 16/10/2026:

1. O `SUPABASE_ACCESS_TOKEN` do ambiente de nuvem estava vazio.
2. Com o token preenchido, o Supabase recusou (erro 403). O token é válido, mas a conta que o gerou só é dona de uma organização `banca-aberta` **sem nenhum projeto**. O projeto `egfglvvjdnrxjsikespe` existe, mas está em outra conta ou organização. Solução: gerar o token entrando no supabase.com com a conta que criou o projeto, ou convidar a conta do token para a organização do projeto (papel Owner ou Administrator).

Sem um token com acesso ao projeto, nada pode ser feito nele (banco, funções, segredos). Para conferir, `node supabase/aplicar_migracoes.mjs --conferir` lista as migrações; se o acesso faltar, ele diz quais projetos o token enxerga. Veja "Como colocar no ar".

O ambiente de nuvem só sai para a internet por HTTPS: não conecta direto no Postgres (porta 5432). Por isso, lá a senha do banco sozinha não basta e o `supabase db push` não funciona; use `supabase/aplicar_migracoes.mjs`, que faz o mesmo pela API.

## O que existe

### Banco (`migrations/`)

| Arquivo | O que faz |
|---|---|
| `20261015000000_inicial.sql` | Tabelas `perfis`, `dados_aluno` e `assinaturas`, regras por aluno (RLS) e `tem_acesso()` |
| `20261015010000_assinatura_dias.sql` | Coluna `dias` na assinatura (a duração comprada fica gravada) e acesso explícito do papel do servidor (`service_role`) às tabelas |

| Tabela | Para quê | Quem escreve |
|---|---|---|
| `perfis` | Nome, nascimento, responsável (menores), versão e data de aceite dos Termos e da Privacidade | Criado sozinho junto com a conta; o aluno pode corrigir o próprio |
| `dados_aluno` | O que fica no localStorage: `historico`, `sessao`, `plano`, `obras-lidas`, `redacoes` | O próprio aluno |
| `assinaturas` | Pagamentos do Mercado Pago (status, valor, dias, início e fim) | Só o servidor (funções) |

Segurança: RLS em todas as tabelas (cada aluno só vê o que é dele) e nenhuma tabela exposta sem `grant` explícito. Excluir a conta apaga perfil, dados e assinaturas em cascata.

Testado num Postgres 16 local com as partes do Supabase simuladas: as duas migrações entram sem erro, aluno não lê nem grava dados de outro, não grava assinatura, `tem_acesso()` responde certo e a exclusão apaga tudo.

### Funções de servidor (`functions/`)

Escritas sem bibliotecas de fora (só `fetch` e `crypto`). Cada uma tem `index.ts` (entrada no Deno) e `tratar.ts` (a lógica, testável no Node).

| Função | O que faz |
|---|---|
| `mp-checkout` | `GET`: planos à venda (nome, preço total, dias). `POST {plano}`: cria a assinatura `pendente` e a preferência do Checkout Pro; devolve o endereço de pagamento. Exige login |
| `mp-webhook` | Recebe o aviso do Mercado Pago, confere a assinatura do aviso (`x-signature`), **consulta o pagamento na API do Mercado Pago** e atualiza a assinatura. Aprovado: ativa por `dias` (se já houver acesso ativo, começa quando ele termina). Devolvido ou estornado: encerra o acesso. Valor diferente do combinado: não ativa |
| `excluir-conta` | Apaga a conta de quem está logado (com a confirmação "EXCLUIR"); o resto vai em cascata |

A cópia dos dados ("Baixar meus dados") não precisa de função: o próprio site lê, com o login do aluno, o perfil, os dados de estudo e as assinaturas.

Compra: pagamento único, **sem renovação automática**. A tela mostra o preço total, a duração e o direito de arrependimento de 7 dias. A devolução é feita pelo painel do Mercado Pago; o aviso de devolução encerra o acesso sozinho.

### No site (`app/config.js`, `app/nuvem.js` e a tela "Conta" em `app/app.js`)

- **Login:** e-mail e senha, link de acesso por e-mail e "esqueci a senha". Cadastro com nome, nascimento e aceite dos Termos e da Privacidade; de 12 a 17 anos pede nome e e-mail do responsável; abaixo de 12, o cadastro não é aceito (ver Pendências).
- **Sincronização:** o aparelho continua sendo a fonte do dia a dia e funciona sem internet. Cada gravação marca a chave como pendente e sobe 3 s depois (ou quando a internet volta). Na leitura, se só a conta mudou, o aparelho recebe; se só o aparelho mudou, a conta recebe; se os dois mudaram, junta: histórico e obras lidas somam os dois lados, redações ficam com a versão editada por último, o plano fica com o criado por último (somando as tarefas feitas) e a prova em andamento fica com a começada por último. O envio só vale se a conta não mudou desde a leitura (`atualizado_em`); se mudou, lê e junta de novo.
- Ao entrar pela primeira vez, o que foi feito no aparelho sem conta vai para a conta. Ao sair, os dados de estudo são apagados do aparelho (continuam na conta); se algo ainda não subiu, a tela avisa antes.
- **Sem a chave em `app/config.js`, nada disso aparece** e a plataforma não faz nenhum pedido ao servidor (é assim que está hoje e na prévia).

### Testes

```
node --test supabase/testes/*.test.ts     # funções de servidor (16 testes, sem rede)
node testes/nuvem.js                       # conta e sincronização no Chromium, com Supabase simulado
node testes/navegador.js                   # plataforma inteira (continua passando)
```

Os dois testes de navegador precisam de `PLAYWRIGHT_PATH=$(npm root -g)/playwright`.

## Como colocar no ar

1. **Token:** em supabase.com, Account → Access Tokens, gere um token pessoal (começa com `sbp_`) e coloque-o como `SUPABASE_ACCESS_TOKEN` nas variáveis do ambiente de nuvem. A senha do banco (`SUPABASE_DB_PASSWORD`) só é usada no caminho do CLI do passo 2.
2. **Banco:**
   ```
   node supabase/aplicar_migracoes.mjs --conferir   # mostra o que falta aplicar
   node supabase/aplicar_migracoes.mjs              # aplica
   ```
   O script usa só o token pessoal e HTTPS, então funciona no ambiente de nuvem. Cada migração entra inteira ou não entra, e fica registrada no mesmo histórico do CLI. Num computador com acesso direto ao banco, o caminho do CLI também serve: `npx supabase link --project-ref egfglvvjdnrxjsikespe` e `npx supabase db push` (pede a senha do banco).
3. **Segredos das funções** (nunca no código nem no site):
   ```
   npx supabase secrets set --project-ref egfglvvjdnrxjsikespe MP_ACCESS_TOKEN=... MP_WEBHOOK_SECRET=... SITE_URL=https://endereco-do-site/ \
     PLANOS='{"lancamento":{"nome":"Preço de lançamento: 3 meses de acesso","centavos":4900,"dias":92}}'
   ```
   - `MP_ACCESS_TOKEN`: Mercado Pago → Suas integrações → Credenciais (use as de teste primeiro).
   - `MP_WEBHOOK_SECRET`: Suas integrações → Webhooks. Cadastre a URL `https://egfglvvjdnrxjsikespe.supabase.co/functions/v1/mp-webhook`, evento "Pagamentos", e copie a "assinatura secreta".
   - `PLANOS`: preço em centavos e duração em dias. Plano definido: **preço de lançamento, R$ 49,00 por 3 meses**. São 92 dias, para cobrir 3 meses de calendário em qualquer época do ano (o sistema conta o acesso em dias). Sem esse segredo, a tela mostra "A venda ainda não está aberta". Para mudar o preço depois, basta trocar o segredo, sem mexer no código; quem já comprou mantém o que pagou.
4. **Funções:**
   ```
   npx supabase functions deploy mp-checkout --project-ref egfglvvjdnrxjsikespe --use-api
   npx supabase functions deploy mp-webhook --project-ref egfglvvjdnrxjsikespe --use-api      # o config.toml desliga a exigência de login só nesta
   npx supabase functions deploy excluir-conta --project-ref egfglvvjdnrxjsikespe --use-api
   ```
5. **Login:** no painel, Authentication → URL Configuration: "Site URL" e "Redirect URLs" com o endereço do site (os links de e-mail voltam para lá). Ative a confirmação de e-mail e, de preferência, um SMTP próprio com remetente da Banca Aberta (o padrão do Supabase tem limite baixo de envios).
6. **Site:** em `app/config.js`, preencha `supabaseChave` com a chave **pública** do projeto (Settings → API Keys → "publishable" ou "anon"). Depois rode `python3 ferramentas/gerar_index.py`.
7. Teste uma compra com as credenciais de teste do Mercado Pago antes de trocar pelas de produção.

## Pendências (decisão humana)

- **Fim do preço de lançamento:** decidir até quando vale e qual será o preço depois. Se a página de compra disser que é preço de lançamento, convém informar a data em que ele acaba (Código de Defesa do Consumidor).
- **Bloqueio do conteúdo:** hoje tudo continua aberto para quem não assina. Falta decidir o que fica grátis; `tem_acesso()` e `Nuvem.temAcesso()` já respondem.
- **Registros de compra na exclusão da conta:** a exclusão apaga também as assinaturas (cascata), mas a Política diz que dados de compra ficam pelo prazo legal. Decidir com o advogado se os pagamentos devem ser guardados à parte (sem o vínculo com o aluno) antes de apagar.
- **Menores de 12 anos:** o cadastro recusa. Aceitar exige um fluxo de consentimento do responsável (por exemplo, o responsável confirma por e-mail).
- **Versão dos termos:** o aceite grava `2026-10-15-rascunho`; trocar em `app/app.js` (`VERSAO_TERMOS`, `VERSAO_PRIVACIDADE`) quando o texto final for aprovado.
- Correção por IA (ainda sem provedor escolhido).
