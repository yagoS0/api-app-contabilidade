/**
 * CONTA SINTÉTICA NA TELA DE LANÇAMENTO — sai da SUGESTÃO **e agora é RECUSADA**.
 *
 * Conta sintética é conta de agregação: ela existe para somar as filhas, e lançar nela é lançar num
 * total.
 *
 * ⚠ ISTO JÁ FOI "AVISO QUE NÃO TRAVA NADA", E A DECISÃO MUDOU — o motivo é externo, não de gosto.
 * No leiaute da ECD (Manual do Leiaute 9, ADE Cofis nº 01/2026) o registro **I250 (Partidas do
 * Lançamento)** exige `IND_CTA = "A"` na conta do I050 — a REGRA_CONTA_ANALITICA, repetida em I155,
 * I250, I310 e I355. Descumprida, o PGE do Sped Contábil **gera erro** e a escrituração não sobe.
 * Permitir não era dar liberdade: era adiar a falha para a hora da entrega, longe do lançamento que
 * a causou.
 *
 * ⚠ QUEM RECUSA DE VERDADE É O SERVIDOR (`api: application/accounting/lib/gateContaSintetica.js` +
 * `POST`/`PUT /entries`). Tela não é guarda — o que mora aqui é a antecipação, para o contador não
 * descobrir a recusa depois de clicar.
 *
 * ⚠ A TRAVA RECUSA A ENTRADA, NUNCA A PERMANÊNCIA — mesma regra dos dois lados. Na EDIÇÃO só
 * bloqueia a sintética que o payload ACRESCENTA: os 6 lançamentos que já existem em conta de
 * agregação (inclusive uma receita de R$ 207 mil na conta de 1º nível) continuam editáveis, senão o
 * contador ficaria preso justamente no caminho que existe para movê-los à analítica certa — e para
 * QUAL analítica cada um vai é decisão dele, não do sistema.
 *
 * ⚠ `analitica` É TRI-ESTADO, e `null` NÃO é sintética. Conta que ainda não foi reimportada não
 * tem `codigoCompleto` e portanto não tem resposta; tratá-la como sintética esvaziaria o dropdown
 * de todo plano ainda não reimportado. **Ausência nunca é resposta** — por isso a comparação é
 * `=== false`, estrita, nunca `!analitica`.
 */

/** Só `false` afirma sintética. `null`/`undefined` = não se sabe, e não se afirma. */
export function ehSintetica(conta) {
  return conta?.analitica === false;
}

/** A lista que o dropdown OFERECE: tudo menos as sintéticas. */
export function contasSugeriveis(contas) {
  return (Array.isArray(contas) ? contas : []).filter((c) => !ehSintetica(c));
}

/**
 * As contas SINTÉTICAS efetivamente digitadas nas linhas — é o que a tela nomeia.
 * @param {Array<{conta?: string}>} lines
 * @param {Array<{codigo?: string, nome?: string, analitica?: boolean|null}>} contas
 */
export function sinteticasNasLinhas(lines, contas) {
  if (!contas?.length) return [];
  const porCodigo = new Map(contas.map((c) => [String(c.codigo), c]));
  const vistas = new Set();
  const achadas = [];
  for (const linha of Array.isArray(lines) ? lines : []) {
    const codigo = String(linha?.conta || "").trim();
    if (!codigo || vistas.has(codigo)) continue;
    vistas.add(codigo);
    const conta = porCodigo.get(codigo);
    if (ehSintetica(conta)) achadas.push({ codigo, nome: conta.nome || "" });
  }
  return achadas;
}

/**
 * O que ESTA edição ACRESCENTA — as sintéticas que o lançamento ainda não tinha.
 *
 * ⚠ É a MESMA regra do servidor (`sinteticasIntroduzidas`), e é ela que mantém a correção possível.
 * Num lançamento novo `codigosAtuais` é vazio e toda sintética conta como acrescentada.
 *
 * @param {Array<{conta?: string}>} lines
 * @param {Array<object>} contas — o plano
 * @param {Iterable<string>} codigosAtuais — códigos já gravados no lançamento sendo editado
 */
export function sinteticasIntroduzidas(lines, contas, codigosAtuais) {
  const jaEstavam = new Set(
    [...(codigosAtuais || [])].map((c) => String(c ?? "").trim()).filter(Boolean),
  );
  return sinteticasNasLinhas(lines, contas).filter((s) => !jaEstavam.has(s.codigo));
}

/** "357 RECEITAS, 456 DESPESAS GERAIS" — o jeito de nomear conta em toda mensagem daqui. */
function nomear(achadas) {
  return achadas.map((c) => `${c.codigo}${c.nome ? ` ${c.nome}` : ""}`).join(", ");
}

/**
 * O MOTIVO DO BLOQUEIO, para o gate do Salvar. `null` quando não há nada a impedir.
 *
 * ⚠ Ele diz o motivo **e a saída** — recusa muda é o defeito, não a recusa.
 */
export function motivoContaSintetica(lines, contas, codigosAtuais) {
  const achadas = sinteticasIntroduzidas(lines, contas, codigosAtuais);
  if (achadas.length === 0) return null;
  return achadas.length === 1
    ? `${nomear(achadas)} é conta sintética (de agregação) e não recebe lançamento — escolha uma analítica abaixo dela.`
    : `${nomear(achadas)} são contas sintéticas (de agregação) e não recebem lançamento — escolha, para cada uma, uma analítica abaixo dela.`;
}

/**
 * A frase da tela. `null` quando não há nada a dizer — aviso permanente treina o olho a ignorá-lo.
 *
 * ⚠ Ela NOMEIA a conta e diz o que vai acontecer. Duas situações, dois textos: a sintética que ESTA
 * edição acrescenta **bloqueia** (e o Salvar está desabilitado com este mesmo motivo); a que já
 * estava gravada no lançamento **não bloqueia**, e a frase precisa dizer isso — senão o contador vê
 * um aviso de recusa ao lado de um Salvar habilitado e não sabe em qual dos dois acreditar.
 */
export function avisoContaSintetica(lines, contas, codigosAtuais) {
  const todas = sinteticasNasLinhas(lines, contas);
  if (todas.length === 0) return null;
  const bloqueio = motivoContaSintetica(lines, contas, codigosAtuais);
  if (bloqueio) return bloqueio;
  // Sobra o caso da sintética PREEXISTENTE: o lançamento já está assim, e corrigi-lo é decisão do
  // contador (para qual analítica ele vai, o sistema não escolhe).
  return todas.length === 1
    ? `${nomear(todas)} é conta sintética (de agregação): este lançamento já existe assim e continua editável, mas a ECD só aceita partida em conta analítica — mova-o para uma analítica abaixo dela.`
    : `${nomear(todas)} são contas sintéticas (de agregação): este lançamento já existe assim e continua editável, mas a ECD só aceita partida em conta analítica — mova-o para analíticas abaixo delas.`;
}
