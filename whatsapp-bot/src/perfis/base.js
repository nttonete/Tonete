// Monta um perfil de cliente: tudo que muda de um cliente para outro (instruções
// da IA, campos da triagem, textos fixos, cartão de contato). O resto do robô
// é igual para todos e lê o perfil escolhido em PERFIL (wrangler.toml).

const NAO_INFORMADO = "não informado";

export const MOTIVOS = ["triagem_completa", "pediu_atendimento_humano", "urgente", "fora_do_escopo"];

// config:
//   id                 nome do perfil (o mesmo valor de PERFIL)
//   systemPrompt       instruções da IA (texto fixo, para aproveitar o cache)
//   ferramenta         { nome, descricao } da ferramenta que passa o caso adiante
//   campos             [{ chave, rotulo, descricao }] específicos da área; nome,
//                      cidade, resumo, prioridade e motivo entram sempre
//   tituloAviso        assunto do aviso, ex.: "golpe do Pix"
//   cartao             { nome, primeiroNome, sobrenome, empresa } do cartão de contato
//   mensagens          { final, erro, jaEncaminhado, contato(numeroFormatado) }
export function criarPerfil(config) {
  for (const chave of ["id", "systemPrompt", "ferramenta", "campos", "tituloAviso", "cartao", "mensagens"]) {
    if (!config[chave]) throw new Error(`perfil ${config.id ?? "?"}: falta "${chave}"`);
  }
  const campos = [
    { chave: "nome", rotulo: "Nome", descricao: "Nome informado, ou \"não informado\"." },
    { chave: "cidade", rotulo: "Cidade", descricao: "Cidade/UF, ou \"não informado\"." },
    ...config.campos,
    { chave: "resumo", rotulo: "Resumo", descricao: config.descricaoResumo ?? "Resumo do caso em até 4 frases, para o responsável." },
  ];

  const propriedades = Object.fromEntries(campos.map((c) => [c.chave, { type: "string", description: c.descricao }]));
  propriedades.prioridade = { type: "string", enum: ["alta", "normal", "baixa"] };
  propriedades.motivo = { type: "string", enum: MOTIVOS };

  return {
    id: config.id,
    systemPrompt: config.systemPrompt,
    tituloAviso: config.tituloAviso,
    cartao: config.cartao,
    mensagens: config.mensagens,
    // Campos mostrados no aviso, sem nome e cidade (que vão no cabeçalho).
    camposAviso: campos.filter((c) => c.chave !== "nome" && c.chave !== "cidade"),
    ferramenta: {
      name: config.ferramenta.nome,
      description: config.ferramenta.descricao,
      strict: true,
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: propriedades,
        required: Object.keys(propriedades),
      },
    },
    // Aviso enviado quando a IA não consegue responder.
    avisoDeFalha(nome) {
      return {
        ...Object.fromEntries(campos.map((c) => [c.chave, NAO_INFORMADO])),
        nome: nome || NAO_INFORMADO,
        resumo: "O robô não conseguiu responder este contato. Veja a conversa no WhatsApp.",
        prioridade: "normal",
        motivo: "falha_do_robo",
      };
    },
  };
}

// (31) 99693-6688 para números do Brasil; os demais ficam como +DDI...
export function numeroFormatado(numero) {
  const d = String(numero).replace(/\D/g, "").replace(/^55/, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `+${numero}`;
}
