// Recebe os webhooks do WhatsApp e repassa cada mensagem à conversa do cliente.
export { Conversa } from "./conversa.js";
export { Diagnostico } from "./diagnostico.js";
import { registrar, lerDiagnostico, anotarUltimo, lerUltimo } from "./diagnostico.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/saude") return new Response("ok");

    // Últimas ocorrências do robô (protegido pelo VERIFY_TOKEN).
    if (url.pathname === "/diagnostico") {
      if (!env.VERIFY_TOKEN || !iguais(url.searchParams.get("chave") || "", env.VERIFY_TOKEN.trim())) {
        return new Response("proibido", { status: 403 });
      }
      // /diagnostico?chave=...&zerar=5517999999999 apaga a conversa desse número (para testes).
      // zerar=ultimo apaga a conversa de quem mandou a última mensagem.
      const pedido = url.searchParams.get("zerar") || "";
      const zerar = pedido.trim().toLowerCase() === "ultimo" ? (await lerUltimo(env)) ?? "" : pedido.replace(/\D/g, "");
      if (zerar) {
        for (const numero of variantes(zerar)) {
          await env.CONVERSAS.get(env.CONVERSAS.idFromName(numero)).fetch("https://conversa/zerar", { method: "POST", body: "{}" });
        }
        await registrar(env, `conversa de teste zerada (final ${zerar.slice(-4)}, com e sem o 9)`);
      }
      const eventos = await lerDiagnostico(env);
      const texto = eventos.length
        ? eventos.map((e) => `${e.quando}  ${e.etapa}${e.detalhe ? "\n    " + e.detalhe : ""}`).join("\n")
        : "Nenhuma ocorrência registrada ainda.";
      return new Response(texto, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname !== "/webhook") return new Response("não encontrado", { status: 404 });

    // Verificação feita pela Meta ao cadastrar o webhook.
    if (request.method === "GET") {
      const ok = url.searchParams.get("hub.mode") === "subscribe"
        && env.VERIFY_TOKEN
        && url.searchParams.get("hub.verify_token") === env.VERIFY_TOKEN.trim();
      return ok
        ? new Response(url.searchParams.get("hub.challenge"))
        : new Response("proibido", { status: 403 });
    }
    if (request.method !== "POST") return new Response("método não permitido", { status: 405 });

    const bruto = await request.text();
    if (!(await autentico(request, url, bruto, env))) {
      await registrar(env, "webhook recusado: assinatura inválida (confira o APP_SECRET)");
      return new Response("proibido", { status: 403 });
    }

    let payload;
    try {
      payload = JSON.parse(bruto);
    } catch {
      return new Response("json inválido", { status: 400 });
    }

    const eventos = extrairEventos(payload, env);
    // Avisos de "entregue/lida" chegam o tempo todo; só registra mensagens de clientes.
    const entradas = eventos.filter((ev) => ev.tipo === "entrada");
    if (entradas.length) {
      const ultimo = entradas[entradas.length - 1].telefone;
      await anotarUltimo(env, ultimo);
      await registrar(env, "mensagem recebida", `${entradas.length} mensagem(ns), de número terminado em ${ultimo.slice(-4)} (${ultimo.length} dígitos)`);
    }
    await Promise.all(eventos.map(async (ev) => {
      try {
        const conversa = env.CONVERSAS.get(env.CONVERSAS.idFromName(ev.telefone));
        const resp = await conversa.fetch(`https://conversa/${ev.tipo}`, {
          method: "POST",
          body: JSON.stringify(ev),
        });
        if (!resp.ok) throw new Error(`conversa respondeu ${resp.status}`);
      } catch (erro) {
        console.error("Falha ao repassar mensagem:", erro);
        await registrar(env, "erro ao repassar a mensagem para a conversa", erro?.message ?? erro);
      }
    }));
    return new Response("ok");
  },
};

// Meta assina o corpo com o App Secret (cabeçalho X-Hub-Signature-256).
// A 360dialog não assina: nesse caso o endereço do webhook leva uma chave secreta (?chave=).
async function autentico(request, url, bruto, env) {
  if (env.APP_SECRET) {
    const assinatura = request.headers.get("X-Hub-Signature-256") || "";
    const chave = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(env.APP_SECRET.trim()),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(bruto));
    const esperado = "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return iguais(assinatura, esperado);
  }
  if (env.WEBHOOK_KEY) return iguais(url.searchParams.get("chave") || "", env.WEBHOOK_KEY);
  console.error("Configure APP_SECRET (Meta) ou WEBHOOK_KEY (360dialog).");
  return false;
}

// O WhatsApp identifica muitos celulares brasileiros sem o 9 extra (55 31 8888-7348).
// Para zerar, vale o número com e sem esse 9.
export function variantes(numero) {
  const lista = [numero];
  if (/^55\d{2}9\d{8}$/.test(numero)) lista.push(numero.slice(0, 4) + numero.slice(5));
  else if (/^55\d{2}\d{8}$/.test(numero)) lista.push(numero.slice(0, 4) + "9" + numero.slice(4));
  return lista;
}

// Compara números de celular brasileiros com ou sem o 9 extra.
export function mesmoNumero(a, b) {
  const x = String(a).replace(/\D/g, ""), y = String(b).replace(/\D/g, "");
  return Boolean(x) && variantes(x).includes(y);
}

function iguais(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

export function extrairEventos(payload, env) {
  const permitidos = (env.ALLOWED_NUMBERS || "").split(",").map((n) => n.trim()).filter(Boolean);
  const liberado = (tel) => permitidos.length === 0 || permitidos.includes(tel);
  const eventos = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (env.PHONE_NUMBER_ID && v.metadata?.phone_number_id
        && v.metadata.phone_number_id !== env.PHONE_NUMBER_ID) continue;

      if (change.field === "messages") {
        const nome = v.contacts?.[0]?.profile?.name ?? null;
        for (const m of v.messages ?? []) {
          let texto = descrever(m);
          if (texto === null || !liberado(m.from)) continue;
          // Mensagens do próprio escritório (quem recebe os avisos) não passam pela triagem.
          if (env.NOTIFY_TO && mesmoNumero(m.from, env.NOTIFY_TO)) continue;
          // Clique em anúncio de WhatsApp da Meta: informa de qual anúncio veio.
          if (m.referral?.headline) texto = `[veio do anúncio: ${m.referral.headline}]\n${texto}`;
          eventos.push({ tipo: "entrada", telefone: m.from, id: m.id, texto, nome });
        }
      }

      // Mensagem enviada pelo app WhatsApp Business (coexistência).
      if (change.field === "smb_message_echoes") {
        for (const m of v.message_echoes ?? []) {
          if (m.to && liberado(m.to)) eventos.push({ tipo: "eco", telefone: m.to, id: m.id });
        }
      }
    }
  }
  return eventos;
}

// Converte a mensagem do WhatsApp em texto para a assistente. null = ignorar.
export function descrever(m) {
  const legenda = (x) => (x?.caption ? ` ${x.caption}` : "");
  switch (m.type) {
    case "text": return m.text?.body ?? "";
    case "audio": return "[áudio]";
    case "image": return "[imagem]" + legenda(m.image);
    case "video": return "[vídeo]" + legenda(m.video);
    case "document": return `[documento: ${m.document?.filename ?? "arquivo"}]` + legenda(m.document);
    case "sticker": return "[figurinha]";
    case "location": return "[localização]";
    case "contacts": return "[contato compartilhado]";
    case "button": return m.button?.text ?? "";
    case "interactive":
      return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
    case "reaction": return null;
    default: return "[mensagem de um tipo que o robô não lê]";
  }
}
