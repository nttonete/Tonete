-- Banco inicial da Banca Aberta (Supabase, região São Paulo).
--
-- Três tabelas:
--   perfis       dados de cadastro e aceite dos termos (um por aluno);
--   dados_aluno  o que hoje fica no localStorage (histórico, plano, redações...), guardado por chave;
--   assinaturas  pagamentos do Mercado Pago. Só o servidor (função de webhook) escreve aqui.
--
-- Regra geral: cada aluno lê e altera só os próprios dados (RLS). Nada é exposto sem um "grant"
-- explícito, porque o projeto foi criado com "Automatically expose new tables" desligado.

-- ---------------------------------------------------------------- perfis
create table public.perfis (
  id                   uuid primary key references auth.users (id) on delete cascade,
  nome                 text,
  nascimento           date,
  -- menores de 18: contato do responsável (Política de Privacidade, seção 8)
  responsavel_nome     text,
  responsavel_email    text,
  termos_versao        text,
  termos_aceitos_em    timestamptz,
  privacidade_versao   text,
  privacidade_aceita_em timestamptz,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);

alter table public.perfis enable row level security;

create policy "aluno lê o próprio perfil" on public.perfis
  for select to authenticated using (id = (select auth.uid()));
create policy "aluno altera o próprio perfil" on public.perfis
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

grant select, update on public.perfis to authenticated;

-- O perfil nasce junto com a conta, com o que o formulário de cadastro mandou em "data".
create function public.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfis (id, nome, nascimento, responsavel_nome, responsavel_email,
                             termos_versao, termos_aceitos_em, privacidade_versao, privacidade_aceita_em)
  values (
    new.id,
    new.raw_user_meta_data ->> 'nome',
    nullif(new.raw_user_meta_data ->> 'nascimento', '')::date,
    new.raw_user_meta_data ->> 'responsavel_nome',
    new.raw_user_meta_data ->> 'responsavel_email',
    new.raw_user_meta_data ->> 'termos_versao',
    case when new.raw_user_meta_data ? 'termos_versao' then now() end,
    new.raw_user_meta_data ->> 'privacidade_versao',
    case when new.raw_user_meta_data ? 'privacidade_versao' then now() end
  );
  return new;
end;
$$;

create trigger ao_criar_conta
  after insert on auth.users
  for each row execute function public.criar_perfil();

-- ---------------------------------------------------------------- dados_aluno
-- Espelho do localStorage: uma linha por aluno e por chave. As chaves são as mesmas do app.js,
-- sem o prefixo "banca-aberta:". A sessão em andamento (sessao) também sobe, para continuar a
-- prova em outro aparelho.
create table public.dados_aluno (
  user_id        uuid not null references auth.users (id) on delete cascade,
  chave          text not null check (chave in ('historico', 'sessao', 'plano', 'obras-lidas', 'redacoes')),
  valor          jsonb not null,
  atualizado_em  timestamptz not null default now(),
  primary key (user_id, chave)
);

alter table public.dados_aluno enable row level security;

create policy "aluno lê os próprios dados" on public.dados_aluno
  for select to authenticated using (user_id = (select auth.uid()));
create policy "aluno grava os próprios dados" on public.dados_aluno
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "aluno atualiza os próprios dados" on public.dados_aluno
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "aluno apaga os próprios dados" on public.dados_aluno
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.dados_aluno to authenticated;

-- ---------------------------------------------------------------- assinaturas
-- Escrita só pelo servidor (service_role, que ignora RLS): o webhook do Mercado Pago confirma o
-- pagamento e grava aqui. O aluno só consegue ler as próprias.
create table public.assinaturas (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users (id) on delete cascade,
  plano               text not null,
  valor_centavos      integer not null check (valor_centavos >= 0),
  status              text not null default 'pendente'
                      check (status in ('pendente', 'ativa', 'cancelada', 'reembolsada', 'expirada')),
  mp_preferencia_id   text,
  mp_pagamento_id     text unique,
  inicio              timestamptz,
  fim                 timestamptz,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create index assinaturas_user_id on public.assinaturas (user_id);

alter table public.assinaturas enable row level security;

create policy "aluno lê as próprias assinaturas" on public.assinaturas
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.assinaturas to authenticated;

-- A plataforma pergunta só "tenho acesso?", sem precisar ler a tabela inteira.
create function public.tem_acesso()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.assinaturas
    where user_id = (select auth.uid())
      and status = 'ativa'
      and (fim is null or fim > now())
  );
$$;

grant execute on function public.tem_acesso() to authenticated;

-- ---------------------------------------------------------------- atualizado_em automático
create function public.marcar_atualizacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

create trigger perfis_atualizado before update on public.perfis
  for each row execute function public.marcar_atualizacao();
create trigger dados_aluno_atualizado before update on public.dados_aluno
  for each row execute function public.marcar_atualizacao();
create trigger assinaturas_atualizado before update on public.assinaturas
  for each row execute function public.marcar_atualizacao();
