// Envio de mensagens pela API do WhatsApp.
// Funciona direto na Cloud API da Meta ou pela 360dialog (parceira que permite
// manter o mesmo número no app WhatsApp Business: "coexistência").
// As duas usam o mesmo corpo de mensagem; mudam só o endereço e a autenticação.

// Chaves coladas no GitHub às vezes vêm com espaço ou quebra de linha no fim.
function tokenWhatsApp(env) {
  const token = String(env.WHATSAPP_TOKEN ?? "").trim();
  if (!token) throw new Error("WHATSAPP_TOKEN não configurado");
  if (/[^\x21-\x7e]/.test(token)) {
    throw new Error("WHATSAPP_TOKEN tem caractere inválido (espaço, acento ou reticências); cole o token de novo no GitHub");
  }
  return token;
}

function api(env) {
  if (env.WHATSAPP_PROVIDER === "360dialog") {
    return {
      url: "https://waba-v2.360dialog.io/messages",
      headers: { "D360-API-KEY": tokenWhatsApp(env) },
    };
  }
  const versao = env.GRAPH_VERSION || "v23.0";
  return {
    url: `https://graph.facebook.com/${versao}/${env.PHONE_NUMBER_ID}/messages`,
    headers: { Authorization: `Bearer ${tokenWhatsApp(env)}` },
  };
}

async function postar(env, corpo) {
  const { url, headers } = api(env);
  const resp = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...corpo }),
  });
  if (!resp.ok) {
    throw new Error(`WhatsApp ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

export function enviarTexto(env, para, texto) {
  return postar(env, {
    recipient_type: "individual",
    to: para,
    type: "text",
    text: { preview_url: false, body: texto.slice(0, 4096) },
  });
}

// Cartão de contato do WhatsApp: o cliente toca em "Mensagem" sem precisar abrir link.
export function enviarContato(env, para, numero) {
  const digitos = String(numero).replace(/\D/g, "");
  return postar(env, {
    to: para,
    type: "contacts",
    contacts: [{
      name: { formatted_name: "Nayara Tonete – NT Advocacia", first_name: "Nayara", last_name: "Tonete" },
      org: { company: "NT Advocacia" },
      phones: [{ phone: `+${digitos}`, wa_id: digitos, type: "WORK" }],
    }],
  });
}

// Marca a mensagem como lida e mostra "digitando…" enquanto a resposta é gerada.
// Falhar aqui não pode impedir a resposta, então o erro só é registrado.
export async function marcarLida(env, idMensagem) {
  try {
    await postar(env, {
      status: "read",
      message_id: idMensagem,
      typing_indicator: { type: "text" },
    });
  } catch (erro) {
    console.warn("marcarLida:", erro.message);
  }
}

// Parâmetros de modelo não aceitam quebra de linha, tabulação nem 4+ espaços seguidos.
function limpar(texto, max) {
  const t = String(texto ?? "").replace(/[\n\r\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return (t.length > max ? t.slice(0, max - 1) + "…" : t) || "-";
}

export function textoAviso(telefone, dados) {
  return [
    `*Novo contato – golpe do Pix* (prioridade ${dados.prioridade}, ${dados.motivo.replace(/_/g, " ")})`,
    `Nome: ${dados.nome} · +${telefone}`,
    `Cidade: ${dados.cidade}`,
    `Golpe: ${dados.tipo_golpe}`,
    `Quando: ${dados.data_golpe}`,
    `Valor: ${dados.valor}`,
    `Banco: ${dados.banco}`,
    `Contestou no banco/MED: ${dados.contestou_banco}`,
    `B.O.: ${dados.boletim_ocorrencia}`,
    `Resumo: ${dados.resumo}`,
    `Conversa: https://wa.me/${telefone}`,
  ].join("\n");
}

// Avisa a advogada no WhatsApp pessoal dela (NOTIFY_TO).
// Fora da janela de 24h a Meta só entrega mensagens por modelo aprovado
// (NOTIFY_TEMPLATE); sem modelo configurado, manda texto livre.
export function avisarAdvogada(env, telefone, dados) {
  if (!env.NOTIFY_TEMPLATE) {
    return enviarTexto(env, env.NOTIFY_TO, textoAviso(telefone, dados));
  }
  const detalhes = [
    `Golpe: ${dados.tipo_golpe}`,
    `Quando: ${dados.data_golpe}`,
    `Valor: ${dados.valor}`,
    `Banco: ${dados.banco}`,
    `Contestou: ${dados.contestou_banco}`,
    `B.O.: ${dados.boletim_ocorrencia}`,
    `Resumo: ${dados.resumo}`,
  ].join(" | ");
  return postar(env, {
    to: env.NOTIFY_TO,
    type: "template",
    template: {
      name: env.NOTIFY_TEMPLATE,
      language: { code: env.NOTIFY_TEMPLATE_LANG || "pt_BR" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: limpar(`${dados.nome} (+${telefone}, ${dados.cidade})`, 120) },
            { type: "text", text: limpar(`${dados.prioridade} – ${dados.motivo.replace(/_/g, " ")}`, 60) },
            { type: "text", text: limpar(detalhes, 700) },
          ],
        },
      ],
    },
  });
}
