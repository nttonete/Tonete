// Perfil de demonstração, para mostrar o robô a escritórios interessados.
// O escritório é fictício: troque os dados ao usar com um cliente de verdade.
import { perfilAdvocacia } from "./modelos/advocacia.js";

export default perfilAdvocacia({
  id: "demo-trabalhista",
  escritorio: "Escritório Demonstração",
  registro: "OAB/UF 000.000",
  profissional: { nome: "Ana Exemplo", titulo: "advogada" },
  tema: "direitos trabalhistas",
  publico:
    "Em geral, alguém que foi demitido, trabalha sem carteira assinada, não recebeu verbas da rescisão ou sofre assédio no trabalho. A pessoa costuma estar preocupada com dinheiro e com medo de se expor.",
  perguntas: [
    "O que aconteceu, em poucas palavras (demissão, falta de registro, horas extras, assédio, acidente...).",
    "Se ainda trabalha na empresa ou quando saiu (data aproximada).",
    "Quanto tempo trabalhou lá e qual era a função.",
    "Se tinha carteira assinada.",
    "Se recebeu as verbas da rescisão e as guias do FGTS e do seguro-desemprego.",
    "Se tem documentos ou provas: holerites, mensagens, testemunhas.",
  ],
  orientacoes: [
    "Guardar holerites, contrato, mensagens e o termo de rescisão.",
    "Anotar nomes de colegas que presenciaram os fatos.",
    "Consultar o extrato do FGTS no aplicativo oficial da Caixa.",
  ],
  essenciais: "o que aconteceu, se ainda trabalha na empresa ou quando saiu, e se tinha carteira assinada",
  prioridade: {
    alta: "se a pessoa saiu da empresa há mais de um ano e meio (o prazo para reclamar pode estar perto do fim)",
    baixa: "se não for questão trabalhista",
  },
  campos: [
    { chave: "assunto", rotulo: "Assunto", descricao: "O problema em poucas palavras." },
    { chave: "situacao", rotulo: "Situação", descricao: "Se ainda trabalha na empresa ou quando saiu." },
    { chave: "tempo_funcao", rotulo: "Tempo e função", descricao: "Tempo de empresa e função, ou \"não informado\"." },
    { chave: "carteira", rotulo: "Carteira assinada", descricao: "\"sim\", \"não\" ou \"não informado\"." },
    { chave: "rescisao", rotulo: "Rescisão", descricao: "Se recebeu verbas e guias, ou \"não informado\"." },
    { chave: "provas", rotulo: "Provas", descricao: "Documentos e testemunhas que tem, ou \"não informado\"." },
  ],
});
