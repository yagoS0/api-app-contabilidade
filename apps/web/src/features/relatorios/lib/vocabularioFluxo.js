export function somarCompetencia(comp, delta) {
  const [ano, mes] = String(comp).split('-').map(Number);
  const n=ano*12+mes-1+delta;
  return `${Math.floor(n/12)}-${String((n%12+12)%12+1).padStart(2,'0')}`;
}
export const PROCEDENCIA = Object.freeze({
  FATO: "FATO",
  COMPROMISSO: "COMPROMISSO",
  PREVISAO: "PREVISAO",
  DESCONHECIDO: "DESCONHECIDO",
});
export const DIRECAO = Object.freeze({ ENTRADA: "ENTRADA", SAIDA: "SAIDA" });
export const FONTE = Object.freeze({
  GUIA: "GUIA",
  NOTA_EMITIDA: "NOTA_EMITIDA",
  SERIE_RECEITA: "SERIE_RECEITA",
  SERIE_DESPESA: "SERIE_DESPESA",
  IMPOSTO_PROJETADO: "IMPOSTO_PROJETADO",
  FOLHA: "FOLHA",
  /**
   * ⚠⚠ O QUE O PRÓPRIO CLIENTE ACRESCENTOU (29/08/2026) — a saída AVULSA, a que tem data.
   *
   * ⚠ O que ele diz se REPETIR vira `SERIE_DESPESA` com `base.origem: "DECLARADA"`, e é `origem` que
   * a distingue do que o sistema detectou. Duas fontes para a mesma série fariam a evidência da
   * recorrência (n, faixa, confronto) parar de aparecer.
   *
   * ⚠⚠ Ela cai no balde **`saida`** de `tabelaDoFluxo.js`, e há teste afirmando isso — fonte nova
   * caindo no balde certo por acidente é o que a lista fechada existe para impedir.
   */
  SAIDA_DO_CLIENTE: "SAIDA_DO_CLIENTE",
  /**
   * ⚠⚠ A DESPESA QUE O CONTADOR LANÇOU — espelho de `FONTE` no servidor (01/09/2026).
   *
   * Sem esta entrada e sem o rótulo, a linha chegaria na tela como **"Origem desconhecida"** — e é
   * a linha do trabalho principal da Conferência. Mudou lá, muda aqui.
   * ⚠ Ela é sempre `FATO`: o lançamento é `D despesa / C caixa`, ou seja a partida dobrada afirma
   * que o dinheiro saiu. E desde 01/09/2026 é a ÚNICA saída de despesa do fluxo — *"só entra no
   * fluxo aquilo que for lançado"*.
   */
  DESPESA_LANCADA: "DESPESA_LANCADA",
  /**
   * ⚠⚠ A RECEITA QUE O HISTÓRICO PROJETA (30/08/2026) — espelho de `FONTE` no servidor.
   *
   * ⚠ Sem esta entrada e sem o rótulo abaixo, a linha aparece como *"Origem desconhecida"* — sem
   * erro nenhum, e ninguém percebe. É a mesma armadilha que o vocabulário fechado de `PROCEDENCIA`
   * já registra: valor novo no servidor sem entrada aqui cai no fallback, calado.
   */
  RECEITA_PROJETADA: "RECEITA_PROJETADA",
});
