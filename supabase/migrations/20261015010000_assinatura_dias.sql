-- Guarda na própria assinatura quantos dias de acesso foram comprados.
--
-- O preço e a duração de cada plano ficam num segredo das funções (PLANOS) e podem mudar com o
-- tempo. Gravando os dias no momento da compra, o webhook calcula o fim do acesso pelo que o aluno
-- de fato comprou, mesmo que o plano seja alterado ou retirado depois.
alter table public.assinaturas
  add column dias integer check (dias > 0);

-- As funções de servidor usam o papel service_role. Como o projeto não expõe tabelas novas
-- sozinho, o acesso dele também é dado de forma explícita (não muda nada se já existir).
grant select, insert, update, delete on public.perfis, public.dados_aluno, public.assinaturas to service_role;
grant usage, select on sequence public.assinaturas_id_seq to service_role;
