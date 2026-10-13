// Teste de ponta a ponta da plataforma num Chromium de verdade.
// Uso: node testes/navegador.js   (sobe um servidor local na porta 8765)
// Percorre: início, simulado, treino por matéria, correção e histórico, no celular e no computador,
// nos temas claro e escuro. Falha se houver erro de JavaScript, imagem quebrada ou fórmula não renderizada.
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const RAIZ = path.resolve(__dirname, "..");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const KATEX = fs.readFileSync(path.join(RAIZ, "ferramentas/node/node_modules/katex/dist/katex.min.js"));
const SAIDA = path.join(RAIZ, "trabalho/testes");
fs.mkdirSync(SAIDA, { recursive: true });

let falhas = 0;
function ok(cond, msg) {
  if (!cond) { falhas++; console.log("  FALHOU: " + msg); } else console.log("  ok: " + msg);
}

async function sessao(browser, nome, opcoes) {
  const ctx = await browser.newContext(opcoes);
  const page = await ctx.newPage();
  const erros = [];
  page.on("pageerror", (e) => erros.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  await page.route(/cdnjs\.cloudflare\.com\/.*katex\.min\.js/, (r) => r.fulfill({ body: KATEX, contentType: "text/javascript" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ body: "", contentType: "text/css" }));
  return { ctx, page, erros, nome };
}

async function imagensQuebradas(page) {
  return page.evaluate(() => Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src")));
}
async function formulasCruas(page) {
  // fórmula que não passou pelo KaTeX aparece como texto com "$" ou como .tex
  return page.evaluate(() => {
    const t = Array.from(document.querySelectorAll(".texto")).map((e) => e.innerText).join("\n");
    return (t.match(/\$[^$\n]{1,40}\$/g) || []).slice(0, 5).concat(document.querySelectorAll(".tex").length ? ["(KaTeX ausente)"] : []);
  });
}

async function fluxo(browser, nome, opcoes) {
  console.log(`\n== ${nome}`);
  const { ctx, page, erros } = await sessao(browser, nome, opcoes);
  await page.goto("http://127.0.0.1:8765/index.html");
  await page.waitForSelector(".modos");
  ok(await page.isVisible("text=Simulado da prova"), "tela inicial mostra os modos");
  await page.screenshot({ path: `${SAIDA}/${nome}-inicio.png`, fullPage: true });
  const largura = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok(largura[0] <= largura[1], `sem rolagem horizontal (${largura[0]} <= ${largura[1]})`);

  // simulado com 15 questões sorteadas
  await page.selectOption("#sim-qtd", "15");
  await page.click("#form-simulado button[type=submit]");
  await page.waitForSelector(".questao");
  ok(await page.locator(".grade button").count() === 15, "simulado com 15 questões no cartão-resposta");
  ok(await page.locator(".alt.correta").count() === 0, "gabarito escondido durante a prova");
  // responde 10 questões com a primeira alternativa, percorrendo todas
  for (let i = 0; i < 15; i++) {
    if (i < 10) await page.locator(".alt").first().click();
    const quebradas = await imagensQuebradas(page);
    ok(quebradas.length === 0, `questão ${i + 1}: imagens carregam ${quebradas.join(",")}`);
    const cruas = await formulasCruas(page);
    if (cruas.length) ok(false, `questão ${i + 1}: fórmula sem renderizar ${cruas.join(" | ")}`);
    if (i === 2) await page.screenshot({ path: `${SAIDA}/${nome}-questao.png`, fullPage: true });
    if (i < 14) await page.click("text=Próxima →");
  }
  await page.click(".cartao button.botao");
  await page.waitForSelector(".confirma");
  ok(await page.isVisible("text=5 questões estão sem resposta"), "confirmação avisa as questões em branco");
  await page.click(".confirma .botao >> nth=0");
  await page.waitForSelector(".placar");
  await page.screenshot({ path: `${SAIDA}/${nome}-resultado.png`, fullPage: true });
  ok(await page.locator(".lista-rev li").count() === 15, "resultado lista as 15 questões");
  const brancos = await page.locator(".estado.branco").count();
  ok(brancos === 5, `5 questões em branco no resultado (achou ${brancos})`);
  await page.click("text=Ver correção questão por questão");
  await page.waitForSelector(".alt.correta, .selo.anulada");
  ok(await page.locator(".alt.correta").count() <= 1, "correção mostra a alternativa correta");
  await page.screenshot({ path: `${SAIDA}/${nome}-correcao.png`, fullPage: true });

  // novo treino por matéria
  await page.click("text=Voltar ao resultado");
  await page.click("text=Novo treino");
  await page.waitForSelector("#form-materia");
  await page.locator('#form-materia input[value="matematica"]').uncheck();
  await page.locator('#form-materia input[name="mat-materia"]').first().check();
  await page.selectOption("#mat-qtd", "10");
  await page.click("#form-materia button[type=submit]");
  await page.waitForSelector(".questao");
  const n = await page.locator(".grade button").count();
  ok(n > 0 && n <= 10, `treino por matéria com até 10 questões (${n})`);
  await page.keyboard.press("b");
  ok(await page.locator('.alt[aria-pressed="true"]').count() === 1, "atalho de teclado marca alternativa");
  // recarregar mantém a sessão
  await page.reload();
  await page.waitForSelector(".continuar");
  ok(await page.isVisible("text=Continuar"), "sessão em andamento é retomada após recarregar");
  await page.click(".continuar .botao");
  await page.waitForSelector(".questao");
  ok(await page.locator('.alt[aria-pressed="true"]').count() === 1, "resposta marcada foi preservada");

  await page.click("#nav-historico");
  await page.waitForSelector("text=Seu histórico");
  ok(await page.locator(".historico li").count() === 1, "histórico registra o simulado");
  await page.screenshot({ path: `${SAIDA}/${nome}-historico.png`, fullPage: true });

  ok(erros.length === 0, "sem erros de JavaScript " + erros.slice(0, 3).join(" | "));
  await ctx.close();
}

(async () => {
  const servidor = spawn("python3", ["-m", "http.server", "8765", "--bind", "127.0.0.1"], { cwd: RAIZ, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  try {
    await fluxo(browser, "celular-claro", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await fluxo(browser, "computador-escuro", { viewport: { width: 1366, height: 900 }, colorScheme: "dark" });
  } finally {
    await browser.close();
    servidor.kill();
  }
  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
