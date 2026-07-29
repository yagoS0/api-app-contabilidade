// Vocabulário da interface — um só lugar traduzindo o que o banco guarda para o que o contador lê.
//
// POR QUE EXISTE
// A mesma empresa aparecia como "Presumido" no card do dashboard e "LUCRO_PRESUMIDO" na tabela de
// Consultas, porque cada tela traduzia (ou não) por conta própria. Nome de enum com underline é a
// forma como o BANCO guarda o dado — não é palavra que alguém use.
//
// REGRA: nenhum valor cru de enum, nenhuma sigla sem tradução, chega à tela. Se um estado novo
// aparecer aqui sem rótulo, o fallback devolve algo legível em vez de vazar o enum.

const REGIMES = {
  SIMPLES: "Simples",
  SIMPLES_NACIONAL: "Simples",
  LUCRO_PRESUMIDO: "Presumido",
  LUCRO_REAL: "Lucro Real",
  MEI: "MEI",
};

// Estados do ApuracaoSnapshot. Os nomes técnicos (`calculada`, `bloqueada_pendencias`) descrevem
// o REGISTRO; o contador quer saber em que ponto do trabalho aquilo está.
const ESTADOS_APURACAO = {
  pendente: "Não iniciada",
  aberta: "Não iniciada",
  configurando: "Em preenchimento",
  calculada: "Calculada — falta transmitir",
  fechada: "Fechada — falta transmitir",
  transmitida: "Transmitida",
  confirmada: "Transmitida",
  bloqueada_pendencias: "Travada por pendência",
  erro_calculo: "Erro no cálculo",
  erro_transmissao: "Erro na transmissão",
  erro: "Erro",
};

// Último recurso: transforma "bloqueada_pendencias" em "Bloqueada pendencias" em vez de deixar o
// enum cru na tela. Serve para estados novos que ainda não ganharam rótulo aqui.
function humanizar(valor) {
  const t = String(valor || "").trim();
  if (!t) return "";
  const limpo = t.replace(/_/g, " ").toLowerCase();
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

export function rotuloRegime(valor) {
  const k = String(valor || "").trim().toUpperCase();
  if (!k) return "";
  return REGIMES[k] || humanizar(k);
}

export function rotuloEstadoApuracao(valor) {
  const k = String(valor || "").trim().toLowerCase();
  if (!k) return ESTADOS_APURACAO.pendente;
  return ESTADOS_APURACAO[k] || humanizar(k);
}

// Sigla que só faz sentido para quem já conhece. Onde couber, usar o nome por extenso; onde o
// espaço for curto, usar a sigla COM este texto como title.
export const RBT12_NOME = "Receita bruta dos últimos 12 meses";
