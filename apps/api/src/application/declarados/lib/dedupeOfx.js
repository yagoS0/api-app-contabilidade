// A IDENTIDADE DE UMA TRANSAÇÃO DE EXTRATO — o que impede importar a mesma duas vezes.
//
// > Pergunta do dono (24/08/2026): *"temos alguma proteção caso o cliente queira importar vários,
// > sendo mesmo?"*
//
// **Não tínhamos.** Medido no import do escritório: não há hash de arquivo, `fitId` **não existe**
// em `AccountingEntry`, e o lote é `OFX-${Date.now()}` — duas subidas do mesmo arquivo produzem
// dois lotes distintos e dois conjuntos completos de lançamentos. (Ainda não mordeu porque ninguém
// usou: produção tem **0** lançamentos de origem OFX.)
//
// ## ⚠⚠ O CASO NORMAL É A SOBREPOSIÇÃO, NÃO O ARQUIVO REPETIDO
//
// O cliente baixa 01–31/jan, depois baixa 15/jan–15/fev. **Isso é o comportamento esperado de quem
// usa internet banking**, não engano. Logo a proteção não pode ser "recusar arquivo repetido": ela
// tem de deduplicar **transação a transação**.
//
// ## As duas chaves
//
// 1. **`FITID`** — o identificador que o próprio banco dá à transação. É a chave canônica.
// 2. **`IMPRESSAO`** — quando o banco não manda `FITID` (acontece). Conta + dia + valor + sinal +
//    memo.
//
// ⚠⚠ **DUAS TARIFAS IGUAIS NO MESMO DIA SÃO LEGÍTIMAS.** Uma impressão digital que ignorasse isso
// descartaria uma transação REAL, em silêncio — dinheiro sumindo da conferência. Por isso a chave
// carrega um **ordinal posicional dentro do arquivo**, e o resto é resolvido pelo `@@unique` do
// banco:
//
//   | base tem | arquivo tem | ordinais | resultado |
//   |---|---|---|---|
//   | 1 | 2 | #1, #2 | #1 colide, #2 entra ⇒ importa **1** ✓ |
//   | 2 | 2 | #1, #2 | os dois colidem ⇒ importa **0** ✓ |
//   | 0 | 2 | #1, #2 | nenhum colide ⇒ importa **2** ✓ |
//
// ⚠ O ordinal é **posicional no arquivo**, NUNCA deslocado pelo que já existe. Deslocá-lo faria a
// primeira linha do arquivo nunca colidir com a que já está lá, e toda reimportação duplicaria.
//
// ⚠ ESTE MÓDULO É PURO: sem prisma, sem relógio, sem I/O.

/** De onde saiu a identidade. ⚠ Vocabulário FECHADO — vai para a tela dizer o que foi conferido. */
export const CHAVE = Object.freeze({
  FITID: "FITID",
  IMPRESSAO: "IMPRESSAO",
});

/**
 * ⚠⚠ ESTA NORMALIZAÇÃO É CONGELADA. NÃO A "MELHORE".
 *
 * Ela é a única coisa que separa "esta transação já entrou" de "esta é nova". Mudá-la — para tirar
 * acento, para remover número de documento, para qualquer coisa — reescreve a identidade de **todas
 * as transações já importadas**, e o próximo extrato do cliente reimporta o histórico inteiro em
 * duplicidade. Sem erro, sem aviso.
 *
 * ⚠ Por isso ela NÃO é `normalizeMatchText` (a do import de Excel), embora seja parecida: aquela é
 * chave de MATCHING — "isto se parece com aquilo?" — e vai ficar mais esperta na Fase B2, tirando
 * datas e números de documento. Chave de dedupe e chave de matching respondem perguntas diferentes
 * e têm ciclos de vida opostos: uma tem de evoluir, a outra tem de nunca mudar.
 *
 * Faz o mínimo de propósito: quanto menos ela faz, menos motivo alguém terá para mexer nela.
 */
function normalizarParaDedupe(texto) {
  return String(texto ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * ⚠ A conta bancária faz parte da identidade.
 *
 * Sem ela, duas contas da MESMA empresa com o mesmo valor no mesmo dia são indistinguíveis — a
 * segunda importação seria descartada como duplicata de uma transação de outra conta.
 *
 * ⚠ `null` quando o arquivo não traz `ACCTID`. Aí o dedupe fica mais FROUXO (por empresa, sem
 * separar contas) e a tela precisa dizer isso — não se finge que a conta é conhecida.
 */
const rotuloDaConta = (conta) => String(conta?.acctId || "").trim() || "SEM-CONTA";

/** `2026-07-15T00:00:00.000Z` → `"2026-07-15"`. ⚠ UTC, o mesmo critério de `utils/dataCivil.js`. */
const diaDe = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "");

/**
 * A identidade de UMA transação, sem o ordinal.
 *
 * ⚠ O valor entra com DUAS casas fixas: `1500` e `1500.00` são a mesma transação, e sem o
 * `toFixed(2)` a segunda importação do mesmo arquivo geraria chave diferente conforme o parse.
 */
function baseDaChave(t, conta) {
  const c = rotuloDaConta(conta);
  const fitId = String(t?.fitId ?? "").trim();
  if (fitId) return { base: `OFX:${c}:${fitId}`, chave: CHAVE.FITID };

  const partes = [
    c,
    diaDe(t?.data),
    Number(t?.valor || 0).toFixed(2),
    String(t?.sinal || ""),
    normalizarParaDedupe(t?.historico),
  ];
  return { base: `OFXFP:${partes.join(":")}`, chave: CHAVE.IMPRESSAO };
}

/**
 * As identidades de um extrato inteiro, na ordem do arquivo.
 *
 * @param {Array<object>} transacoes o `transacoes` de `lerOfx`
 * @param {{acctId?: string}|null} conta o `conta` de `lerOfx`
 * @returns {Array<{transacao: object, hashDedupe: string, chave: string, ordinal: number}>}
 */
export function identidadesDoExtrato(transacoes, conta) {
  const vistos = new Map();
  return (transacoes || []).map((t) => {
    const { base, chave } = baseDaChave(t, conta);
    const ordinal = (vistos.get(base) || 0) + 1;
    vistos.set(base, ordinal);
    // ⚠ O `#n` é SEMPRE escrito, inclusive no primeiro. Omiti-lo no primeiro criaria duas grafias
    // para a mesma coisa, e a segunda importação teria de saber qual delas usar.
    return { transacao: t, hashDedupe: `${base}#${ordinal}`, chave, ordinal };
  });
}

/**
 * ⚠ O que o extrato tem de estranho — para o relatório dizer, nunca para bloquear.
 *
 * Nenhum destes impede a importação: são avisos sobre a QUALIDADE da identidade, e escondê-los faria
 * um dedupe frouxo parecer um dedupe firme.
 */
export const ANOMALIA = Object.freeze({
  SEM_CONTA_BANCARIA: "sem_conta_bancaria",
  SEM_FITID: "sem_fitid",
  FITID_REPETIDO: "fitid_repetido",
});

export const FRASE_DA_ANOMALIA = Object.freeze({
  [ANOMALIA.SEM_CONTA_BANCARIA]:
    "O arquivo não diz de que conta bancária é o extrato. A conferência de repetidos passa a valer para a empresa inteira, sem separar contas.",
  [ANOMALIA.SEM_FITID]:
    "Estas transações não trazem o identificador do banco. A conferência de repetidos usa data, valor e descrição — e duas iguais no mesmo dia continuam entrando as duas.",
  [ANOMALIA.FITID_REPETIDO]:
    "O banco repetiu o mesmo identificador em mais de uma transação deste arquivo. Elas foram tratadas como transações distintas.",
});

/** Avalia a qualidade da identidade deste extrato. ⚠ Não decide nada — só relata. */
export function anomaliasDoExtrato(identidades, conta) {
  const avisos = [];
  const add = (codigo, n) => avisos.push({ codigo, frase: FRASE_DA_ANOMALIA[codigo], n });

  if (!String(conta?.acctId || "").trim()) add(ANOMALIA.SEM_CONTA_BANCARIA, (identidades || []).length);

  const semFitId = (identidades || []).filter((i) => i.chave === CHAVE.IMPRESSAO).length;
  if (semFitId) add(ANOMALIA.SEM_FITID, semFitId);

  const repetidos = (identidades || []).filter((i) => i.chave === CHAVE.FITID && i.ordinal > 1).length;
  if (repetidos) add(ANOMALIA.FITID_REPETIDO, repetidos);

  return avisos;
}
