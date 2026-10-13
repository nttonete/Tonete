// Renderiza textos com o mesmo código da plataforma (app/render.js) e aponta erros.
// Entrada (stdin): JSON [{"ref": "...", "texto": "..."}]. Saída: JSON [{"ref", "erro"}] e figuras usadas.
const path = require("path");
const katex = require(path.join(__dirname, "node/node_modules/katex"));
const Render = require(path.join(__dirname, "../app/render.js"))(katex);

let entrada = "";
process.stdin.on("data", (d) => (entrada += d));
process.stdin.on("end", () => {
  const itens = JSON.parse(entrada);
  const erros = [];
  const figuras = [];
  for (const { ref, texto } of itens) {
    const usadas = [];
    try {
      Render.renderizar(texto, { figurasUsadas: usadas });
    } catch (e) {
      erros.push({ ref, erro: String(e.message || e).slice(0, 300) });
    }
    usadas.forEach((id) => figuras.push({ ref, id }));
  }
  process.stdout.write(JSON.stringify({ erros, figuras }));
});
