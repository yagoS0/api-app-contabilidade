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

// Símbolos da situação fiscal (SITFIS). Decisão do dono: no card vale o símbolo sozinho, aceitando
// que se aprende o que ele significa.
//
// Para que esse aprendizado aconteça SEM legenda separada, o mesmo símbolo aparece colado à
// palavra nos lugares onde há espaço — o filtro "Situação fiscal" do dashboard. É lá que a
// associação se forma; no card ele já é lido de relance.
export const SITUACAO_FISCAL_SIMBOLO = {
  COM_PENDENCIA: "⚠",
  EM_PARCELAMENTO: "⏸",
  REGULAR: "✓",
  PROCESSANDO: "⧗",
  // ⚠ `NAO_CONSULTADA` NÃO é valor do SITFIS: é o `null` do banco, ou seja, ninguém consultou.
  // Ele existe aqui para ter símbolo e palavra próprios — a regra que não se quebra é que ausência
  // de consulta jamais pode ser lida como "sem pendência". Afirmar algo sobre o fisco sem ter
  // olhado é o erro caro; um círculo vazio dizendo "não consultada" é o barato.
  NAO_CONSULTADA: "○",
};

export const SITUACAO_FISCAL_TEXTO = {
  COM_PENDENCIA: "Com pendência",
  EM_PARCELAMENTO: "Em parcelamento",
  REGULAR: "Sem pendência",
  PROCESSANDO: "Consultando",
  NAO_CONSULTADA: "Fiscal não consultada",
};

/** Cor de cada situação. Só a pendência é forte — as demais informam, não pedem ação. */
export const SITUACAO_FISCAL_COR = {
  COM_PENDENCIA: "var(--state-danger)",
  EM_PARCELAMENTO: "var(--state-neutral)",
  REGULAR: "var(--state-ok)",
  PROCESSANDO: "var(--state-neutral)",
  NAO_CONSULTADA: "var(--text-faint)",
};

/** `null`/desconhecido do backend → a chave explícita de "ninguém consultou". */
export function chaveSituacaoFiscal(valor) {
  const k = String(valor || "").toUpperCase();
  return SITUACAO_FISCAL_TEXTO[k] ? k : "NAO_CONSULTADA";
}

// "⚠ Com pendência" — símbolo e palavra juntos, para os lugares com espaço.
export function situacaoFiscalComSimbolo(chave) {
  const sim = SITUACAO_FISCAL_SIMBOLO[chave];
  const txt = SITUACAO_FISCAL_TEXTO[chave];
  if (!sim || !txt) return txt || "";
  return `${sim} ${txt}`;
}
