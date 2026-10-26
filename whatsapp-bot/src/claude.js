import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, FERRAMENTA_AVISAR } from "./prompt.js";

export function agoraEmBrasilia(data = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(data);
}

// Três horários para a conversa com a advogada: um por dia, nos próximos três dias
// úteis depois de hoje, às 9h, 10h e 11h, no horário de Brasília. Dia útil é de segunda
// a sexta, fora os feriados nacionais e os dias de Carnaval, Sexta-feira Santa e Corpus
// Christi. Feriados estaduais e municipais não entram: a advogada sempre confirma o horário.
const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];

// Domingo de Páscoa (algoritmo de Meeus), em UTC ao meio-dia.
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia, 12));
}

const chave = (data) => `${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(data.getUTCDate()).padStart(2, "0")}`;

export function feriado(data) {
  if (FIXOS.includes(chave(data))) return true;
  const p = pascoa(data.getUTCFullYear());
  const deslocados = [-48, -47, -2, 60].map((dias) => { const x = new Date(p); x.setUTCDate(x.getUTCDate() + dias); return x.getTime(); });
  return deslocados.includes(data.getTime());
}
export function horariosParaOferecer(agora = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(agora).map((p) => [p.type, p.value]));
  const dia = new Date(Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), 12));
  const horarios = [];
  const horas = [9, 10, 11];
  while (horarios.length < 3) {
    dia.setUTCDate(dia.getUTCDate() + 1);
    const semana = dia.getUTCDay();
    if (semana === 0 || semana === 6 || feriado(dia)) continue;
    const dd = String(dia.getUTCDate()).padStart(2, "0");
    const mm = String(dia.getUTCMonth() + 1).padStart(2, "0");
    horarios.push(`${DIAS[semana]}, ${dd}/${mm}, às ${horas[horarios.length]}h`);
  }
  return horarios;
}

// Gera a próxima resposta da assistente.
// historico: [{ role: "user" | "assistant", content: string }], terminando em "user".
// Retorna { texto, aviso, recusado }: aviso é o input de avisar_advogada, se usada.
export async function responder(env, historico, { cliente, agora = new Date() } = {}) {
  const anthropic = cliente ?? new Anthropic({ apiKey: String(env.ANTHROPIC_API_KEY ?? "").trim() });

  const resposta = await anthropic.beta.messages.create({
    model: env.CLAUDE_MODEL || "claude-opus-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: env.CLAUDE_EFFORT || "medium" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [FERRAMENTA_AVISAR],
    messages: [
      ...historico,
      // Fica fora do prompt fixo para não invalidar o cache; não é guardada no histórico.
      { role: "system", content: `Agora: ${agoraEmBrasilia(agora)} (horário de Brasília). Responda direto, é uma conversa em tempo real. Horários para oferecer: ${horariosParaOferecer(agora).join("; ")}.` },
    ],
  });

  if (resposta.stop_reason === "refusal") {
    return { texto: "", aviso: null, recusado: true };
  }

  let texto = "";
  let aviso = null;
  for (const bloco of resposta.content) {
    if (bloco.type === "text") texto += bloco.text;
    if (bloco.type === "tool_use" && bloco.name === FERRAMENTA_AVISAR.name) {
      aviso = typeof bloco.input === "string" ? JSON.parse(bloco.input) : bloco.input;
    }
  }
  return { texto: texto.trim(), aviso, recusado: false };
}
