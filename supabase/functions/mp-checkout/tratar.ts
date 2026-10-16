// Abre a compra no Checkout Pro do Mercado Pago.
//   GET  → lista os planos à venda (nome, preço total e duração), para a tela de compra.
//   POST {plano} → registra a assinatura como pendente e devolve o endereço de pagamento.
// O token do Mercado Pago fica só aqui (segredo MP_ACCESS_TOKEN); o site nunca o vê.
import { type Ambiente, CORS, exigir, lerPlanos, resposta, servidor, usuarioDaRequisicao } from "../_comum/comum.ts";

export async function tratar(req: Request, amb: Ambiente): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const usuario = await usuarioDaRequisicao(req, amb);
    if (!usuario) return resposta({ erro: "Entre na sua conta para continuar." }, 401);
    const planos = lerPlanos(amb);
    if (req.method === "GET") return resposta({ planos });
    if (req.method !== "POST") return resposta({ erro: "Método não aceito." }, 405);

    const pedido = await req.json().catch(() => ({}));
    if (!planos.length) return resposta({ erro: "A venda ainda não está aberta." }, 503);
    const plano = planos.find((p) => p.id === pedido.plano);
    if (!plano) return resposta({ erro: "Plano desconhecido." }, 400);

    const site = exigir(amb, "SITE_URL");
    const tokenMp = exigir(amb, "MP_ACCESS_TOKEN");
    const db = servidor(amb);

    // 1. A assinatura nasce pendente: o número dela liga o pagamento ao aluno (external_reference).
    const [assinatura] = await db.rest("assinaturas", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: usuario.id, plano: plano.id, valor_centavos: plano.centavos, dias: plano.dias, status: "pendente" }),
    });

    // 2. Preferência do Checkout Pro: pagamento único, sem renovação automática.
    const voltar = (situacao: string) => `${site}${site.includes("?") ? "&" : "?"}pagamento=${situacao}`;
    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenMp}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `assinatura-${assinatura.id}`,
      },
      body: JSON.stringify({
        items: [{ id: plano.id, title: plano.nome, quantity: 1, currency_id: "BRL", unit_price: plano.centavos / 100 }],
        payer: { email: usuario.email },
        external_reference: String(assinatura.id),
        notification_url: `${exigir(amb, "SUPABASE_URL")}/functions/v1/mp-webhook`,
        back_urls: { success: voltar("aprovado"), pending: voltar("pendente"), failure: voltar("recusado") },
        auto_return: "approved",
        statement_descriptor: "BANCA ABERTA",
      }),
    });
    if (!r.ok) {
      console.error("Mercado Pago recusou a preferência", r.status, await r.text());
      await db.rest(`assinaturas?id=eq.${assinatura.id}`, { method: "DELETE" });
      return resposta({ erro: "Não foi possível abrir o pagamento agora. Tente de novo em alguns minutos." }, 502);
    }
    const preferencia = await r.json();
    await db.rest(`assinaturas?id=eq.${assinatura.id}`, {
      method: "PATCH",
      body: JSON.stringify({ mp_preferencia_id: String(preferencia.id) }),
    });
    return resposta({ endereco: preferencia.init_point });
  } catch (e) {
    console.error(e);
    return resposta({ erro: "Erro no servidor. Tente de novo em alguns minutos." }, 500);
  }
}
