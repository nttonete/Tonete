// Registro das últimas ocorrências do robô, para conferir pelo celular onde algo travou.
// Guarda só horários, etapas e mensagens de erro, nunca o conteúdo das conversas.
import { DurableObject } from "cloudflare:workers";

const MAX_EVENTOS = 30;

// Classe com armazenamento SQLite do Cloudflare (precisa estender DurableObject).
export class Diagnostico extends DurableObject {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    // Guarda quem mandou a última mensagem, para zerar testes sem digitar o número.
    if (pathname === "/ultimo") {
      if (request.method === "POST") {
        await this.ctx.storage.put("ultimo", (await request.json()).telefone);
        return new Response("ok");
      }
      return Response.json({ telefone: (await this.ctx.storage.get("ultimo")) ?? null });
    }
    const eventos = (await this.ctx.storage.get("eventos")) ?? [];
    if (request.method === "POST") {
      const ev = await request.json();
      await this.ctx.storage.put("eventos", [ev, ...eventos].slice(0, MAX_EVENTOS));
      return new Response("ok");
    }
    return Response.json(eventos);
  }
}

// Nunca deixa um problema no registro atrapalhar o atendimento.
export async function registrar(env, etapa, detalhe = "") {
  if (!env.DIAGNOSTICO) return;
  try {
    const diag = env.DIAGNOSTICO.get(env.DIAGNOSTICO.idFromName("geral"));
    const quando = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await diag.fetch("https://diagnostico/", {
      method: "POST",
      body: JSON.stringify({ quando, etapa, detalhe: String(detalhe).slice(0, 400) }),
    });
  } catch (erro) {
    console.error("registrar diagnóstico:", erro);
  }
}

export async function lerDiagnostico(env) {
  const diag = env.DIAGNOSTICO.get(env.DIAGNOSTICO.idFromName("geral"));
  return (await diag.fetch("https://diagnostico/")).json();
}

export async function anotarUltimo(env, telefone) {
  if (!env.DIAGNOSTICO) return;
  try {
    const diag = env.DIAGNOSTICO.get(env.DIAGNOSTICO.idFromName("geral"));
    await diag.fetch("https://diagnostico/ultimo", { method: "POST", body: JSON.stringify({ telefone }) });
  } catch (erro) {
    console.error("anotar último remetente:", erro);
  }
}

export async function lerUltimo(env) {
  const diag = env.DIAGNOSTICO.get(env.DIAGNOSTICO.idFromName("geral"));
  return (await (await diag.fetch("https://diagnostico/ultimo")).json()).telefone;
}
