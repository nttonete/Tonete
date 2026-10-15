# Backend (Supabase)

Projeto `banca-aberta`, região São Paulo (sa-east-1), código `egfglvvjdnrxjsikespe`.

## O que existe

`migrations/20261015000000_inicial.sql` cria:

| Tabela | Para quê | Quem escreve |
|---|---|---|
| `perfis` | Nome, nascimento, responsável (menores), versão e data de aceite dos Termos e da Privacidade | Criado sozinho junto com a conta; o aluno pode corrigir o próprio |
| `dados_aluno` | O que hoje fica no localStorage: `historico`, `sessao`, `plano`, `obras-lidas`, `redacoes` | O próprio aluno |
| `assinaturas` | Pagamentos do Mercado Pago (status, valor, início e fim) | Só o servidor (webhook) |

`tem_acesso()` responde se o aluno logado tem assinatura ativa.

Segurança: RLS em todas as tabelas (cada aluno só vê o que é dele) e nenhuma tabela exposta sem `grant` explícito. Excluir a conta apaga perfil, dados e assinaturas em cascata (exclusão a pedido do titular, LGPD).

Testado num Postgres 16 local com as partes do Supabase simuladas: aluno não lê nem grava dados de outro, não grava assinatura e não muda o perfil de outro.

## Como aplicar

Com `SUPABASE_ACCESS_TOKEN` no ambiente e `api.supabase.com` liberado na rede:

```
npx supabase link --project-ref egfglvvjdnrxjsikespe
npx supabase db push
```

## Próximos passos

1. Login e cadastro na plataforma (e-mail e senha ou link mágico), com data de nascimento e dados do responsável para menores.
2. Sincronizar o localStorage com `dados_aluno` (o aparelho continua funcionando sem internet).
3. Função de servidor `mp-checkout` (cria a preferência no Checkout Pro) e `mp-webhook` (confirma o pagamento e grava em `assinaturas`). O token do Mercado Pago fica só como segredo das funções (`MP_ACCESS_TOKEN`), nunca no site.
4. Função de exclusão de conta e de exportação dos dados (direitos do titular).
