export const taskTitles = { notas: "Download de notas", sitfis: "Download de situações fiscais", "captura-notas": "Consulta de notas",
  "import-nfe": "Importação de NF-e", "import-nfse": "Importação de NFS-e", "envio-guias": "Envio de guias", apuracao: "Transmissão de apuração",
  "consulta-inss": "Consulta de INSS", "consulta-das": "Consulta de DAS", "consulta-lp": "Consulta de DARF",
  "consulta-parcelas": "Consulta de parcelas", "consulta-pagamentos": "Consulta de pagamentos", "consulta-sitfis": "Situação fiscal" };
export function taskPath(task) {
  if (task.tipo?.startsWith("apuracao") || task.tipo === "relatorio-faturamento") return "cadastro-fiscal";
  if (task.tipo === "consulta-extrato") return "circular";
  if (["import-ofx", "import-excel"].includes(task.tipo)) return "lancamentos";
  if (task.tipo === "sitfis" || task.tipo === "consulta-sitfis") return "sitfis";
  if (task.tipo === "apuracao") return "apuracao";
  if (task.tipo === "envio-guias" || ["consulta-inss", "consulta-das", "consulta-lp", "consulta-parcelas", "consulta-pagamentos", "recalculo-guia"].includes(task.tipo)) return "guides";
  return "notas-fiscais";
}
export const taskStatuses = { running: "Em execução", processando: "Em execução", done: "Concluída", concluido: "Concluída",
  partial: "Concluída com pendências", pending: "Aguardando confirmação", error: "Precisa de atenção", erro: "Precisa de atenção",
  interrupted: "Interrompida", expirado: "Arquivo expirado" };
export const taskRunning = t => !t.status || ["running", "processando"].includes(t.status);
