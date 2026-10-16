// Aplica as migrações de supabase/migrations/ pela API de gerenciamento do Supabase.
//
// Serve para o ambiente de nuvem, que só sai para a internet por HTTPS: o `supabase db push`
// liga direto no Postgres (porta 5432) e lá não conecta. Este script faz o mesmo por HTTPS
// e grava o histórico na mesma tabela do CLI (supabase_migrations.schema_migrations),
// então depois o `db push` de um computador comum reconhece o que já foi aplicado.
//
// Uso (precisa do token pessoal, que começa com sbp_, em SUPABASE_ACCESS_TOKEN):
//   node supabase/aplicar_migracoes.mjs            # aplica o que falta
//   node supabase/aplicar_migracoes.mjs --conferir # só mostra o que falta, sem aplicar
//
// Cada migração entra numa transação junto com o registro no histórico: ou entra inteira, ou nada.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const PROJETO = process.env.SUPABASE_PROJECT_REF || "egfglvvjdnrxjsikespe";
const API = process.env.SUPABASE_API_URL || "https://api.supabase.com";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PASTA = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const conferir = process.argv.includes("--conferir");

if (!TOKEN) {
  console.error("Falta SUPABASE_ACCESS_TOKEN (token pessoal do Supabase, começa com sbp_).");
  process.exit(1);
}

async function consultar(sql) {
  const resp = await fetch(`${API}/v1/projects/${PROJETO}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const texto = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${texto}`);
  return texto ? JSON.parse(texto) : [];
}

// Texto literal em SQL sem precisar escapar nada: $marca$...$marca$ com uma marca que não aparece no texto.
function literal(texto) {
  let marca;
  do marca = "m" + randomBytes(6).toString("hex");
  while (texto.includes(`$${marca}$`));
  return `$${marca}$${texto}$${marca}$`;
}

const arquivos = readdirSync(PASTA).filter((n) => /^\d+_.+\.sql$/.test(n)).sort();

await consultar(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
  alter table supabase_migrations.schema_migrations add column if not exists statements text[];
  alter table supabase_migrations.schema_migrations add column if not exists name text;
`);
const aplicadas = new Set(
  (await consultar("select version from supabase_migrations.schema_migrations")).map((l) => l.version),
);

const faltam = arquivos.filter((n) => !aplicadas.has(n.split("_")[0]));
for (const n of arquivos) console.log(`${faltam.includes(n) ? "falta   " : "aplicada"}  ${n}`);
if (conferir || faltam.length === 0) {
  console.log(faltam.length ? `\n${faltam.length} migração(ões) a aplicar.` : "\nO banco está em dia.");
  process.exit(0);
}

for (const n of faltam) {
  const versao = n.split("_")[0];
  const nome = n.slice(versao.length + 1, -".sql".length);
  const sql = readFileSync(join(PASTA, n), "utf8");
  process.stdout.write(`Aplicando ${n}... `);
  await consultar(`begin;
${sql}
;
insert into supabase_migrations.schema_migrations (version, name, statements)
  values (${literal(versao)}, ${literal(nome)}, array[${literal(sql)}]);
commit;`);
  console.log("ok");
}
console.log("\nPronto: o banco está em dia.");
