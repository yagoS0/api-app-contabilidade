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

// ─────────────────────────────────────────────────────────────────────────────
// MODALIDADE DE PARCELAMENTO — o de-para, e ele é NÃO DESTRUTIVO
// ─────────────────────────────────────────────────────────────────────────────
//
// O banco guarda a modalidade CRUA do SERPRO em `Parcelamento.tipo` (`PARCSN`, `PERT_SN`,
// `RELP_SN`…) e ela chega à tela como `guide.parcelamentoTipo`. A tela mostrava esse valor cru.
//
// DECISÃO DO DONO: colapsar para **"PARC SN"** e **"PARC MEI"** — o tratamento contábil é idêntico
// dentro de cada família, e fragmentar a memória de contas em oito chaves só faria o contador
// preencher a mesma tríade oito vezes.
//
// ⚠ E A CONDIÇÃO É O CORAÇÃO DA REGRA: **o colapso acontece SÓ AQUI, no ponto de resolução.**
// A modalidade crua continua gravada (`Parcelamento.tipo`) e continua viajando até a tela — nenhum
// campo novo foi criado, nenhum dado foi reescrito. Três motivos, todos do dono:
//   1. o catálogo do SERPRO evolui (o projeto já trata código TJLP como dado versionado);
//   2. PERT e RELP têm reduções de multa/juros — não mudam as contas, mudam os valores, e um dia
//      vai se querer filtrar por elas;
//   3. auditoria: quando um lançamento for questionado, *"veio como RELP_SN"* precisa ser
//      recuperável. Por isso quem exibe o rótulo colapsado mostra o cru junto (ver `rotuloGuia.js`,
//      que o põe no `title` da linha).
//
// ⚠ AS MODALIDADES SÃO DUAS FAMÍLIAS, NÃO UMA. `TIPOS_PARCELAMENTO`
// (`apps/api/src/application/accounting/parcelamento/contracts.js`) tem DEZ valores: 4 do Simples
// Nacional + 4 do MEI (os 8 da documentação oficial), mais `INSS` e `OUTRO`.
//
// ⚠ `INSS` E `OUTRO` NUNCA COLAPSAM. INSS é parcelamento previdenciário, não do Simples: chamá-lo
// de "PARC SN" seria trocar um erro por outro — é literalmente o erro que `rotuloGuia` já existe
// para evitar (a parcela de INSS parcelado é gravada com o mesmo `tipo` do DAS do mês).
//
// ⚠ MODALIDADE QUE O DE-PARA NÃO CONHECE NÃO COLAPSA: aparece CRUA e levanta REVISÃO. Mesmo
// precedente de `classificarDocumentoArrecadado.js`, que diante de um código de receita
// desconhecido levanta alerta e **se recusa a classificar** em vez de deduzir do texto. Colapsar
// por palpite mandaria um parcelamento de natureza desconhecida para o padrão de contas do Simples,
// sem que ninguém visse.

/**
 * As duas famílias, e o rótulo de cada uma.
 *
 * Os nomes das modalidades vêm do catálogo (`TIPOS_PARCELAMENTO` no backend, espelhado no select do
 * wizard) — nenhum foi inventado aqui. Os rótulos "PARC SN"/"PARC MEI" são decisão do dono.
 *
 * A lista é FECHADA de propósito (nada de prefixo `^PARCSN`): é ela que separa "modalidade
 * conhecida" de "modalidade nova", e um prefixo faria `PARCSN_QUALQUER_COISA` entrar em silêncio.
 */
export const FAMILIAS_PARCELAMENTO = Object.freeze({
  SIMPLES_NACIONAL: Object.freeze({
    rotulo: "PARC SN",
    modalidades: Object.freeze(["PARCSN", "PARCSN_ESPECIAL", "PERT_SN", "RELP_SN"]),
  }),
  MEI: Object.freeze({
    rotulo: "PARC MEI",
    modalidades: Object.freeze(["PARCMEI", "PARCMEI_ESPECIAL", "PERT_MEI", "RELP_MEI"]),
  }),
});

/** Conhecidas e SEM família — não colapsam, e isso é o desenho, não uma lacuna. */
export const MODALIDADES_SEM_FAMILIA = Object.freeze(["INSS", "OUTRO"]);

/** Quando nem modalidade existe (parcelamento do caminho V1, que não grava `tipo`). */
const ROTULO_SEM_MODALIDADE = "Parcelamento";

const FAMILIA_DA_MODALIDADE = new Map(
  Object.entries(FAMILIAS_PARCELAMENTO).flatMap(([familia, { modalidades }]) =>
    modalidades.map((m) => [m, familia])),
);

/**
 * O de-para. **Única** resolução de modalidade de parcelamento da interface.
 *
 * @param   {string|null} tipoCru  o valor de `Parcelamento.tipo` / `guide.parcelamentoTipo`
 * @returns {{cru: string, rotulo: string, familia: string|null, colapsada: boolean,
 *            conhecida: boolean, revisao: boolean, motivo: string|null}}
 *
 * `cru` volta SEMPRE — é o que torna o de-para não destrutivo: quem colapsa continua com o valor
 * do SERPRO na mão para exibir, auditar ou filtrar.
 */
export function resolverModalidadeParcelamento(tipoCru) {
  const cru = String(tipoCru || "").trim().toUpperCase();

  // Ausência de modalidade NÃO é modalidade desconhecida, e não levanta revisão. O parcelamento
  // criado pelo caminho V1 não grava `tipo`: pedir revisão dele acenderia um alerta permanente em
  // dado legado — e alerta que acende sempre é alerta que ninguém lê. Mantém o "Parcelamento"
  // genérico que a tela já usava.
  if (!cru) {
    return { cru: "", rotulo: ROTULO_SEM_MODALIDADE, familia: null, colapsada: false, conhecida: false, revisao: false, motivo: "modalidade_ausente" };
  }

  const familia = FAMILIA_DA_MODALIDADE.get(cru) || null;
  if (familia) {
    return { cru, rotulo: FAMILIAS_PARCELAMENTO[familia].rotulo, familia, colapsada: true, conhecida: true, revisao: false, motivo: null };
  }

  // INSS/OUTRO: conhecidas, sem família, exibidas como estão. Não passam por `humanizar` — "INSS"
  // é como o contador as chama, e reescrevê-las aqui seria inventar vocabulário fiscal.
  if (MODALIDADES_SEM_FAMILIA.includes(cru)) {
    return { cru, rotulo: cru, familia: null, colapsada: false, conhecida: true, revisao: false, motivo: null };
  }

  // Modalidade nova: crua na tela + sinal de revisão. Nunca colapso automático.
  return { cru, rotulo: cru, familia: null, colapsada: false, conhecida: false, revisao: true, motivo: "modalidade_desconhecida" };
}

/** O texto do sinal de revisão — um só, para tela e tooltip não divergirem. */
export const AVISO_MODALIDADE_EM_REVISAO =
  "⚠ Modalidade de parcelamento não reconhecida — confira a natureza do acordo antes de usar o padrão de contas.";
