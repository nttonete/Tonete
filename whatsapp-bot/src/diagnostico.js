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
    if (pathname.startsWith("/avisos/")) return this.avisos(pathname, request);
    const eventos = (await this.ctx.storage.get("eventos")) ?? [];
    if (request.method === "POST") {
      const ev = await request.json();
      await this.ctx.storage.put("eventos", [ev, ...eventos].slice(0, MAX_EVENTOS));
      return new Response("ok");
    }
    return Response.json(eventos);
  }

  // Avisos à advogada: os enviados recentemente (para reconhecer uma falha de entrega
  // que a Meta informa depois) e os guardados para entregar no próximo "oi" dela.
  async avisos(pathname, request) {
    const st = this.ctx.storage;
    const corpo = request.method === "POST" ? await request.json() : {};
    const enviados = (await st.get("avisosEnviados")) ?? [];
    const guardados = (await st.get("avisosGuardados")) ?? [];

    if (pathname === "/avisos/enviado") {
      await st.put("avisosEnviados", [{ id: corpo.id, aviso: corpo.aviso }, ...enviados].slice(0, 50));
      return Response.json({ ok: true });
    }
    if (pathname === "/avisos/guardar") {
      await st.put("avisosGuardados", [...guardados, corpo.aviso].slice(-50));
      return Response.json({ guardados: guardados.length + 1 });
    }
    if (pathname === "/avisos/falhou") {
      const achado = enviados.find((e) => e.id === corpo.id);
      if (!achado) return Response.json({ aviso: null });
      await st.put("avisosEnviados", enviados.filter((e) => e.id !== corpo.id));
      const aviso = { ...achado.aviso, guardadoEm: corpo.guardadoEm };
      await st.put("avisosGuardados", [...guardados, aviso].slice(-50));
      return Response.json({ aviso });
    }
    if (pathname === "/avisos/oi") {
      await st.put("ultimoOi", corpo.quando);
      await st.put("avisosGuardados", []);
      return Response.json({ guardados });
    }
    if (pathname === "/avisos/estado") {
      return Response.json({ ultimoOi: (await st.get("ultimoOi")) ?? null, guardados: guardados.length });
    }
    return new Response("não encontrado", { status: 404 });
  }
}

// Chamada genérica às rotas de avisos do Diagnostico.
export async function avisos(env, rota, corpo) {
  const diag = env.DIAGNOSTICO.get(env.DIAGNOSTICO.idFromName("geral"));
  const resp = await diag.fetch(`https://diagnostico/avisos/${rota}`, corpo === undefined
    ? {} : { method: "POST", body: JSON.stringify(corpo) });
  return resp.json();
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
