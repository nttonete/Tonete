import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Conversa } from "../src/conversa.js";
import worker, { extrairEventos, variantes, mesmoNumero } from "../src/index.js";
import { responder, horariosParaOferecer } from "../src/claude.js";
import { textoAviso, enviarTexto, motivoLegivel } from "../src/whatsapp.js";
import { SYSTEM_PROMPT, FERRAMENTA_AVISAR, MENSAGEM_JA_ORIENTADO, MENSAGEM_FINAL_VALOR_BAIXO, MENSAGEM_FINAL_PADRAO, MENSAGEM_FINAL_COM_HORARIO } from "../src/prompt.js";
import { Diagnostico } from "../src/diagnostico.js";
import { avisarComFila, entregarGuardados, tratarFalha } from "../src/avisos.js";

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
  const conversa = new Conversa({ storage }, { DEBOUNCE_MS: "5000", NUMERO_ESCRITORIO: "5531996936688" }, {
    agora: () => relogio.agora,
    marcarLida: async () => {},
    registrar: async () => {},
    enviarTexto: async (_env, para, texto) => enviados.push({ para, texto }),
    enviarContato: async (_env, para, numero) => contatos.push({ para, numero }),
    avisarAdvogada: async (_env, tel, dados) => avisos.push({ tel, dados }),
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
  valor: "R$ 8.000 em 2 Pix", banco: "Nubank", contestou_banco: "não",
  boletim_ocorrencia: "não", resumo: "Transferiu para falso filho.",
  horario_conversa: "terça-feira, 27/10, às 9h", canal_conversa: "telefone", prioridade: "alta",
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
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "perdi 8 mil", nome: "Ana" });
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
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "perdi 8 mil", nome: "Ana" });
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

const avisoValorBaixo = {
  ...aviso, valor: "R$ 1.200 em 1 Pix", horario_conversa: "não se aplica", canal_conversa: "não se aplica",
  prioridade: "baixa", motivo: "valor_abaixo_minimo",
};

test("valor abaixo de R$ 5 mil: avisa a advogada com prioridade baixa, orienta e não passa o contato", async () => {
  const { conversa, enviados, avisos, contatos } = montar([{ texto: "No momento, o escritório atende apenas casos a partir de R$ 5 mil. Fale com o Nubank e peça o MED.", aviso: avisoValorBaixo }]);
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "perdi 1.200", nome: "Ana" });
  await conversa.alarm();
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].dados.motivo, "valor_abaixo_minimo");
  assert.equal(avisos[0].dados.prioridade, "baixa");
  assert.equal(enviados.length, 1); // só as orientações
  assert.doesNotMatch(enviados[0].texto, /99693-6688/);
  assert.deepEqual(contatos, []);
});

test("valor baixo sem texto da IA: a reserva orienta e não fala em continuar com o escritório (E38)", async () => {
  const { conversa, enviados, avisos, contatos } = montar([{ texto: "", aviso: avisoValorBaixo }]);
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "perdi 1.200", nome: "Ana" });
  await conversa.alarm();
  assert.equal(avisos.length, 1);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].texto, MENSAGEM_FINAL_VALOR_BAIXO);
  assert.doesNotMatch(enviados[0].texto, /WhatsApp do escritório|continua com ela/);
  assert.match(enviados[0].texto, /MED/);
  assert.deepEqual(contatos, []);
});

test("urgência ou fora do escopo sem texto da IA: a reserva não fala de horário (E39)", async () => {
  for (const motivo of ["urgente", "fora_do_escopo"]) {
    const semHorario = { ...aviso, horario_conversa: "não se aplica", canal_conversa: "não se aplica", motivo };
    const { conversa, enviados, contatos } = montar([{ texto: "", aviso: semHorario }]);
    await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "socorro", nome: "Ana" });
    await conversa.alarm();
    assert.equal(enviados[0].texto, MENSAGEM_FINAL_PADRAO);
    for (const e of enviados) assert.doesNotMatch(e.texto, /horário da conversa|confirma[rç]/);
    assert.equal(contatos.length, 1);
  }
});

test("com horário escolhido e sem texto da IA: a reserva fala em confirmar o horário", async () => {
  const { conversa, enviados } = montar([{ texto: "", aviso }]);
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "pode ser terça", nome: "Ana" });
  await conversa.alarm();
  assert.equal(enviados[0].texto, MENSAGEM_FINAL_COM_HORARIO);
  assert.match(enviados[1].texto, /confirmação do horário vem pelo WhatsApp do escritório/);
});

test("quem foi orientado por valor baixo e volta a escrever recebe lembrete sem contato (no máximo a cada 6h)", async () => {
  const { conversa, enviados, chamadas, contatos, relogio } = montar([{ texto: "Orientações.", aviso: avisoValorBaixo }]);
  await conversa.entrada({ telefone: "5531900000000", id: "a", texto: "perdi 1.200", nome: "Ana" });
  await conversa.alarm();
  relogio.agora += 60_000;
  await conversa.entrada({ telefone: "5531900000000", id: "b", texto: "mas eu queria falar com ela", nome: "Ana" });
  await conversa.alarm();
  assert.equal(enviados.length, 1); // menos de 6h: silêncio
  relogio.agora += 7 * 60 * 60 * 1000;
  await conversa.entrada({ telefone: "5531900000000", id: "c", texto: "oi?", nome: "Ana" });
  await conversa.alarm();
  assert.equal(enviados.length, 2);
  assert.equal(enviados[1].texto, MENSAGEM_JA_ORIENTADO);
  assert.doesNotMatch(enviados[1].texto, /99693-6688/);
  assert.deepEqual(contatos, []);
  assert.equal(chamadas.length, 1); // a IA não é chamada de novo
});

test("instruções do robô: regra dos R$ 5 mil e motivo na ferramenta", () => {
  assert.match(SYSTEM_PROMPT, /# Valor abaixo de R\$ 5 mil/);
  assert.match(SYSTEM_PROMPT, /R\$ 5\.000 ou mais, ou se ela não souber o valor, siga a triagem normal/);
  assert.match(SYSTEM_PROMPT, /Não diga que a advogada vai continuar o atendimento nem passe o WhatsApp do escritório/);
  // Regra do escritório, não avaliação do caso (revisão de conformidade, 26/10/2026).
  assert.match(SYSTEM_PROMPT, /regra de organização do escritório, e não uma análise do caso/);
  assert.match(SYSTEM_PROMPT, /Esse é o valor total, somando todos os Pix/);
  assert.match(SYSTEM_PROMPT, /Esta seção não vale se houver urgência/);
  assert.match(SYSTEM_PROMPT, /190/);
  assert.doesNotMatch(SYSTEM_PROMPT, /custo e o tempo|valor a recuperar/);
  for (const texto of [MENSAGEM_FINAL_VALOR_BAIXO, MENSAGEM_JA_ORIENTADO]) {
    assert.doesNotMatch(texto, /custo e o tempo|valor a recuperar|não vale a pena/);
  }
  assert.ok(FERRAMENTA_AVISAR.input_schema.properties.motivo.enum.includes("valor_abaixo_minimo"));
});

test("aviso de valor baixo aparece legível para a advogada", () => {
  assert.equal(motivoLegivel("valor_abaixo_minimo"), "abaixo de R$ 5 mil: orientado, sem atendimento");
  assert.equal(motivoLegivel("triagem_completa"), "triagem completa");
  assert.match(textoAviso("5531900000000", avisoValorBaixo), /prioridade baixa, abaixo de R\$ 5 mil: orientado, sem atendimento/);
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
  assert.deepEqual(extrairEventos(payload, { NOTIFY_TO: "5511" }).filter((e) => e.tipo === "entrada").map((e) => e.telefone), ["5522"]);
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
  assert.match(pedido.messages.at(-1).content, /Horários para oferecer: segunda-feira, 28\/09, às 9h; terça-feira, 29\/09, às 10h; quarta-feira, 30\/09, às 11h\./);

  const recusa = await responder({}, [{ role: "user", content: "oi" }], { cliente: { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } } });
  assert.equal(recusa.recusado, true);
});

test("horários para a conversa: um por dia, nos próximos 3 dias úteis, às 9h, 10h e 11h", () => {
  // segunda-feira, 26/10/2026, 9h33 em Brasília
  assert.deepEqual(horariosParaOferecer(new Date("2026-10-26T12:33:00Z")), [
    "terça-feira, 27/10, às 9h", "quarta-feira, 28/10, às 10h", "quinta-feira, 29/10, às 11h",
  ]);
  // sexta-feira, 30/10/2026, 22h em Brasília (já é sábado em UTC): pula o fim de semana e Finados (02/11)
  assert.deepEqual(horariosParaOferecer(new Date("2026-10-31T01:00:00Z")), [
    "terça-feira, 03/11, às 9h", "quarta-feira, 04/11, às 10h", "quinta-feira, 05/11, às 11h",
  ]);
  // quinta, 19/11/2026: pula a Consciência Negra (20/11) e o fim de semana
  assert.deepEqual(horariosParaOferecer(new Date("2026-11-19T15:00:00Z"))[0], "segunda-feira, 23/11, às 9h");
  // sexta, 05/02/2027: pula o Carnaval (segunda 08/02 e terça 09/02)
  assert.deepEqual(horariosParaOferecer(new Date("2027-02-05T15:00:00Z"))[0], "quarta-feira, 10/02, às 9h");
  // quinta, 25/03/2027: pula a Sexta-feira Santa (26/03)
  assert.deepEqual(horariosParaOferecer(new Date("2027-03-25T15:00:00Z"))[0], "segunda-feira, 29/03, às 9h");
  // quarta, 26/05/2027: pula Corpus Christi (27/05)
  assert.deepEqual(horariosParaOferecer(new Date("2027-05-26T15:00:00Z"))[0], "sexta-feira, 28/05, às 9h");
});

test("instruções do robô: marcar a conversa com a advogada", () => {
  assert.match(SYSTEM_PROMPT, /# Marcar a conversa com a advogada/);
  assert.match(SYSTEM_PROMPT, /explicar os caminhos possíveis e quais documentos reunir/);
  // Conformidade (26/10/2026): sem pressupor processo e sem dizer se a conversa é gratuita ou paga.
  assert.doesNotMatch(SYSTEM_PROMPT, /questão processual/);
  assert.match(SYSTEM_PROMPT, /a conversa não é compromisso de contratação/);
  assert.match(SYSTEM_PROMPT, /Nunca diga que a conversa com a advogada é gratuita/);
  assert.match(SYSTEM_PROMPT, /Só se a pessoa escolheu um horário: repita o horário/);
  assert.match(SYSTEM_PROMPT, /por telefone, por reunião online ou pelo próprio WhatsApp/);
  assert.match(SYSTEM_PROMPT, /Nunca diga que está confirmado/);
  const props = FERRAMENTA_AVISAR.input_schema.properties;
  assert.ok(props.horario_conversa && props.canal_conversa);
  assert.ok(FERRAMENTA_AVISAR.input_schema.required.includes("horario_conversa"));
  assert.ok(FERRAMENTA_AVISAR.input_schema.required.includes("canal_conversa"));
});

test("aviso à advogada mostra o horário e o canal da conversa para confirmar", () => {
  assert.match(textoAviso("5531900000000", aviso), /Conversa com a advogada: terça-feira, 27\/10, às 9h \(telefone\) – confirmar com a pessoa/);
  assert.doesNotMatch(textoAviso("5531900000000", avisoValorBaixo), /Conversa com a advogada/);
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
  assert.match(await r.text(), /assinatura inválida/);
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

test("número da advogada é ignorado mesmo quando o WhatsApp manda sem o 9", () => {
  assert.equal(mesmoNumero("553196936688", "5531996936688"), true);
  assert.equal(mesmoNumero("5531996936688", "5531996936688"), true);
  assert.equal(mesmoNumero("553188887348", "5531996936688"), false);
  const payload = { entry: [{ changes: [{ field: "messages", value: { messages: [
    { from: "553196936688", id: "1", type: "text", text: { body: "oi" } },
    { from: "553188887348", id: "2", type: "text", text: { body: "oi" } },
  ] } }] }] };
  const eventos = extrairEventos(payload, { NOTIFY_TO: "5531996936688" });
  assert.deepEqual(eventos.filter((e) => e.tipo === "entrada").map((e) => e.telefone), ["553188887348"]);
  assert.deepEqual(eventos.filter((e) => e.tipo === "advogada").map((e) => e.telefone), ["553196936688"]);
});

test("#reiniciar apaga a conversa sem responder", async () => {
  const { conversa, storage, enviados, chamadas } = montar([{ texto: "Obrigada!", aviso }]);
  storage.deleteAll = async function () { this.limpo = true; };
  await conversa.entrada({ telefone: "553188887348", id: "a", texto: "perdi 8 mil", nome: "Ana" });
  await conversa.alarm();
  await conversa.entrada({ telefone: "553188887348", id: "b", texto: " #Reiniciar ", nome: "Ana" });
  assert.equal(storage.limpo, true);
  assert.equal(enviados.length, 2);
  assert.equal(chamadas.length, 1);
});

// Ambiente com o Diagnostico de verdade (armazenamento em memória) e a API do WhatsApp simulada.
function ambienteAvisos() {
  const mapa = new Map();
  const diag = new Diagnostico({ storage: {
    async get(k) { return structuredClone(mapa.get(k)); },
    async put(k, v) { mapa.set(k, structuredClone(v)); },
  } }, {});
  const env = {
    PHONE_NUMBER_ID: "1", WHATSAPP_TOKEN: "EAAteste", NOTIFY_TO: "5531996936688",
    // No Cloudflare, o Durable Object recebe um Request; aqui o adaptamos.
    DIAGNOSTICO: { idFromName: (n) => n, get: () => ({ fetch: (url, init) => diag.fetch(new Request(url, init)) }) },
  };
  const enviados = [];
  let proximoId = 1;
  globalThis.fetch = async (_url, init) => {
    const corpo = JSON.parse(init.body);
    enviados.push(corpo);
    return Response.json({ messages: [{ id: `wamid.${proximoId++}` }] });
  };
  const ocorrencias = async () => (await (await diag.fetch(new Request("https://diagnostico/"))).json()).map((e) => e.etapa);
  return { env, enviados, ocorrencias };
}

test("resumo que a Meta não entregou fica guardado e sai no próximo oi da advogada", async () => {
  const fetchOriginal = globalThis.fetch;
  try {
    const { env, enviados, ocorrencias } = ambienteAvisos();
    await avisarComFila(env, "553188887348", aviso);
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].to, "5531996936688");

    await tratarFalha(env, { id: "wamid.1", telefone: "5531996936688", erro: { code: 131047, title: "Re-engagement message" } });
    assert.match((await ocorrencias())[0], /resumo não entregue/);

    await entregarGuardados(env);
    assert.equal(enviados.length, 2);
    assert.match(enviados[1].text.body, /Resumo guardado de/);
    assert.match(enviados[1].text.body, /Ana/);
    assert.match((await ocorrencias())[0], /1 resumo\(s\) guardado\(s\) entregue/);

    await entregarGuardados(env); // nada mais guardado
    assert.equal(enviados.length, 2);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("passou de 24 h desde o último oi: o resumo é guardado sem tentar enviar", async () => {
  const fetchOriginal = globalThis.fetch;
  try {
    const { env, enviados, ocorrencias } = ambienteAvisos();
    const agora = Date.now();
    await entregarGuardados(env, agora - 25 * 60 * 60 * 1000); // último "oi" há 25 h
    await avisarComFila(env, "553188887348", aviso, agora);
    assert.equal(enviados.length, 0);
    assert.match((await ocorrencias())[0], /resumo guardado/);
    await entregarGuardados(env, agora);
    assert.equal(enviados.length, 1);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("webhook de status com falha vira evento", () => {
  const payload = { entry: [{ changes: [{ field: "messages", value: { statuses: [
    { id: "wamid.9", status: "failed", recipient_id: "553196936688", errors: [{ code: 131047, title: "Re-engagement message" }] },
    { id: "wamid.8", status: "delivered", recipient_id: "553188887348" },
  ] } }] }] };
  assert.deepEqual(extrairEventos(payload, {}), [
    { tipo: "falha", telefone: "553196936688", id: "wamid.9", erro: { code: 131047, title: "Re-engagement message" } },
  ]);
});
