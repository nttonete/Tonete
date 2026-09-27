import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, FERRAMENTA_AVISAR } from "./prompt.js";

export function agoraEmBrasilia(data = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(data);
}

// Gera a próxima resposta da assistente.
// historico: [{ role: "user" | "assistant", content: string }], terminando em "user".
// Retorna { texto, aviso, recusado }: aviso é o input de avisar_advogada, se usada.
export async function responder(env, historico, { cliente, agora = new Date() } = {}) {
  const anthropic = cliente ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

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
      { role: "system", content: `Agora: ${agoraEmBrasilia(agora)} (horário de Brasília). Responda direto, é uma conversa em tempo real.` },
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
