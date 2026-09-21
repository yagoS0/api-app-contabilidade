import { expedienteDoEscritorio } from "../assistente/expediente.js";

const PREFIXO_MODALIDADE = "altan.comercial.modalidade.v1";
export function botoesModalidadeServico(atendimentoId, origem) {
  return [
    { valor: "AVULSO", titulo: origem === "ABERTURA" ? "Só abertura" : "Serviço avulso" },
    { valor: "RECORRENTE", titulo: origem === "ABERTURA" ? "Abertura + mensal" : "Contabilidade mensal" },
    { valor: "COMPARAR", titulo: "Comparar opções" },
  ].map(({ valor, titulo }) => ({ id: `${PREFIXO_MODALIDADE}.${atendimentoId}.${valor}`, titulo }));
}

export function modalidadeDoBotao(id) {
  const prefixo = `${PREFIXO_MODALIDADE}.`;
  if (typeof id !== "string" || !id.startsWith(prefixo)) return null;
  const partes = id.slice(prefixo.length).split(".");
  if (partes.length !== 2 || !/^[a-zA-Z0-9_-]{1,100}$/.test(partes[0]) || !["AVULSO", "RECORRENTE", "COMPARAR"].includes(partes[1])) return null;
  return { atendimentoId: partes[0], valor: partes[1] };
}

export function avisoAtendimentoComercial(agora = new Date()) {
  const expediente = expedienteDoEscritorio(agora);
  if (expediente.aberto) return "A equipe atende de segunda a sexta, das 9h às 17h, e responderá por aqui.";
  const retorno = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" })
    .format(new Date(expediente.proximaAbertura));
  return `Estamos fora do horário de atendimento. O próximo expediente começa em ${retorno}, às 9h, no horário de Brasília.`;
}
