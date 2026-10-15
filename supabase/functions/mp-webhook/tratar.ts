// Recebe os avisos do Mercado Pago e atualiza a assinatura.
// O aviso só diz "o pagamento X mudou". A função confere a assinatura do aviso (segredo
// MP_WEBHOOK_SECRET) e busca o pagamento na API do Mercado Pago, que é quem diz o estado real:
// um aviso falsificado não consegue ativar nada.
import { type Ambiente, exigir, resposta, servidor } from "../_comum/comum.ts";

const DIA_MS = 86400000;

// Estado do pagamento no Mercado Pago → estado da assinatura.
// "in_mediation" (disputa aberta) não muda nada até a disputa terminar.
const ESTADOS: Record<string, string> = {
  approved: "ativa",
  authorized: "pendente",
  pending: "pendente",
  in_process: "pendente",
  rejected: "cancelada",
  cancelled: "cancelada",
  refunded: "reembolsada",
  charged_back: "reembolsada",
};

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Cabeçalho x-signature: "ts=1704908010,v1=<hmac>". O texto assinado é
// "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" (sem as partes que não vierem).
export async function avisoAutentico(cab: Headers, dataId: string, segredo: string): Promise<boolean> {
  const partes: Record<string, string> = {};
  for (const p of (cab.get("x-signature") || "").split(",")) {
    const i = p.indexOf("=");
    if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const pedido = cab.get("x-request-id");
  const texto = `id:${id};` + (pedido ? `request-id:${pedido};` : "") + `ts:${partes.ts};`;
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperado = hex(await crypto.subtle.sign("HMAC", chave, enc.encode(texto)));
  const recebido = partes.v1.toLowerCase();
  if (esperado.length !== recebido.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

// Decide o que muda na assinatura diante do estado atual do pagamento.
// Devolve os campos a gravar, ou null quando não há nada a fazer.
// acessoAte: fim de outra assinatura ativa do mesmo aluno (a nova começa depois dela).
export function decidir(a: any, pag: any, agora: Date, acessoAte: Date | null): Record<string, unknown> | null {
  const novo = ESTADOS[pag.status];
  if (!novo) return null;
  const pid = String(pag.id);
  // A assinatura já ficou com outro pagamento (aprovado ou devolvido): este não mexe nela.
  if (a.mp_pagamento_id && a.mp_pagamento_id !== pid && (a.status === "ativa" || a.status === "reembolsada")) return null;

  if (novo === "ativa") {
    if (a.status === "ativa") return null; // aviso repetido
    if (Math.round(Number(pag.transaction_amount) * 100) !== a.valor_centavos || pag.currency_id !== "BRL") {
      console.error(`assinatura ${a.id}: valor pago (${pag.transaction_amount} ${pag.currency_id}) não confere`);
      return null;
    }
    if (!a.dias) {
      console.error(`assinatura ${a.id}: sem duração gravada`);
      return null;
    }
    const inicio = acessoAte && acessoAte > agora ? acessoAte : agora;
    return {
      status: "ativa",
      mp_pagamento_id: pid,
      inicio: inicio.toISOString(),
      fim: new Date(inicio.getTime() + a.dias * DIA_MS).toISOString(),
    };
  }
  if (novo === "reembolsada") {
    if (a.status === "reembolsada") return null;
    return { status: "reembolsada", mp_pagamento_id: pid, fim: agora.toISOString() };
  }
  // pendente ou cancelada: só vale enquanto a assinatura não foi ativada
  if (a.status === "ativa") return null;
  if (a.status === novo && a.mp_pagamento_id === pid) return null;
  return { status: novo, mp_pagamento_id: pid };
}

export async function tratar(req: Request, amb: Ambiente): Promise<Response> {
  if (req.method !== "POST") return resposta({ ok: true });
  try {
    const url = new URL(req.url);
    const corpo = await req.json().catch(() => ({}));
    const tipo = url.searchParams.get("type") || corpo.type;
    const dataId = url.searchParams.get("data.id") || (corpo.data && corpo.data.id);
    // Avisos de outros tipos (e o formato antigo "topic=", que chega junto) não interessam.
    if (tipo !== "payment" || !dataId) return resposta({ ignorado: true });

    if (!(await avisoAutentico(req.headers, String(dataId), exigir(amb, "MP_WEBHOOK_SECRET")))) {
      console.error("aviso do Mercado Pago com assinatura inválida");
      return resposta({ erro: "assinatura inválida" }, 401);
    }

    const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(dataId))}`, {
      headers: { Authorization: `Bearer ${exigir(amb, "MP_ACCESS_TOKEN")}` },
    });
    if (r.status === 404) return resposta({ ignorado: true }); // ex.: aviso de teste do painel
    if (!r.ok) throw new Error(`Mercado Pago respondeu ${r.status} ao consultar o pagamento`);
    const pag = await r.json();

    const ref = Number(pag.external_reference);
    if (!Number.isInteger(ref) || ref <= 0) return resposta({ ignorado: true });
    const db = servidor(amb);
    const [assinatura] = await db.rest(`assinaturas?id=eq.${ref}&select=*`);
    if (!assinatura) return resposta({ ignorado: true });

    const [outra] = await db.rest(
      `assinaturas?user_id=eq.${assinatura.user_id}&status=eq.ativa&id=neq.${assinatura.id}&fim=not.is.null&select=fim&order=fim.desc&limit=1`,
    );
    const mudanca = decidir(assinatura, pag, new Date(), outra ? new Date(outra.fim) : null);
    if (mudanca) {
      await db.rest(`assinaturas?id=eq.${assinatura.id}`, { method: "PATCH", body: JSON.stringify(mudanca) });
    }
    return resposta({ ok: true });
  } catch (e) {
    // Erro 500 faz o Mercado Pago tentar de novo mais tarde.
    console.error(e);
    return resposta({ erro: "erro no servidor" }, 500);
  }
}
