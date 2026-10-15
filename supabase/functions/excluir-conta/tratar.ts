// Exclui a conta a pedido do titular (LGPD). Apagar o usuário do login apaga, em cascata,
// o perfil, os dados de estudo e as assinaturas. Só a própria pessoa, logada, pode pedir.
import { type Ambiente, CORS, resposta, servidor, usuarioDaRequisicao } from "../_comum/comum.ts";

export async function tratar(req: Request, amb: Ambiente): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta({ erro: "Método não aceito." }, 405);
  try {
    const usuario = await usuarioDaRequisicao(req, amb);
    if (!usuario) return resposta({ erro: "Entre na sua conta para continuar." }, 401);
    const pedido = await req.json().catch(() => ({}));
    if (pedido.confirmacao !== "EXCLUIR") return resposta({ erro: "Confirme a exclusão." }, 400);
    await servidor(amb).apagarUsuario(usuario.id);
    return resposta({ ok: true });
  } catch (e) {
    console.error(e);
    return resposta({ erro: "Não foi possível excluir a conta agora. Tente de novo em alguns minutos." }, 500);
  }
}
