/**
 * O GATE DA CONTA SINTÉTICA — módulo PURO (sem prisma, sem I/O).
 *
 * Conta sintética é conta de AGREGAÇÃO: ela existe para somar as filhas, e lançar nela é lançar num
 * total. Até aqui isto era **aviso de tela** (`web: entries/lib/contaSintetica.js`) — o sistema
 * informava e o contador decidia.
 *
 * ⚠ A DECISÃO MUDOU, E O MOTIVO É EXTERNO: no leiaute da ECD (Manual do Leiaute 9, ADE Cofis
 * nº 01/2026) o registro **I250 (Partidas do Lançamento)** exige que o `IND_CTA` da conta em I050
 * seja **"A"** (analítica) — a REGRA_CONTA_ANALITICA, repetida em I155, I250, I310 e I355. Não há
 * exceção: descumprida, o PGE do Sped Contábil **gera erro** e a escrituração não sobe.
 *
 * Ou seja: permitir não era dar liberdade — era adiar a falha para a hora da entrega, longe do
 * lançamento que a causou. Por isso, e só por isso, aqui "travar" venceu "informar".
 *
 * ⚠ `analitica` É TRI-ESTADO E SÓ `false` RECUSA. Conta ainda não reimportada não tem
 * `codigoCompleto` e portanto não tem resposta: sai `analitica: null`, e recusar no desconhecido
 * travaria todo plano que ainda não passou pelo import. **Ausência nunca é resposta** — a
 * comparação é `=== false`, estrita, nunca `!analitica`.
 *
 * ⚠ A TRAVA RECUSA A ENTRADA, NUNCA A PERMANÊNCIA. Numa EDIÇÃO, o que se compara é o que o payload
 * ACRESCENTA em relação ao que o lançamento já tinha gravado. Sem isso, os 6 lançamentos que já
 * existem em conta de agregação ficariam presos: qualquer `UPDATE` que tocasse a linha errada seria
 * recusado — inclusive o `UPDATE` que existe para MOVÊ-LOS para a analítica certa. A trava não pode
 * impedir a correção que ela mesma pede.
 */

/** O código do erro — mesmo padrão nomeado de `MES_FECHADO` / `NO_ATIVIDADES`. */
export const ERRO_CONTA_SINTETICA = "CONTA_SINTETICA";

/** Só `false` afirma sintética. `null`/`undefined` = não se sabe, e não se afirma. */
export function ehContaSintetica(conta) {
  return conta?.analitica === false;
}

/**
 * O plano resolvido por código: `Map<codigo, conta>`.
 *
 * ⚠ EMPRESA VENCE GLOBAL, exatamente como o `GET /chart-of-accounts` já resolve (override
 * semantic). Uma segunda regra de desempate aqui faria a tela e a trava discordarem sobre qual
 * conta o contador está usando — e o `AccountingEntryLine.conta` é TEXTO, sem FK: quem decide qual
 * das duas é a conta do lançamento é essa resolução, não o banco.
 */
export function resolverPlanoPorCodigo(contas) {
  const porCodigo = new Map();
  for (const conta of contas || []) {
    const codigo = String(conta?.codigo ?? "").trim();
    if (!codigo) continue;
    const atual = porCodigo.get(codigo);
    const daEmpresa = Boolean(conta?.portalClientId);
    if (!atual || (daEmpresa && !atual.portalClientId)) porCodigo.set(codigo, conta);
  }
  return porCodigo;
}

/** Os códigos citados nas linhas, sem vazios e sem repetição, na ordem em que aparecem. */
export function codigosDasLinhas(lines) {
  const vistos = new Set();
  const codigos = [];
  for (const linha of Array.isArray(lines) ? lines : []) {
    const codigo = String(linha?.conta ?? "").trim();
    if (!codigo || vistos.has(codigo)) continue;
    vistos.add(codigo);
    codigos.push(codigo);
  }
  return codigos;
}

/**
 * As contas SINTÉTICAS citadas nas linhas — o que a recusa nomeia.
 * @param {Array<{conta?: string}>} lines
 * @param {Map<string, {codigo?: string, nome?: string, analitica?: boolean|null}>} plano
 * @returns {Array<{codigo: string, nome: string}>}
 */
export function sinteticasNasLinhas(lines, plano) {
  const achadas = [];
  for (const codigo of codigosDasLinhas(lines)) {
    const conta = plano?.get?.(codigo);
    if (ehContaSintetica(conta)) achadas.push({ codigo, nome: conta?.nome || "" });
  }
  return achadas;
}

/**
 * O que a EDIÇÃO ACRESCENTA: as sintéticas do payload que o lançamento ainda não tinha.
 *
 * ⚠ É esta função que mantém a correção possível. O lançamento 357 (RECEITAS, R$ 207.351,40) pode
 * ser reescrito para uma analítica — o payload novo não tem sintética nenhuma e passa; e enquanto o
 * destino não for decidido pelo contador, corrigir a data ou o histórico daquele lançamento também
 * passa, porque a sintética não é NOVA ali. O que não passa é acrescentar uma.
 *
 * @param {Array<{conta?: string}>} linesNovas — o payload
 * @param {Iterable<string>} codigosAtuais — os códigos já gravados no lançamento
 * @param {Map<string, object>} plano
 */
export function sinteticasIntroduzidas(linesNovas, codigosAtuais, plano) {
  const jaEstavam = new Set([...(codigosAtuais || [])].map((c) => String(c ?? "").trim()).filter(Boolean));
  return sinteticasNasLinhas(linesNovas, plano).filter((s) => !jaEstavam.has(s.codigo));
}

/**
 * As filhas DIRETAS de uma sintética, dentro do mesmo escopo — a saída que a recusa oferece.
 *
 * Filha = código completo mais longo que começa com o da mãe. **Direta** = não existe, entre as
 * duas, um código intermediário que também seja filho da mãe e mãe dela. A definição não depende de
 * largura de nível: o arquivo real do ERP não tem largura fixa, e supor uma produziria "filha" onde
 * há neta.
 *
 * ⚠ MESMO ESCOPO, sempre — global com global, empresa com a própria (é a regra de
 * `derivacaoAnalitica.js`, e cruzar escopos afirmaria parentesco entre planos diferentes).
 *
 * @param {{codigoCompleto?: string|null}} mae
 * @param {Array<{codigo?: string, nome?: string, codigoCompleto?: string|null, analitica?: boolean|null}>} contasDoEscopo
 */
export function filhasDiretas(mae, contasDoEscopo) {
  const raiz = String(mae?.codigoCompleto ?? "").trim();
  if (!raiz) return [];
  const descendentes = (contasDoEscopo || [])
    .map((c) => ({ ...c, codigoCompleto: String(c?.codigoCompleto ?? "").trim() }))
    .filter((c) => c.codigoCompleto.length > raiz.length && c.codigoCompleto.startsWith(raiz));
  const completos = descendentes.map((c) => c.codigoCompleto);
  return descendentes
    .filter((c) => !completos.some((outro) =>
      outro.length > raiz.length &&
      outro.length < c.codigoCompleto.length &&
      c.codigoCompleto.startsWith(outro)))
    .sort((a, b) => a.codigoCompleto.localeCompare(b.codigoCompleto));
}

/**
 * A frase da recusa. ⚠ Ela diz o MOTIVO **e a saída** — recusa muda é o defeito, não a recusa.
 * @param {Array<{codigo: string, nome: string}>} achadas
 */
export function mensagemRecusa(achadas) {
  const lista = (achadas || []).map((c) => `${c.codigo}${c.nome ? ` ${c.nome}` : ""}`).join(", ");
  const uma = (achadas || []).length === 1;
  return uma
    ? `${lista} é uma conta SINTÉTICA (de agregação): ela existe para somar as filhas e não recebe lançamento. `
      + "A ECD só aceita partida em conta analítica (registro I250 — IND_CTA \"A\"), e o arquivo seria recusado na entrega. "
      + "Escolha uma das contas analíticas abaixo dela."
    : `${lista} são contas SINTÉTICAS (de agregação): elas existem para somar as filhas e não recebem lançamento. `
      + "A ECD só aceita partida em conta analítica (registro I250 — IND_CTA \"A\"), e o arquivo seria recusado na entrega. "
      + "Escolha, para cada uma, uma das contas analíticas abaixo dela.";
}
