// Testes das funções de servidor, sem rede: Supabase e Mercado Pago são simulados.
// Uso: node --test supabase/testes/   (Node 22.18 ou mais novo, que roda TypeScript direto)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { avisoAutentico, decidir, tratar as webhook } from "../functions/mp-webhook/tratar.ts";
import { tratar as checkout } from "../functions/mp-checkout/tratar.ts";
import { tratar as excluir } from "../functions/excluir-conta/tratar.ts";

const SEGREDO = "segredo-de-teste";
const SUPA = "https://projeto.supabase.co";
const ambiente = (extra: Record<string, string> = {}) => {
  const v: Record<string, string> = {
    SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "servico",
    MP_ACCESS_TOKEN: "mp-token", MP_WEBHOOK_SECRET: SEGREDO, SITE_URL: "https://banca.exemplo/",
    PLANOS: JSON.stringify({ anual: { nome: "Acesso por 12 meses", centavos: 19900, dias: 365 } }),
    ...extra,
  };
  return { get: (n: string) => v[n] };
};

// Servidor falso: um "banco" de assinaturas em memória, o login e a API do Mercado Pago.
function simular(opcoes: { pagamentos?: Record<string, any>; assinaturas?: any[]; mpFalha?: boolean } = {}) {
  const banco = { assinaturas: (opcoes.assinaturas || []).map((a) => ({ ...a })), apagados: [] as string[], preferencias: [] as any[] };
  let proximoId = 100;
  const original = globalThis.fetch;
  globalThis.fetch = (async (entrada: any, init: any = {}) => {
    const url = new URL(String(entrada));
    const metodo = init.method || "GET";
    const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });
    if (url.origin === SUPA && url.pathname === "/auth/v1/user") {
      const tk = (init.headers.Authorization || "").replace("Bearer ", "");
      return tk === "token-aluno" ? json({ id: "u1", email: "aluno@exemplo.com" }) : json({ msg: "invalid" }, 401);
    }
    if (url.origin === SUPA && url.pathname.startsWith("/auth/v1/admin/users/")) {
      assert.equal(init.headers.Authorization, "Bearer servico");
      banco.apagados.push(url.pathname.split("/").pop()!);
      return json({});
    }
    if (url.origin === SUPA && url.pathname === "/rest/v1/assinaturas") {
      assert.equal(init.headers.Authorization, "Bearer servico");
      const f = Object.fromEntries(url.searchParams);
      const casa = (a: any) => Object.entries(f).every(([k, v]) => {
        if (["select", "order", "limit"].includes(k)) return true;
        if (v === "not.is.null") return a[k] != null;
        const [op, val] = [v.slice(0, v.indexOf(".")), v.slice(v.indexOf(".") + 1)];
        return op === "eq" ? String(a[k]) === val : op === "neq" ? String(a[k]) !== val : true;
      });
      if (metodo === "GET") {
        let l = banco.assinaturas.filter(casa);
        if (f.order === "fim.desc") l = l.sort((x, y) => (y.fim || "").localeCompare(x.fim || ""));
        return json(f.limit ? l.slice(0, Number(f.limit)) : l);
      }
      if (metodo === "POST") {
        const nova = { id: proximoId++, mp_pagamento_id: null, inicio: null, fim: null, ...JSON.parse(init.body) };
        banco.assinaturas.push(nova);
        return json([nova], 201);
      }
      if (metodo === "PATCH") { banco.assinaturas.filter(casa).forEach((a) => Object.assign(a, JSON.parse(init.body))); return new Response(null, { status: 204 }); }
      if (metodo === "DELETE") { banco.assinaturas = banco.assinaturas.filter((a) => !casa(a)); return new Response(null, { status: 204 }); }
    }
    if (url.origin === "https://api.mercadopago.com" && url.pathname === "/checkout/preferences") {
      assert.equal(init.headers.Authorization, "Bearer mp-token");
      if (opcoes.mpFalha) return json({ message: "erro" }, 400);
      const p = JSON.parse(init.body);
      banco.preferencias.push(p);
      return json({ id: "pref-1", init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1" }, 201);
    }
    if (url.origin === "https://api.mercadopago.com" && url.pathname.startsWith("/v1/payments/")) {
      const p = (opcoes.pagamentos || {})[url.pathname.split("/").pop()!];
      return p ? json(p) : json({ message: "not found" }, 404);
    }
    throw new Error("pedido inesperado: " + metodo + " " + url);
  }) as typeof fetch;
  return { banco, restaurar: () => { globalThis.fetch = original; } };
}

function avisoMp(dataId: string, segredo = SEGREDO) {
  const ts = "1760000000";
  const v1 = createHmac("sha256", segredo).update(`id:${dataId};request-id:req-1;ts:${ts};`).digest("hex");
  return new Request(`${SUPA}/functions/v1/mp-webhook?data.id=${dataId}&type=payment`, {
    method: "POST",
    headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-1", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "payment.updated", type: "payment", data: { id: dataId } }),
  });
}

// ---------- assinatura do aviso ----------
test("aviso do Mercado Pago: aceita a assinatura certa e recusa a errada", async () => {
  const certo = avisoMp("123");
  assert.equal(await avisoAutentico(certo.headers, "123", SEGREDO), true);
  assert.equal(await avisoAutentico(avisoMp("123", "outro").headers, "123", SEGREDO), false);
  assert.equal(await avisoAutentico(certo.headers, "124", SEGREDO), false);
  assert.equal(await avisoAutentico(new Headers(), "123", SEGREDO), false);
});

// ---------- regras de mudança da assinatura ----------
const agora = new Date("2026-10-15T12:00:00Z");
const pendente = { id: 1, user_id: "u1", status: "pendente", valor_centavos: 19900, dias: 365, mp_pagamento_id: null };
const aprovado = { id: 555, status: "approved", transaction_amount: 199, currency_id: "BRL", external_reference: "1" };

test("pagamento aprovado ativa por 365 dias", () => {
  const m = decidir(pendente, aprovado, agora, null)!;
  assert.equal(m.status, "ativa");
  assert.equal(m.mp_pagamento_id, "555");
  assert.equal(m.inicio, "2026-10-15T12:00:00.000Z");
  assert.equal(m.fim, "2027-10-15T12:00:00.000Z");
});
test("compra durante um acesso ativo começa quando o atual termina", () => {
  const m = decidir(pendente, aprovado, agora, new Date("2026-12-01T00:00:00Z"))!;
  assert.equal(m.inicio, "2026-12-01T00:00:00.000Z");
});
test("valor pago diferente do combinado não ativa", () => {
  assert.equal(decidir(pendente, { ...aprovado, transaction_amount: 1 }, agora, null), null);
  assert.equal(decidir(pendente, { ...aprovado, currency_id: "USD" }, agora, null), null);
});
test("aviso repetido não muda nada", () => {
  assert.equal(decidir({ ...pendente, status: "ativa", mp_pagamento_id: "555" }, aprovado, agora, null), null);
});
test("devolução encerra o acesso", () => {
  const m = decidir({ ...pendente, status: "ativa", mp_pagamento_id: "555" }, { ...aprovado, status: "refunded" }, agora, null)!;
  assert.deepEqual(m, { status: "reembolsada", mp_pagamento_id: "555", fim: agora.toISOString() });
  const c = decidir({ ...pendente, status: "ativa", mp_pagamento_id: "555" }, { ...aprovado, status: "charged_back" }, agora, null)!;
  assert.equal(c.status, "reembolsada");
});
test("tentativa recusada e depois aprovada: vale a aprovada", () => {
  const recusa = decidir(pendente, { ...aprovado, id: 1, status: "rejected" }, agora, null)!;
  assert.deepEqual(recusa, { status: "cancelada", mp_pagamento_id: "1" });
  const depois = decidir({ ...pendente, ...recusa }, aprovado, agora, null)!;
  assert.equal(depois.status, "ativa");
});
test("aviso atrasado de outro pagamento não derruba um acesso ativo", () => {
  const ativa = { ...pendente, status: "ativa", mp_pagamento_id: "555" };
  assert.equal(decidir(ativa, { ...aprovado, id: 1, status: "rejected" }, agora, null), null);
  assert.equal(decidir(ativa, { ...aprovado, id: 1, status: "refunded" }, agora, null), null);
});
test("pagamento em análise ou em disputa", () => {
  assert.deepEqual(decidir(pendente, { ...aprovado, status: "in_process" }, agora, null), { status: "pendente", mp_pagamento_id: "555" });
  assert.equal(decidir({ ...pendente, mp_pagamento_id: "555" }, { ...aprovado, status: "pending" }, agora, null), null);
  assert.equal(decidir({ ...pendente, status: "ativa", mp_pagamento_id: "555" }, { ...aprovado, status: "in_mediation" }, agora, null), null);
});

// ---------- webhook de ponta a ponta ----------
test("webhook: aviso autêntico ativa a assinatura certa", async () => {
  const s = simular({ assinaturas: [{ ...pendente }], pagamentos: { "555": aprovado } });
  try {
    const r = await webhook(avisoMp("555"), ambiente());
    assert.equal(r.status, 200);
    assert.equal(s.banco.assinaturas[0].status, "ativa");
    assert.equal(s.banco.assinaturas[0].mp_pagamento_id, "555");
  } finally { s.restaurar(); }
});
test("webhook: assinatura do aviso inválida é recusada sem consultar nada", async () => {
  const s = simular({ assinaturas: [{ ...pendente }], pagamentos: { "555": aprovado } });
  try {
    const r = await webhook(avisoMp("555", "segredo-errado"), ambiente());
    assert.equal(r.status, 401);
    assert.equal(s.banco.assinaturas[0].status, "pendente");
  } finally { s.restaurar(); }
});
test("webhook: outros tipos de aviso e pagamentos desconhecidos são ignorados", async () => {
  const s = simular({ assinaturas: [{ ...pendente }] });
  try {
    const ipn = new Request(`${SUPA}/functions/v1/mp-webhook?topic=merchant_order&id=9`, { method: "POST", body: "{}" });
    assert.equal((await webhook(ipn, ambiente())).status, 200);
    const r = await webhook(avisoMp("999"), ambiente());
    assert.deepEqual(await r.json(), { ignorado: true });
    assert.equal(s.banco.assinaturas[0].status, "pendente");
  } finally { s.restaurar(); }
});

// ---------- checkout ----------
test("checkout: lista os planos e abre o pagamento ligado à assinatura", async () => {
  const s = simular();
  try {
    const cab = { Authorization: "Bearer token-aluno" };
    const lista = await checkout(new Request(`${SUPA}/functions/v1/mp-checkout`, { headers: cab }), ambiente());
    assert.deepEqual((await lista.json()).planos, [{ id: "anual", nome: "Acesso por 12 meses", centavos: 19900, dias: 365 }]);

    const r = await checkout(new Request(`${SUPA}/functions/v1/mp-checkout`, { method: "POST", headers: cab, body: JSON.stringify({ plano: "anual" }) }), ambiente());
    assert.equal(r.status, 200);
    assert.match((await r.json()).endereco, /mercadopago\.com\.br/);
    const a = s.banco.assinaturas[0];
    assert.deepEqual([a.user_id, a.status, a.valor_centavos, a.dias, a.mp_preferencia_id], ["u1", "pendente", 19900, 365, "pref-1"]);
    const p = s.banco.preferencias[0];
    assert.equal(p.external_reference, String(a.id));
    assert.equal(p.items[0].unit_price, 199);
    assert.equal(p.notification_url, `${SUPA}/functions/v1/mp-webhook`);
    assert.equal(p.back_urls.success, "https://banca.exemplo/?pagamento=aprovado");
  } finally { s.restaurar(); }
});
test("checkout: sem login, sem plano ou com a venda fechada não abre pagamento", async () => {
  const s = simular();
  try {
    const sem = await checkout(new Request(`${SUPA}/functions/v1/mp-checkout`, { method: "POST", body: "{}" }), ambiente());
    assert.equal(sem.status, 401);
    const cab = { Authorization: "Bearer token-aluno" };
    const errado = await checkout(new Request(`${SUPA}/functions/v1/mp-checkout`, { method: "POST", headers: cab, body: JSON.stringify({ plano: "vitalicio" }) }), ambiente());
    assert.equal(errado.status, 400);
    const fechada = await checkout(new Request(`${SUPA}/functions/v1/mp-checkout`, { method: "POST", headers: cab, body: JSON.stringify({ plano: "anual" }) }), ambiente({ PLANOS: "" }));
    assert.equal(fechada.status, 503);
    assert.equal(s.banco.assinaturas.length, 0);
  } finally { s.restaurar(); }
});
test("checkout: se o Mercado Pago falhar, a assinatura pendente é desfeita", async () => {
  const s = simular({ mpFalha: true });
  try {
    const r = await checkout(new Request(`${SUPA}/functions/v1/mp-checkout`, { method: "POST", headers: { Authorization: "Bearer token-aluno" }, body: JSON.stringify({ plano: "anual" }) }), ambiente());
    assert.equal(r.status, 502);
    assert.equal(s.banco.assinaturas.length, 0);
  } finally { s.restaurar(); }
});

// ---------- exclusão de conta ----------
test("exclusão: só a própria pessoa, logada e com confirmação", async () => {
  const s = simular();
  try {
    const url = `${SUPA}/functions/v1/excluir-conta`;
    assert.equal((await excluir(new Request(url, { method: "POST", body: JSON.stringify({ confirmacao: "EXCLUIR" }) }), ambiente())).status, 401);
    assert.equal((await excluir(new Request(url, { method: "POST", headers: { Authorization: "Bearer token-aluno" }, body: "{}" }), ambiente())).status, 400);
    assert.deepEqual(s.banco.apagados, []);
    const r = await excluir(new Request(url, { method: "POST", headers: { Authorization: "Bearer token-aluno" }, body: JSON.stringify({ confirmacao: "EXCLUIR" }) }), ambiente());
    assert.equal(r.status, 200);
    assert.deepEqual(s.banco.apagados, ["u1"]);
  } finally { s.restaurar(); }
});
