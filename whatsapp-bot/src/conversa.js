// Uma instância (Durable Object) por número de cliente. Ela guarda o histórico,
// junta mensagens mandadas em sequência e processa uma resposta por vez.
import { DurableObject } from "cloudflare:workers";
import { responder } from "./claude.js";
import { enviarTexto, marcarLida, avisarAdvogada } from "./whatsapp.js";
import { registrar } from "./diagnostico.js";
import { MENSAGEM_FINAL_PADRAO, MENSAGEM_ERRO, MENSAGEM_JA_ENCAMINHADO, mensagemLink } from "./prompt.js";

const TRINTA_DIAS = 30 * 24 * 60 * 60 * 1000;
const MAX_HISTORICO = 60;
const MAX_TENTATIVAS = 3;
const SEIS_HORAS = 6 * 60 * 60 * 1000;

function estadoInicial() {
  return {
    telefone: null,
    nome: null,
    historico: [],
    pendentes: [],
    vistos: [],
    // "robo": faz a triagem. "encaminhado": triagem feita; só lembra o link do escritório.
    // "humano": alguém respondeu por este número pelo app; o robô fica quieto.
    status: "robo",
    ultimoContato: 0,
    ultimoLembrete: 0,
    falhas: 0,
  };
}

export class Conversa extends DurableObject {
  constructor(ctx, env, deps = {}) {
    super(ctx, env);
    this.deps = { responder, enviarTexto, marcarLida, avisarAdvogada, registrar, agora: () => Date.now(), ...deps };
    this.dados = null;
  }

  async carregar() {
    if (!this.dados) this.dados = (await this.ctx.storage.get("dados")) ?? estadoInicial();
    return this.dados;
  }

  salvar() {
    return this.ctx.storage.put("dados", this.dados);
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    const corpo = await request.json();
    if (pathname === "/entrada") await this.entrada(corpo);
    else if (pathname === "/zerar") await this.zerar();
    else if (pathname === "/eco") await this.eco();
    else return new Response("não encontrado", { status: 404 });
    return new Response("ok");
  }

  // Mensagem do cliente: guarda e agenda a resposta para daqui a alguns segundos,
  // para responder de uma vez quem manda várias mensagens seguidas.
  async entrada({ telefone, id, texto, nome }) {
    const d = await this.carregar();
    if (d.vistos.includes(id)) return; // a Meta reenvia webhooks
    d.vistos = [...d.vistos, id].slice(-100);

    const agora = this.deps.agora();
    if (d.ultimoContato && agora - d.ultimoContato > TRINTA_DIAS) {
      Object.assign(d, estadoInicial(), { vistos: d.vistos });
    }
    d.ultimoContato = agora;
    d.telefone = telefone;
    if (nome) d.nome = nome;

    if (d.status === "humano") {
      await this.salvar();
      return;
    }
    d.pendentes.push({ id, texto });
    await this.salvar();
    await this.ctx.storage.setAlarm(agora + Number(this.env.DEBOUNCE_MS || 8000));
  }

  // Apaga a conversa (usado para refazer testes pelo diagnóstico).
  async zerar() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.dados = null;
  }

  // Alguém respondeu pelo app WhatsApp Business: a advogada assumiu a conversa.
  async eco() {
    const d = await this.carregar();
    d.status = "humano";
    d.pendentes = [];
    await this.salvar();
    await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    const d = await this.carregar();
    if (d.status === "humano" || d.pendentes.length === 0) return;
    if (d.status === "encaminhado") return this.lembrarLink(d);

    const lote = d.pendentes;
    d.pendentes = [];
    await this.salvar();
    await this.deps.marcarLida(this.env, lote[lote.length - 1].id);

    await this.deps.registrar(this.env, "gerando resposta", `${lote.length} mensagem(ns) juntas`);
    const mensagemCliente = { role: "user", content: lote.map((m) => m.texto).join("\n") };
    let resultado;
    try {
      resultado = await this.deps.responder(this.env, [...d.historico, mensagemCliente]);
    } catch (erro) {
      console.error("Falha ao gerar resposta:", erro);
      await this.deps.registrar(this.env, "erro ao gerar resposta (Claude)", erro?.message ?? erro);
      d.falhas += 1;
      if (d.falhas < MAX_TENTATIVAS) {
        d.pendentes = [...lote, ...d.pendentes];
        await this.salvar();
        throw erro; // o Cloudflare tenta o alarme de novo, com espera crescente
      }
      resultado = { texto: "", aviso: null, recusado: true };
    }
    d.falhas = 0;

    let { texto, aviso } = resultado;
    if (resultado.recusado || (!texto && !aviso)) {
      texto = MENSAGEM_ERRO;
      aviso = avisoDeFalha(d.nome);
    }
    if (!texto) texto = MENSAGEM_FINAL_PADRAO;

    // A advogada pode ter assumido enquanto a resposta era gerada.
    if (d.status !== "robo") return;

    d.historico = cortar([...d.historico, mensagemCliente]);
    if (aviso) {
      d.status = "encaminhado";
      d.ultimoLembrete = this.deps.agora();
    }
    await this.salvar();

    // Só entra no histórico o que o cliente de fato recebeu; senão a IA "lembra"
    // de respostas que nunca chegaram e acha que o cliente está repetindo.
    if (await this.enviar(d.telefone, texto)) {
      d.historico = cortar([...d.historico, { role: "assistant", content: texto }]);
      await this.salvar();
    }
    if (aviso) {
      await this.enviarLink(d.telefone);
      try {
        await this.deps.avisarAdvogada(this.env, d.telefone, aviso);
      } catch (erro) {
        console.error("Falha ao avisar a advogada:", erro);
        await this.deps.registrar(this.env, "erro ao avisar a advogada", erro?.message ?? erro);
      }
    }
  }

  // Quem volta a escrever depois da triagem recebe de novo o link do escritório,
  // no máximo uma vez a cada 6 horas.
  async lembrarLink(d) {
    d.pendentes = [];
    const agora = this.deps.agora();
    if (agora - d.ultimoLembrete < SEIS_HORAS) return this.salvar();
    d.ultimoLembrete = agora;
    await this.salvar();
    await this.enviar(d.telefone, MENSAGEM_JA_ENCAMINHADO);
    await this.enviarLink(d.telefone);
  }

  enviarLink(telefone) {
    if (!this.env.NUMERO_ESCRITORIO) return;
    return this.enviar(telefone, mensagemLink(this.env.NUMERO_ESCRITORIO));
  }

  async enviar(telefone, texto) {
    try {
      await this.deps.enviarTexto(this.env, telefone, texto);
      await this.deps.registrar(this.env, "resposta enviada ao cliente");
      return true;
    } catch (erro) {
      console.error("Falha ao enviar mensagem:", erro);
      await this.deps.registrar(this.env, "erro ao enviar mensagem pelo WhatsApp", erro?.message ?? erro);
      return false;
    }
  }
}

function avisoDeFalha(nome) {
  return {
    nome: nome || "não informado",
    cidade: "não informado",
    tipo_golpe: "não informado",
    data_golpe: "não informado",
    valor: "não informado",
    banco: "não informado",
    contestou_banco: "não informado",
    boletim_ocorrencia: "não informado",
    resumo: "O robô não conseguiu responder este contato. Veja a conversa no WhatsApp.",
    prioridade: "normal",
    motivo: "falha_do_robo",
  };
}

// Mantém o histórico curto e sempre começando por mensagem do cliente.
function cortar(historico) {
  let h = historico.slice(-MAX_HISTORICO);
  while (h.length && h[0].role !== "user") h = h.slice(1);
  return h;
}
