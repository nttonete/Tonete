// Perfis disponíveis. Cada cliente escolhe o seu em PERFIL (wrangler.toml).
// Para um cliente novo: crie o arquivo do perfil (veja demo-trabalhista.js) e registre aqui.
import ntGolpePix from "./nt-golpe-pix.js";
import demoTrabalhista from "./demo-trabalhista.js";

const PERFIS = Object.fromEntries([ntGolpePix, demoTrabalhista].map((p) => [p.id, p]));

export function perfilDe(env) {
  const id = String(env.PERFIL ?? "").trim();
  const perfil = PERFIS[id];
  if (!perfil) {
    throw new Error(`PERFIL "${id}" não existe. Opções: ${Object.keys(PERFIS).join(", ")}`);
  }
  return perfil;
}

export const NOMES_PERFIS = Object.keys(PERFIS);
