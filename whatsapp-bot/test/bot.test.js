import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Conversa } from "../src/conversa.js";
import worker, { extrairEventos } from "../src/index.js";
import { responder } from "../src/claude.js";
import { textoAviso, enviarTexto } from "../src/whatsapp.js";

function armazenamento() {
  const mapa = new Map();
  return {
    alarme: null,
    async get(k) { return structuredClone(mapa.get(k)); },
    async put(k, v) { mapa.set(k, structuredClone(v)); },
    async setAlarm(t) { this.alarme = t; },
    async deleteAlarm() { this.alarme = null; },
  };
}

function montar(respostas) {
  const enviados = [], avisos = [], chamadas = [];
  const storage = armazenamento();
  const relogio = { agora: 1_000_000 };
  const conversa = new Conversa({ storage }, { DEBOUNCE_MS: "5000", NUMERO_ESCRITORIO: "5531996936688" }, {
    agora: () => relogio.agora,
    marcarLida: async () => {},
    registrar: async () => {},
    enviarTexto: async (_env, para, texto) => enviados.push({ para, texto }),
    avisarAdvogada: async (_env, tel, dados) => avisos.push({ tel, dados }),
    responder: async (_env, historico) => {
      chamadas.push(structuredClone(historico));
      const r = respostas.shift();
      if (r instanceof Error) throw r;
      return r;
    },
  });
  return { conversa, storage, enviados, avisos, chamadas, relogio };
}

const aviso = {
  nome: "Ana", cidade: "BH/MG", tipo_golpe: "falso parente", data_golpe: "ontem",
  valor: "R$ 3.000 em 2 Pix", banco: "Nubank", contestou_banco: "não",
  boletim_ocorrencia: "não", resumo: "Transferiu para falso filho.", prioridade: "alta",
  motivo: "triagem_completa",
};

test("junta mensagens seguidas numa única resposta", async () => {
  const { conversa, storage, enviados, chamadas } = montar([{ texto: "Oi! Me conta o que houve?", aviso: null }]);
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "oi", nome: "Ana" });
  await conversa.entrada({ telefone: "5531900000000", id: "b", texto: "caí num golpe", nome: "Ana" });
  await conversa.entrada({ telefone: "5531900000000", id: "b", texto: "caí num golpe", nome: "Ana" }); // reenvio
  assert.equal(storage.alarme, 1_005_000);
  await conversa.alarm();
  assert.equal(chamadas.length, 1);
  assert.deepEqual(chamadas[0], [{ role: "user", content: "oi\ncaí num golpe" }]);
  assert.deepEqual(enviados, [{ para: "5531900000000", texto: "Oi! Me conta o que houve?" }]);
});

test("fim da triagem: avisa a advogada e manda o link do WhatsApp do escritório", async () => {
  const { conversa, enviados, avisos, chamadas } = montar([{ texto: "Obrigada, Ana!", aviso }]);
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "perdi 3 mil", nome: "Ana" });
  await conversa.alarm();
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].dados.prioridade, "alta");
  assert.equal(enviados[0].texto, "Obrigada, Ana!");
  assert.match(enviados[1].texto, /https:\/\/wa\.me\/5531996936688\?text=/);
  assert.match(decodeURIComponent(enviados[1].texto), /Meu nome é Ana\./);
  assert.equal(chamadas.length, 1);
});

test("depois da triagem, quem volta a escrever recebe o link de novo (no máximo a cada 6h)", async () => {
  const { conversa, enviados, chamadas, relogio } = montar([{ texto: "Obrigada!", aviso }]);
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "perdi 3 mil", nome: "Ana" });
  await conversa.alarm();
  assert.equal(enviados.length, 2);

  relogio.agora += 60_000; // 1 minuto depois: não repete
  await conversa.entrada({ telefone: "5531900000000", id: "b", texto: "e agora?", nome: "Ana" });
  await conversa.alarm();
  assert.equal(enviados.length, 2);

  relogio.agora += 7 * 60 * 60 * 1000; // 7 horas depois: lembra o link
  await conversa.entrada({ telefone: "5531900000000", id: "c", texto: "oi?", nome: "Ana" });
  await conversa.alarm();
  assert.equal(enviados.length, 4);
  assert.match(enviados[2].texto, /só para a triagem/);
  assert.match(enviados[3].texto, /wa\.me\/5531996936688/);
  assert.equal(chamadas.length, 1); // a IA não é chamada de novo
});

test("resposta pelo app (eco) faz o robô ficar quieto", async () => {
  const { conversa, storage, enviados } = montar([{ texto: "não deveria sair", aviso: null }]);
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "oi", nome: null });
  await conversa.eco();
  assert.equal(storage.alarme, null);
  await conversa.alarm();
  assert.equal(enviados.length, 0);
});

test("falha da IA: tenta de novo e, depois de 3 falhas, avisa a advogada", async () => {
  const { conversa, enviados, avisos } = montar([new Error("x"), new Error("x"), new Error("x")]);
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "oi", nome: null });
  await assert.rejects(conversa.alarm());
  await assert.rejects(conversa.alarm());
  await conversa.alarm();
  assert.equal(enviados.length, 2); // desculpas + link do escritório
  assert.equal(avisos[0].dados.motivo, "falha_do_robo");
});

test("webhook: valida assinatura da Meta e encaminha mensagens e ecos", async () => {
  const chamadas = [];
  const env = {
    APP_SECRET: "segredo",
    CONVERSAS: {
      idFromName: (n) => n,
      get: (id) => ({ fetch: async (url, init) => { chamadas.push({ id, url, corpo: JSON.parse(init.body) }); return new Response("ok"); } }),
    },
  };
  const payload = {
    entry: [{ changes: [
      { field: "messages", value: {
        contacts: [{ profile: { name: "Ana" } }],
        messages: [
          { from: "5531911111111", id: "m1", type: "text", text: { body: "oi" }, referral: { headline: "Caiu no golpe do Pix?" } },
          { from: "5531911111111", id: "m2", type: "audio" },
          { from: "5531911111111", id: "m3", type: "reaction" },
        ] } },
      { field: "smb_message_echoes", value: { message_echoes: [{ from: "553199693668", to: "5531922222222", id: "e1" }] } },
    ] }],
  };
  const corpo = JSON.stringify(payload);
  const assinatura = "sha256=" + createHmac("sha256", "segredo").update(corpo).digest("hex");

  const negado = await worker.fetch(new Request("https://x/webhook", { method: "POST", body: corpo, headers: { "X-Hub-Signature-256": "sha256=00" } }), env);
  assert.equal(negado.status, 403);

  const ok = await worker.fetch(new Request("https://x/webhook", { method: "POST", body: corpo, headers: { "X-Hub-Signature-256": assinatura } }), env);
  assert.equal(ok.status, 200);
  assert.deepEqual(chamadas.map((c) => [c.id, c.url, c.corpo.texto]), [
    ["5531911111111", "https://conversa/entrada", "[veio do anúncio: Caiu no golpe do Pix?]\noi"],
    ["5531911111111", "https://conversa/entrada", "[áudio]"],
    ["5531922222222", "https://conversa/eco", undefined],
  ]);
});

test("webhook: verificação GET e chave da 360dialog", async () => {
  const env = { VERIFY_TOKEN: "abc", WEBHOOK_KEY: "k1", CONVERSAS: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response("ok") }) } };
  const r = await worker.fetch(new Request("https://x/webhook?hub.mode=subscribe&hub.verify_token=abc&hub.challenge=42"), env);
  assert.equal(await r.text(), "42");
  const sem = await worker.fetch(new Request("https://x/webhook", { method: "POST", body: "{}" }), env);
  assert.equal(sem.status, 403);
  const com = await worker.fetch(new Request("https://x/webhook?chave=k1", { method: "POST", body: "{}" }), env);
  assert.equal(com.status, 200);
});

test("modo de teste só atende números liberados", () => {
  const payload = { entry: [{ changes: [{ field: "messages", value: { messages: [
    { from: "5511", id: "1", type: "text", text: { body: "a" } },
    { from: "5522", id: "2", type: "text", text: { body: "b" } },
  ] } }] }] };
  assert.deepEqual(extrairEventos(payload, { ALLOWED_NUMBERS: "5522" }).map((e) => e.telefone), ["5522"]);
  assert.deepEqual(extrairEventos(payload, { NOTIFY_TO: "5511" }).map((e) => e.telefone), ["5522"]);
});

test("chamada ao Claude: parâmetros e leitura da ferramenta", async () => {
  let pedido;
  const cliente = { beta: { messages: { create: async (p) => { pedido = p; return {
    stop_reason: "tool_use",
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Obrigada!" }, { type: "tool_use", name: "avisar_advogada", input: aviso }],
  }; } } } };
  const r = await responder({}, [{ role: "user", content: "oi" }], { cliente, agora: new Date("2026-09-27T15:00:00Z") });
  assert.equal(r.texto, "Obrigada!");
  assert.equal(r.aviso.nome, "Ana");
  assert.equal(pedido.model, "claude-opus-5");
  assert.equal(pedido.fallbacks, "default");
  assert.equal(pedido.messages.at(-1).role, "system");
  assert.match(pedido.messages.at(-1).content, /27\/09\/2026/);

  const recusa = await responder({}, [{ role: "user", content: "oi" }], { cliente: { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } } });
  assert.equal(recusa.recusado, true);
});

test("texto do aviso traz o link da conversa", () => {
  assert.match(textoAviso("5531900000000", aviso), /wa\.me\/5531900000000/);
});

test("página de diagnóstico exige a chave e lista as ocorrências", async () => {
  const eventos = [];
  const env = {
    VERIFY_TOKEN: "abc",
    DIAGNOSTICO: {
      idFromName: (n) => n,
      get: () => ({ fetch: async (_url, init) => {
        if (init?.method === "POST") { eventos.unshift(JSON.parse(init.body)); return new Response("ok"); }
        return Response.json(eventos);
      } }),
    },
    CONVERSAS: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response("ok") }) },
    WEBHOOK_KEY: "k1",
  };
  assert.equal((await worker.fetch(new Request("https://x/diagnostico?chave=errada"), env)).status, 403);
  await worker.fetch(new Request("https://x/webhook", { method: "POST", body: "{}" }), env);
  const r = await worker.fetch(new Request("https://x/diagnostico?chave=abc"), env);
  assert.match(await r.text(), /assinatura inválida/);
});

test("token do WhatsApp com quebra de linha no fim funciona; com reticências dá erro claro", async () => {
  const chamadas = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init) => { chamadas.push(init.headers.Authorization); return Response.json({}); };
  try {
    await enviarTexto({ WHATSAPP_TOKEN: "EAAtoken123\n", PHONE_NUMBER_ID: "1" }, "55", "oi");
    assert.equal(chamadas[0], "Bearer EAAtoken123");
    await assert.rejects(enviarTexto({ WHATSAPP_TOKEN: "EAAtok…", PHONE_NUMBER_ID: "1" }, "55", "oi"), /caractere inválido/);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
