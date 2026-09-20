import { expedienteDoEscritorio } from "../assistente/expediente.js";

export function avisoAtendimentoComercial(agora = new Date()) {
  const expediente = expedienteDoEscritorio(agora);
  if (expediente.aberto) return "A equipe atende de segunda a sexta, das 9h às 17h, e responderá por aqui.";
  const retorno = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" })
    .format(new Date(expediente.proximaAbertura));
  return `Estamos fora do horário de atendimento. O próximo expediente começa em ${retorno}, às 9h, no horário de Brasília.`;
}
