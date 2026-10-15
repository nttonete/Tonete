// Teste da conta e da sincronização num Chromium de verdade, com um Supabase simulado.
// Uso: node testes/nuvem.js   (sobe um servidor local na porta 8766)
// Percorre: sem configuração nada muda; criar conta (menor de idade, confirmação por e-mail);
// juntar os dados de dois aparelhos, inclusive com alterações simultâneas; assinatura pelo
// Mercado Pago (simulado); corrigir o cadastro; baixar os dados; sair; excluir a conta.
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const RAIZ = path.resolve(__dirname, "..");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const SITE = "http://127.0.0.1:8766/index.html";
const SUPA = "https://egfglvvjdnrxjsikespe.supabase.co";
const SAIDA = path.join(RAIZ, "trabalho/testes");
fs.mkdirSync(SAIDA, { recursive: true });

let falhas = 0;
function ok(cond, msg) {
  if (!cond) { falhas++; console.log("  FALHOU: " + msg); } else console.log("  ok: " + msg);
}

// ---------- Supabase falso, compartilhado pelos dois "aparelhos" ----------
const srv = { usuarios: {}, tokens: {}, dados: {}, perfis: {}, assinaturas: [], seq: 0, consultasAssinatura: 0, pedidos: [] };
function carimbo() { srv.seq++; return new Date(Date.UTC(2026, 9, 15, 12, 0, srv.seq)).toISOString().replace("Z", "123+00:00"); }
function sessao(u) {
  const t = "tk-" + u.id + "-" + (++srv.seq);
  srv.tokens[t] = u.id;
  return { access_token: t, refresh_token: "rf-" + t, expires_in: 3600, token_type: "bearer", user: { id: u.id, email: u.email } };
}
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
async function supabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const metodo = req.method();
  if (metodo === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  srv.pedidos.push(metodo + " " + url.pathname);
  const corpo = req.postData() ? JSON.parse(req.postData()) : null;
  const json = (dados, status = 200) => route.fulfill({ status, headers: { ...CORS, "Content-Type": "application/json" }, body: dados === null ? "" : JSON.stringify(dados) });
  const uid = srv.tokens[(req.headers().authorization || "").replace("Bearer ", "")];
  const f = Object.fromEntries(url.searchParams);
  const p = url.pathname;

  if (p === "/auth/v1/signup") {
    const id = "u" + (Object.keys(srv.usuarios).length + 1);
    const u = srv.usuarios[corpo.email] = { id, email: corpo.email, senha: corpo.password };
    const m = corpo.data;
    srv.perfis[id] = { id, nome: m.nome, nascimento: m.nascimento, responsavel_nome: m.responsavel_nome, responsavel_email: m.responsavel_email, termos_versao: m.termos_versao, privacidade_versao: m.privacidade_versao };
    srv.ultimoCadastro = u;
    return json({ id, email: u.email, confirmation_sent_at: "agora" }); // pede confirmação por e-mail
  }
  if (p === "/auth/v1/token" && f.grant_type === "password") {
    const u = srv.usuarios[corpo.email];
    if (!u || u.senha !== corpo.password) return json({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
    return json(sessao(u));
  }
  if (p === "/auth/v1/user" && metodo === "GET") {
    const u = Object.values(srv.usuarios).find((x) => x.id === uid);
    return u ? json({ id: u.id, email: u.email }) : json({ msg: "invalid JWT" }, 401);
  }
  if (p === "/auth/v1/logout") return json(null, 204);
  if (!uid) return json({ message: "JWT expired", code: "PGRST301" }, 401);

  if (p === "/rest/v1/dados_aluno") {
    const meus = srv.dados[uid] = srv.dados[uid] || {};
    if (metodo === "GET") return json(Object.keys(meus).map((k) => ({ chave: k, ...meus[k] })));
    if (metodo === "POST") {
      if (meus[corpo.chave]) return json({ code: "23505", message: "duplicate key" }, 409);
      meus[corpo.chave] = { valor: corpo.valor, atualizado_em: carimbo() };
      return json([{ chave: corpo.chave, ...meus[corpo.chave] }], 201);
    }
    const k = f.chave.replace("eq.", "");
    const casa = meus[k] && (!f.atualizado_em || meus[k].atualizado_em === f.atualizado_em.replace("eq.", ""));
    if (!casa) return json([]);
    if (metodo === "PATCH") { meus[k] = { valor: corpo.valor, atualizado_em: carimbo() }; return json([{ chave: k, ...meus[k] }]); }
    if (metodo === "DELETE") { const v = meus[k]; delete meus[k]; return json([{ chave: k, ...v }]); }
  }
  if (p === "/rest/v1/perfis") {
    if (metodo === "PATCH") Object.assign(srv.perfis[uid], corpo);
    return json([srv.perfis[uid]]);
  }
  if (p === "/rest/v1/assinaturas") {
    // o aviso do Mercado Pago "chega" na segunda consulta depois da compra
    const minhas = srv.assinaturas.filter((a) => a.user_id === uid);
    if (minhas.some((a) => a.status === "pendente") && ++srv.consultasAssinatura >= 2) {
      minhas.forEach((a) => { a.status = "ativa"; a.mp_pagamento_id = "555"; a.inicio = "2026-10-15T12:00:00Z"; a.fim = "2027-10-15T12:00:00Z"; });
    }
    return json(minhas);
  }
  if (p === "/rest/v1/rpc/tem_acesso") return json(srv.assinaturas.some((a) => a.user_id === uid && a.status === "ativa"));
  if (p === "/functions/v1/mp-checkout") {
    if (metodo === "GET") return json({ planos: [{ id: "anual", nome: "Banca Aberta: 12 meses de acesso", centavos: 19900, dias: 365 }] });
    srv.assinaturas.push({ user_id: uid, plano: corpo.plano, status: "pendente", valor_centavos: 19900, dias: 365, criado_em: "2026-10-15T12:00:00Z", mp_pagamento_id: null });
    // no lugar do Mercado Pago, volta direto como se o pagamento tivesse sido aprovado
    return json({ endereco: SITE + "?pagamento=aprovado&collection_id=555&status=approved" });
  }
  if (p === "/functions/v1/excluir-conta") {
    const email = Object.keys(srv.usuarios).find((e) => srv.usuarios[e].id === uid);
    delete srv.usuarios[email]; delete srv.dados[uid]; delete srv.perfis[uid];
    srv.assinaturas = srv.assinaturas.filter((a) => a.user_id !== uid);
    return json({ ok: true });
  }
  return json({ message: "rota não simulada: " + metodo + " " + p }, 404);
}

async function aparelho(browser, nome, opcoes, comChave = true) {
  const ctx = await browser.newContext(opcoes);
  const page = await ctx.newPage();
  const erros = [], externos = [];
  page.on("pageerror", (e) => erros.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });
  page.on("request", (r) => { if (!/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(r.url()) && !r.url().startsWith(SUPA)) externos.push(r.url()); });
  if (comChave) {
    await page.route(/\/app\/config\.js$/, (r) => r.fulfill({ contentType: "text/javascript", body: `window.BancaConfig = { supabaseUrl: "${SUPA}", supabaseChave: "chave-publica-de-teste" };` }));
  }
  await page.route(SUPA + "/**", supabase);
  return { ctx, page, erros, externos, nome };
}
const local = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem("banca-aberta:" + k)), k);
const gravarLocal = (page, k, v) => page.evaluate(([k, v]) => { localStorage.setItem("banca-aberta:" + k, JSON.stringify(v)); if (window.Nuvem) Nuvem.alterado("banca-aberta:" + k); }, [k, v]);
const tentativa = (titulo, quando) => ({ titulo, quando, duracao: 60000, certas: 1, parciais: 0, total: 2, tipo: "objetiva", modo: "simulado", materias: { matematica: { certas: 1, total: 2 } }, questoes: [] });
async function ateSincronizar(page) {
  await page.waitForFunction(() => window.Nuvem.situacao() === "ok", null, { timeout: 10000 });
}

(async () => {
  const servidor = spawn("python3", ["-m", "http.server", "8766", "--bind", "127.0.0.1"], { cwd: RAIZ, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  try {
    console.log("\n== sem chave configurada");
    {
      const a = await aparelho(browser, "sem-chave", { viewport: { width: 390, height: 844 } }, false);
      await a.page.goto(SITE);
      await a.page.waitForSelector(".modos");
      ok(await a.page.isHidden("#nav-conta"), "sem configuração, o botão de conta não aparece");
      ok(srv.pedidos.length === 0, "sem configuração, nenhum pedido ao servidor");
      await a.ctx.close();
    }

    console.log("\n== aparelho 1 (celular): cadastro de menor com confirmação por e-mail");
    const um = await aparelho(browser, "aparelho-1", { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    let pg = um.page;
    await pg.goto(SITE);
    await pg.waitForSelector(".modos");
    await gravarLocal(pg, "historico", [tentativa("Feito sem conta no celular", 1000)]);
    await gravarLocal(pg, "obras-lidas", { "fuvest-a": 5 });
    ok(await pg.textContent("#nav-conta") === "Entrar", "botão Entrar aparece no topo");
    const largura = await pg.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    ok(largura[0] <= largura[1], `topo cabe em 360 px sem rolagem horizontal (${largura[0]} <= ${largura[1]})`);
    await pg.click("#nav-conta");
    await pg.waitForSelector("#form-entrar");
    await pg.click(".seg >> text=Criar conta");
    await pg.waitForSelector("#form-cadastro");
    await pg.fill("#cad-nome", "Aluna Teste");
    await pg.fill("#cad-email", "aluna@exemplo.com");
    await pg.fill("#cad-senha", "senha-boa-123");
    await pg.fill("#cad-nasc", "2010-05-20");
    ok(await pg.isVisible("#cad-resp"), "menor de 18: pede os dados do responsável");
    await pg.click("#form-cadastro button[type=submit]");
    ok(/responsável/.test(await pg.textContent(".erro-form")), "não cria conta de menor sem o responsável");
    await pg.fill("#cad-resp-nome", "Mãe da Aluna");
    await pg.fill("#cad-resp-email", "mae@exemplo.com");
    await pg.check("#cad-resp-ciente");
    await pg.click("#form-cadastro button[type=submit]");
    ok(/Termos de Uso/.test(await pg.textContent(".erro-form")), "não cria conta sem aceitar os Termos e a Privacidade");
    // o link dos Termos abre a página e volta para o formulário, sem perder o que foi digitado
    await pg.click("#form-cadastro >> text=Termos de Uso");
    await pg.waitForSelector(".pagina-legal h1");
    await pg.click(".pagina-legal >> text=Voltar");
    await pg.waitForSelector("#form-cadastro");
    ok(await pg.inputValue("#cad-nome") === "Aluna Teste", "voltar dos Termos mantém o que foi digitado");
    await pg.fill("#cad-senha", "senha-boa-123");
    await pg.check("#cad-aceite");
    await pg.click("#form-cadastro button[type=submit]");
    await pg.waitForSelector("text=Quase lá");
    const perfil = srv.perfis[srv.ultimoCadastro.id];
    ok(perfil && perfil.responsavel_email === "mae@exemplo.com" && perfil.nascimento === "2010-05-20" && perfil.termos_versao, "cadastro leva nascimento, responsável e versão dos termos");

    // a aluna toca no link do e-mail de confirmação
    const s1 = sessao(srv.ultimoCadastro);
    await pg.goto("about:blank"); // o link abre a página do zero (mudar só o # não recarrega)
    await pg.goto(`${SITE}#access_token=${s1.access_token}&refresh_token=${s1.refresh_token}&expires_in=3600&token_type=bearer&type=signup`);
    await pg.waitForSelector("text=E-mail confirmado");
    ok(await pg.isVisible("text=aluna@exemplo.com"), "volta do e-mail entra na conta");
    ok(!(await pg.evaluate(() => location.hash)), "os tokens saem do endereço");
    await ateSincronizar(pg);
    ok(await pg.isVisible("text=Tudo guardado na sua conta."), "mostra que tudo está guardado na conta");
    const uid = srv.ultimoCadastro.id;
    ok((srv.dados[uid].historico || {}).valor.length === 1, "o que foi feito sem conta subiu para a conta");
    ok(await pg.textContent("#nav-conta") === "Conta", "botão do topo vira Conta");
    await pg.screenshot({ path: `${SAIDA}/conta-celular.png`, fullPage: true });

    console.log("\n== aparelho 2 (computador, escuro): entrar e juntar os dados");
    const dois = await aparelho(browser, "aparelho-2", { viewport: { width: 1366, height: 900 }, colorScheme: "dark" });
    const pg2 = dois.page;
    await pg2.goto(SITE);
    await pg2.waitForSelector(".modos");
    await gravarLocal(pg2, "historico", [tentativa("Feito sem conta no computador", 2000)]);
    await pg2.click("#nav-conta");
    await pg2.fill("#conta-email", "aluna@exemplo.com");
    await pg2.fill("#conta-senha", "senha-errada");
    await pg2.click("#form-entrar button[type=submit]");
    await pg2.waitForSelector(".erro-form");
    ok(await pg2.textContent(".erro-form") === "E-mail ou senha incorretos.", "senha errada: mensagem em português");
    await pg2.fill("#conta-senha", "senha-boa-123");
    await pg2.click("#form-entrar button[type=submit]");
    await pg2.waitForSelector("text=Você entrou na sua conta.");
    await ateSincronizar(pg2);
    let h2 = await local(pg2, "historico");
    ok(h2.length === 2 && h2[0].quando === 2000, "aparelho 2 junta o histórico dos dois aparelhos, mais recente primeiro");
    ok((await local(pg2, "obras-lidas"))["fuvest-a"] === 5, "aparelho 2 recebe as obras marcadas no aparelho 1");
    ok(srv.dados[uid].historico.valor.length === 2, "conta fica com os dois históricos");

    console.log("\n== alterações nos dois aparelhos ao mesmo tempo");
    // aparelho 1 ainda não viu o que o 2 enviou; os dois acrescentam uma tentativa
    await gravarLocal(pg2, "historico", [tentativa("Computador depois", 4000)].concat(h2));
    await pg2.evaluate(() => Nuvem.sincronizar());
    const h1antes = await local(pg, "historico");
    await gravarLocal(pg, "historico", [tentativa("Celular depois", 3000)].concat(h1antes));
    await pg.evaluate(() => Nuvem.sincronizar());
    const h1 = await local(pg, "historico");
    ok(h1.map((t) => t.quando).join(",") === "4000,3000,2000,1000", `nada se perde quando os dois mudam ao mesmo tempo (${h1.map((t) => t.quando)})`);
    ok(srv.dados[uid].historico.valor.length === 4, "conta fica com as quatro tentativas");
    await pg2.evaluate(() => Nuvem.sincronizar());
    ok((await local(pg2, "historico")).length === 4, "aparelho 2 recebe a junção");
    // uma sessão descartada num aparelho some no outro
    await gravarLocal(pg2, "sessao", { titulo: "Simulado", inicio: 10, refs: [], respostas: {}, edicoes: [] });
    await pg2.evaluate(() => Nuvem.sincronizar());
    await pg.evaluate(() => Nuvem.sincronizar());
    ok((await local(pg, "sessao")).titulo === "Simulado", "prova em andamento passa para o outro aparelho");
    await gravarLocal(pg, "sessao", null);
    await pg.evaluate(() => Nuvem.sincronizar());
    await pg2.evaluate(() => Nuvem.sincronizar());
    ok((await local(pg2, "sessao")) === null && !srv.dados[uid].sessao, "prova descartada some da conta e do outro aparelho");

    console.log("\n== assinatura (Mercado Pago simulado)");
    await pg2.click("#nav-conta");
    await pg2.waitForSelector(".planos li");
    ok(await pg2.isVisible("text=R$ 199,00"), "mostra o preço total do plano");
    ok(await pg2.isVisible("text=sem renovação automática"), "avisa que não há renovação automática");
    ok(await pg2.isVisible("text=desistir da compra em até 7 dias"), "informa o direito de arrependimento");
    await pg2.click(".planos button");
    await pg2.waitForSelector("text=Pagamento aprovado");
    ok(!/pagamento=/.test(await pg2.evaluate(() => location.search)), "parâmetros da volta do pagamento saem do endereço");
    await pg2.waitForSelector("text=Acesso liberado até", { timeout: 10000 });
    ok(true, "acesso aparece liberado quando o aviso do pagamento chega");
    ok(await pg2.evaluate(() => Nuvem.temAcesso()), "tem_acesso responde que sim");
    await pg2.screenshot({ path: `${SAIDA}/conta-computador-escuro.png`, fullPage: true });

    console.log("\n== cadastro, cópia dos dados e saída");
    await pg2.waitForSelector("#form-perfil");
    await pg2.fill("#perfil-nome", "Aluna Corrigida");
    await pg2.click("#form-perfil button[type=submit]");
    await pg2.waitForSelector("text=Cadastro atualizado.");
    ok(srv.perfis[uid].nome === "Aluna Corrigida", "aluna corrige o próprio cadastro");
    const [download] = await Promise.all([pg2.waitForEvent("download"), pg2.click("#conta-exportar")]);
    const copia = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    ok(copia.perfil.nome === "Aluna Corrigida" && copia.dados_de_estudo.length >= 2 && copia.assinaturas.length === 1, "cópia dos dados traz cadastro, estudo e assinaturas");
    await pg2.click("#conta-sair");
    await pg2.waitForSelector("text=Você saiu da conta.");
    ok((await local(pg2, "historico")) === null, "ao sair, os dados saem do aparelho");
    ok(await pg2.textContent("#nav-conta") === "Entrar", "depois de sair, o topo volta a Entrar");
    ok(srv.dados[uid].historico.valor.length === 4, "os dados continuam na conta");

    console.log("\n== exclusão da conta");
    await pg.click("#nav-conta");
    await pg.waitForSelector("#conta-excluir");
    await pg.click("#conta-excluir");
    ok(await pg.isDisabled(".confirma-exclusao .perigo"), "exclusão exige digitar EXCLUIR");
    await pg.fill("#excluir-confirma", "excluir");
    await pg.click(".confirma-exclusao .perigo");
    await pg.waitForSelector("text=Sua conta e seus dados foram excluídos.");
    ok(!srv.perfis[uid] && !srv.dados[uid] && !Object.values(srv.usuarios).length, "conta, cadastro e dados apagados no servidor");
    ok((await local(pg, "historico")) === null && (await local(pg, "conta")) === null, "e apagados do aparelho");

    for (const a of [um, dois]) {
      ok(a.erros.length === 0, `${a.nome}: sem erros de JavaScript ` + a.erros.slice(0, 3).join(" | "));
      ok(a.externos.length === 0, `${a.nome}: nenhum pedido a outros servidores ` + a.externos.slice(0, 3).join(" | "));
      await a.ctx.close();
    }
  } finally {
    await browser.close();
    servidor.kill();
  }
  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
