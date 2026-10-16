// Aviso de cada novo caso para a advogada, sem perder nenhum.
//
// O WhatsApp só entrega mensagem livre a quem escreveu para o robô nas últimas 24 h.
// Fora dessa janela, a Meta aceita o envio e só depois avisa que falhou (webhook de
// status). Por isso o robô:
//  - guarda o aviso direto, se já sabe que a janela está fechada;
//  - guarda o aviso que voltar com falha;
//  - entrega todos os guardados quando a advogada manda o próximo "oi".
// Com um modelo de mensagem aprovado (NOTIFY_TEMPLATE) não há janela e o envio é direto.
import { avisarAdvogada } from "./whatsapp.js";
import { avisos, registrar } from "./diagnostico.js";

const JANELA = 24 * 60 * 60 * 1000 - 10 * 60 * 1000; // 24 h, com 10 min de folga

const final = (tel) => String(tel).slice(-4);
const agoraBR = () => new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo",
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function enviar(env, aviso) {
  const resp = await avisarAdvogada(env, aviso.telefone, aviso.dados, aviso.guardadoEm);
  const id = resp?.messages?.[0]?.id;
  if (id) await avisos(env, "enviado", { id, aviso });
}

// Usado ao fim de cada triagem.
export async function avisarComFila(env, telefone, dados, agora = Date.now()) {
  const aviso = { telefone, dados };
  try {
    if (!env.NOTIFY_TEMPLATE) {
      const { ultimoOi } = await avisos(env, "estado");
      if (ultimoOi && agora - ultimoOi > JANELA) {
        await avisos(env, "guardar", { aviso: { ...aviso, guardadoEm: agoraBR() } });
        await registrar(env, `resumo guardado (final ${final(telefone)}): passou de 24 h desde o último "oi" da advogada`,
          'Será entregue assim que ela mandar um "oi" para o robô.');
        return;
      }
    }
    await enviar(env, aviso);
    await registrar(env, `resumo enviado à advogada (final ${final(telefone)})`);
  } catch (erro) {
    console.error("Falha ao avisar a advogada:", erro);
    try {
      await avisos(env, "guardar", { aviso: { ...aviso, guardadoEm: agoraBR() } });
    } catch {}
    await registrar(env, `erro ao avisar a advogada (final ${final(telefone)}): resumo guardado para o próximo "oi"`, erro?.message ?? erro);
  }
}

// A Meta avisou que uma mensagem do robô não foi entregue.
export async function tratarFalha(env, { id, telefone, erro }) {
  const motivo = erro ? `${erro.code ?? ""} ${erro.title ?? erro.message ?? ""}`.trim() : "";
  const { aviso } = await avisos(env, "falhou", { id, guardadoEm: agoraBR() });
  if (aviso) {
    await registrar(env, `resumo não entregue à advogada (final ${final(aviso.telefone)}): guardado para o próximo "oi"`, motivo);
  } else {
    await registrar(env, `mensagem não entregue ao número final ${final(telefone)}`, motivo);
  }
}

// A advogada mandou mensagem para o robô: a janela abriu, entrega o que estiver guardado.
export async function entregarGuardados(env, agora = Date.now()) {
  const { guardados } = await avisos(env, "oi", { quando: agora });
  if (!guardados.length) {
    await registrar(env, '"oi" da advogada recebido: resumos liberados pelas próximas 24 h');
    return;
  }
  let entregues = 0;
  for (const aviso of guardados) {
    try {
      await enviar(env, aviso);
      entregues += 1;
    } catch (erro) {
      await avisos(env, "guardar", { aviso });
      await registrar(env, `erro ao entregar resumo guardado (final ${final(aviso.telefone)})`, erro?.message ?? erro);
    }
  }
  await registrar(env, `"oi" da advogada recebido: ${entregues} resumo(s) guardado(s) entregue(s)`);
}
