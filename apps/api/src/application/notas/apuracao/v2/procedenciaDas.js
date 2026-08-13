// O VOCABULÁRIO DE PROCEDÊNCIA DO DAS — uma fonte só, porque são três leitores e uma migration.
//
// ⚠ POR QUE ISTO EXISTE. `ApuracaoSnapshot.dasCalculadoLocal` era gravada por DOIS caminhos:
// `MotorApuracaoService.calcularApuracaoLocal` (o nosso cálculo) e
// `FechamentoService.calcularFechamento` (a SIMULAÇÃO OFICIAL da RFB, `indicadorTransmissao:false`).
// A coluna ora guardava um, ora o outro, e não havia nada na linha que os distinguisse — a tela
// acabou tendo de exibir "DAS gravado (procedência ambígua)" porque afirmar qualquer coisa seria
// escolher no escuro.
//
// Hoje cada número tem a sua coluna (`dasCalculadoLocal` · `dasSimuladoSerpro` ·
// `dasRetornadoSerpro`) e esta é a marca que diz de quem é o número da PRIMEIRA.
//
// ⚠ `AMBIGUO` NÃO É ESTADO DE ERRO E NÃO DEVE SUMIR. Ele é o que sobra dos snapshots gravados
// antes da separação cuja procedência não pôde ser PROVADA por outro campo da linha. Apagá-lo
// (ou tratá-lo como `MOTOR_LOCAL` "porque a coluna se chama local") é inventar procedência de
// dado fiscal — exatamente o defeito que esta separação veio consertar.

/** Valores de `ApuracaoSnapshot.dasCalculadoLocalProcedencia`. Nulo = a coluna do DAS é nula. */
export const PROCEDENCIA_DAS = Object.freeze({
  /** Provado: quem escreveu `dasCalculadoLocal` foi o nosso motor. */
  MOTOR_LOCAL: "MOTOR_LOCAL",
  /** Snapshot anterior à separação, sem prova de procedência na própria linha. */
  AMBIGUO: "AMBIGUO",
});

/**
 * O valor de `dasCalculadoLocal` pode ser chamado de "nosso"?
 *
 * ⚠ A ausência de marca (`null`) responde NÃO. Toda linha escrita depois da separação carrega
 * `MOTOR_LOCAL`; linha com valor e sem marca é linha velha, e velha é ambígua. Tratar o default
 * como "nosso" faria a ambiguidade desaparecer por omissão, que é como ela nasceu.
 */
export function ehCalculoNosso(procedencia) {
  return procedencia === PROCEDENCIA_DAS.MOTOR_LOCAL;
}
