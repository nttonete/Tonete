-- Tira das funções de gatilho a permissão de execução dada a todos por padrão.
--
-- O alerta de segurança do Supabase apontava criar_perfil() (security definer) como executável
-- por anon e authenticated via /rest/v1/rpc. Na prática uma função de gatilho não pode ser chamada
-- direto, mas fechar a permissão deixa o painel limpo e evita surpresa se alguém mudar a função.
-- Os gatilhos continuam funcionando: o Postgres só confere essa permissão ao criar o gatilho.
revoke execute on function public.criar_perfil() from public, anon, authenticated;
revoke execute on function public.marcar_atualizacao() from public, anon, authenticated;
