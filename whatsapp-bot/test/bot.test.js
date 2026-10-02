import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Conversa } from "../src/conversa.js";
import worker, { extrairEventos, variantes } from "../src/index.js";
import { responder } from "../src/claude.js";
import { textoAviso, enviarTexto, enviarContato } from "../src/whatsapp.js";
import { perfilDe, NOMES_PERFIS } from "../src/perfis/index.js";

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
  const enviados = [], avisos = [], chamadas = [], contatos = [];
  const storage = armazenamento();
  const relogio = { agora: 1_000_000 };
  const conversa = new Conversa({ storage }, { PERFIL: "nt-golpe-pix", DEBOUNCE_MS: "5000", NUMERO_ESCRITORIO: "5531996936688" }, {
    agora: () => relogio.agora,
    marcarLida: async () => {},
    registrar: async () => {},
    enviarTexto: async (_env, para, texto) => enviados.push({ para, texto }),
    enviarContato: async (_env, para, numero) => contatos.push({ para, numero }),
    avisarResponsavel: async (_env, tel, dados) => avisos.push({ tel, dados }),
    responder: async (_env, historico) => {
      chamadas.push(structuredClone(historico));
      const r = respostas.shift();
      if (r instanceof Error) throw r;
      return r;
    },
  });
  return { conversa, storage, enviados, avisos, chamadas, relogio, contatos };
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

test("fim da triagem: avisa a advogada e passa o WhatsApp do escritório sem link", async () => {
  const { conversa, enviados, avisos, chamadas, contatos } = montar([{ texto: "Obrigada, Ana!", aviso }]);
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "perdi 3 mil", nome: "Ana" });
  await conversa.alarm();
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].dados.prioridade, "alta");
  assert.equal(enviados[0].texto, "Obrigada, Ana!");
  assert.match(enviados[1].texto, /\(31\) 99693-6688/);
  assert.doesNotMatch(enviados[1].texto, /https?:/);
  assert.deepEqual(contatos, [{ para: "5531900000000", numero: "5531996936688" }]);
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
  assert.match(enviados[3].texto, /\(31\) 99693-6688/);
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
    PERFIL: "nt-golpe-pix",
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
  const env = { PERFIL: "nt-golpe-pix", VERIFY_TOKEN: "abc", WEBHOOK_KEY: "k1", CONVERSAS: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response("ok") }) } };
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
  const r = await responder({ PERFIL: "nt-golpe-pix" }, [{ role: "user", content: "oi" }], { cliente, agora: new Date("2026-09-27T15:00:00Z") });
  assert.equal(r.texto, "Obrigada!");
  assert.equal(r.aviso.nome, "Ana");
  assert.equal(pedido.model, "claude-opus-5");
  assert.equal(pedido.fallbacks, "default");
  assert.equal(pedido.messages.at(-1).role, "system");
  assert.match(pedido.messages.at(-1).content, /27\/09\/2026/);

  const recusa = await responder({ PERFIL: "nt-golpe-pix" }, [{ role: "user", content: "oi" }], { cliente: { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } } });
  assert.equal(recusa.recusado, true);
});

test("texto do aviso traz o link da conversa", () => {
  const texto = textoAviso(perfilDe({ PERFIL: "nt-golpe-pix" }), "5531900000000", aviso);
  assert.match(texto, /wa\.me\/5531900000000/);
  assert.match(texto, /^\*Novo contato – golpe do Pix\*/);
  assert.match(texto, /Contestou no banco\/MED: não/);
});

test("página de diagnóstico exige a chave e lista as ocorrências", async () => {
  const eventos = [];
  const env = {
    PERFIL: "nt-golpe-pix",
    VERIFY_TOKEN: "abc",
    DIAGNOSTICO: {
      idFromName: (n) => n,
      get: () => ({ fetch: async (url, init) => {
        if (url.endsWith("/ultimo")) return Response.json({ telefone: "553188887348" });
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
  const pagina = await r.text();
  assert.match(pagina, /assinatura inválida/);
  assert.match(pagina, /^Perfil: nt-golpe-pix/);
  const z = await worker.fetch(new Request("https://x/diagnostico?chave=abc&zerar=+55 17 99772-2969"), env);
  assert.match(await z.text(), /zerada \(final 2969, com e sem o 9\)/);
  const u = await worker.fetch(new Request("https://x/diagnostico?chave=abc&zerar=ultimo"), env);
  assert.match(await u.text(), /zerada \(final 7348, com e sem o 9\)/);
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

test("resposta que não chegou ao cliente não entra no histórico", async () => {
  const { conversa, chamadas } = montar([{ texto: "Olá!", aviso: null }, { texto: "Me conta mais?", aviso: null }]);
  conversa.deps.enviarTexto = async () => { throw new Error("Invalid header value."); };
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "caí num golpe", nome: null });
  await conversa.alarm();
  conversa.deps.enviarTexto = async () => {};
  await conversa.entrada({ telefone: "5531900000000", id: "b", texto: "caí num golpe", nome: null });
  await conversa.alarm();
  assert.deepEqual(chamadas[1].map((m) => m.role), ["user", "user"]);
});

test("zerar apaga a conversa", async () => {
  const { conversa, storage } = montar([]);
  storage.deleteAll = async function () { this.limpo = true; };
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "oi", nome: null });
  await conversa.zerar();
  assert.equal(storage.limpo, true);
  assert.equal(storage.alarme, null);
});

test("zerar considera o número com e sem o 9 extra", () => {
  assert.deepEqual(variantes("5531988887348"), ["5531988887348", "553188887348"]);
  assert.deepEqual(variantes("553188887348"), ["553188887348", "5531988887348"]);
  assert.deepEqual(variantes("12345"), ["12345"]);
});

test("perfil inexistente: erro claro, e o webhook pede para a Meta reenviar", async () => {
  assert.throws(() => perfilDe({ PERFIL: "nao-existe" }), /PERFIL "nao-existe" não existe. Opções: nt-golpe-pix/);
  assert.throws(() => perfilDe({}), /PERFIL "" não existe/);
  const env = { WEBHOOK_KEY: "k1", CONVERSAS: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response("ok") }) } };
  const r = await worker.fetch(new Request("https://x/webhook?chave=k1", { method: "POST", body: "{}" }), env);
  assert.equal(r.status, 500);
});

test("todos os perfis: ferramenta válida, textos preenchidos e sem dados de outro cliente", () => {
  for (const id of NOMES_PERFIS) {
    const p = perfilDe({ PERFIL: id });
    assert.equal(p.id, id);
    const { properties, required } = p.ferramenta.input_schema;
    assert.deepEqual(required, Object.keys(properties));
    for (const chave of ["nome", "cidade", "resumo", "prioridade", "motivo"]) assert.ok(properties[chave], `${id}: ${chave}`);
    assert.match(p.systemPrompt, new RegExp(p.ferramenta.name));
    for (const t of [p.mensagens.final, p.mensagens.erro, p.mensagens.jaEncaminhado, p.mensagens.contato("(11) 91234-5678")]) {
      assert.ok(t.length > 20, id);
      assert.doesNotMatch(t, /undefined|\$\{/, id);
    }
    assert.match(p.mensagens.contato("(11) 91234-5678"), /\(11\) 91234-5678/);
    assert.doesNotMatch(p.systemPrompt, /undefined|\$\{/, id);
    if (id !== "nt-golpe-pix") assert.doesNotMatch(p.systemPrompt + JSON.stringify(p.mensagens.final), /Nayara|Pix/, id);
    const falha = p.avisoDeFalha("Ana");
    assert.equal(falha.nome, "Ana");
    assert.equal(falha.motivo, "falha_do_robo");
    for (const c of p.camposAviso) assert.ok(falha[c.chave], `${id}: ${c.chave}`);
  }
});

test("modelo de advocacia: concordância e campos do aviso", () => {
  const p = perfilDe({ PERFIL: "demo-trabalhista" });
  assert.match(p.systemPrompt, /^Você é a assistente virtual do escritório da advogada Ana Exemplo \(Escritório Demonstração, OAB\/UF 000.000\)/);
  assert.match(p.systemPrompt, /depende da análise da advogada\./);
  assert.match(p.mensagens.erro, /A advogada Ana Exemplo foi avisada/);
  const texto = textoAviso(p, "5511900000000", { ...p.avisoDeFalha("Bia"), carteira: "não", prioridade: "alta", motivo: "triagem_completa" });
  assert.match(texto, /^\*Novo contato – direitos trabalhistas\* \(prioridade alta, triagem completa\)/);
  assert.match(texto, /Carteira assinada: não/);
});

test("cartão de contato usa os dados do perfil", async () => {
  let corpo;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { corpo = JSON.parse(init.body); return Response.json({}); };
  try {
    await enviarContato({ PERFIL: "demo-trabalhista", WHATSAPP_TOKEN: "t", PHONE_NUMBER_ID: "1" }, "55", "5511912345678");
    assert.equal(corpo.contacts[0].name.formatted_name, "Ana Exemplo – Escritório Demonstração");
    assert.equal(corpo.contacts[0].name.last_name, "Exemplo");
    assert.equal(corpo.contacts[0].org.company, "Escritório Demonstração");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
