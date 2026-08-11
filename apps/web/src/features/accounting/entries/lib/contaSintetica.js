/**
 * CONTA SINTÉTICA NA TELA DE LANÇAMENTO — sai da SUGESTÃO, continua DIGITÁVEL.
 *
 * Conta sintética é conta de agregação: ela existe para somar as filhas, e lançar nela é lançar num
 * total. O erro só aparecia na exportação para o ERP, longe do lançamento que o causou.
 *
 * ⚠ ISTO NÃO TRAVA NADA, e a diferença é o ponto. O arquivo importado pode estar errado, e o
 * contador sabe quando a exceção é legítima — medido na base real: 4 contas de agregação JÁ têm
 * lançamento (6 no total), inclusive uma receita de R$ 207 mil na conta de 1º nível. Recusar essas
 * linhas transformaria uma informação em obstrução. O sistema informa; ele decide.
 *
 * O que muda é só a SUGESTÃO: a conta sintética deixa de ser oferecida (oferecer é o sistema
 * dizendo "use esta"), e quem digitar o código dela mesmo assim vê a tela dizer o que ela é.
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
 * A frase da tela. `null` quando não há nada a dizer — aviso permanente treina o olho a ignorá-lo.
 *
 * ⚠ Ela NOMEIA a conta e diz que o lançamento segue. Um aviso que só diz "atenção" ao lado de um
 * campo habilitado deixa o contador sem saber se clicou e não funcionou.
 */
export function avisoContaSintetica(lines, contas) {
  const achadas = sinteticasNasLinhas(lines, contas);
  if (achadas.length === 0) return null;
  const nomes = achadas.map((c) => `${c.codigo}${c.nome ? ` ${c.nome}` : ""}`).join(", ");
  return achadas.length === 1
    ? `${nomes} — esta conta é sintética (de agregação). O lançamento não está bloqueado.`
    : `${nomes} — estas contas são sintéticas (de agregação). O lançamento não está bloqueado.`;
}
