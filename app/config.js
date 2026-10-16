/* Endereço do backend (Supabase, região São Paulo).
   A chave é a pública do projeto ("publishable" ou "anon"): ela só dá a cada aluno o que as regras
   do banco permitem (os próprios dados). Nunca coloque aqui a chave secreta (service_role).
   Com a chave vazia, a plataforma funciona só no aparelho, sem conta e sem pedidos ao servidor. */
window.BancaConfig = {
  supabaseUrl: "https://egfglvvjdnrxjsikespe.supabase.co",
  supabaseChave: "",
};
