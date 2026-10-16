// Peças comuns às funções de servidor. Rodam no Deno do Supabase; os testes rodam no Node.
// Só usam recursos da web (fetch, Request, Response, crypto), sem bibliotecas de fora.

export type Ambiente = { get(nome: string): string | undefined };
export type Usuario = { id: string; email: string };
export type Plano = { id: string; nome: string; centavos: number; dias: number };

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function exigir(amb: Ambiente, nome: string): string {
  const valor = amb.get(nome);
  if (!valor) throw new Error(`falta o segredo ${nome}`);
  return valor;
}

// Confere quem está chamando: o site manda o token de login do aluno no cabeçalho Authorization.
export async function usuarioDaRequisicao(req: Request, amb: Ambiente): Promise<Usuario | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const chave = amb.get("SUPABASE_ANON_KEY") || exigir(amb, "SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${exigir(amb, "SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: chave, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: u.id, email: u.email } : null;
}

// Acesso ao banco como servidor (service_role, que ignora as regras por aluno).
export function servidor(amb: Ambiente) {
  const url = exigir(amb, "SUPABASE_URL");
  const chave = exigir(amb, "SUPABASE_SERVICE_ROLE_KEY");
  const cab = { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json" };
  return {
    async rest(caminho: string, init: RequestInit = {}): Promise<any> {
      const r = await fetch(`${url}/rest/v1/${caminho}`, { ...init, headers: { ...cab, ...(init.headers || {}) } });
      const texto = await r.text();
      if (!r.ok) throw new Error(`banco respondeu ${r.status} em ${caminho}: ${texto}`);
      return texto ? JSON.parse(texto) : null;
    },
    async apagarUsuario(id: string): Promise<void> {
      const r = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE", headers: cab });
      if (!r.ok) throw new Error(`login respondeu ${r.status} ao apagar a conta: ${await r.text()}`);
    },
  };
}

// Planos à venda, no segredo PLANOS. Exemplo:
//   {"anual": {"nome": "Banca Aberta: 12 meses de acesso", "centavos": 19900, "dias": 365}}
// Sem o segredo, a venda fica fechada.
export function lerPlanos(amb: Ambiente): Plano[] {
  const bruto = amb.get("PLANOS");
  if (!bruto) return [];
  const obj = JSON.parse(bruto);
  return Object.keys(obj).map((id) => {
    const p = obj[id];
    if (typeof p.nome !== "string" || !Number.isInteger(p.centavos) || p.centavos <= 0 || !Number.isInteger(p.dias) || p.dias <= 0) {
      throw new Error(`plano "${id}" do segredo PLANOS está incompleto (precisa de nome, centavos e dias)`);
    }
    return { id, nome: p.nome, centavos: p.centavos, dias: p.dias };
  });
}
