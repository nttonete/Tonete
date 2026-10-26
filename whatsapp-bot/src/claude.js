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
// úteis (segunda a sexta) depois de hoje, às 9h, 10h e 11h, no horário de Brasília.
// Feriados não entram na conta: a advogada sempre confirma o horário com a pessoa.
const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
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
    if (semana === 0 || semana === 6) continue;
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
