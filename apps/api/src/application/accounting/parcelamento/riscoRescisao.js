// RISCO DE RESCISÃO DO PARCELAMENTO — a conta que decide se o contador precisa agir hoje.
//
// Rescindido, o saldo remanescente vai para a Dívida Ativa da União e as reduções de multa
// obtidas na adesão são restabelecidas. É o pior desfecho possível de um parcelamento, e ele
// chega por acúmulo silencioso: ninguém decide rescindir, a rescisão simplesmente acontece na
// terceira prestação não paga.
//
// ⚠ ESTA FUNÇÃO DERIVA O ATRASO DA FONTE (vencimento + pagamento), NÃO da coluna `parcelaEstado`.
// A coluna é mantida por um recálculo periódico, e recálculo que não rodou mostraria "tudo em
// dia" justamente na empresa que está a uma prestação da rescisão. Para o alerta, o dado
// derivado é mais barato e não tem como envelhecer.
//
// ⚠ E "NÃO QUITADA" INCLUI PAGAMENTO PARCIAL. Essa é a divergência mais cara do fluxo: a
// prestação parece paga (há arrecadação, há comprovante) e mesmo assim conta como inadimplida
// para a RFB. Quem chama informa `quitada`; pagamento parcial entra como `false`.

/**
 * A regra de rescisão, como DADO da modalidade — nunca embutida na função.
 *
 * ⚠ `citacaoConferida: false` — a redação VIGENTE não foi conferida na fonte oficial (a
 * publicação no DOU bloqueia acesso automatizado, e a IN foi alterada depois de publicada).
 * Enquanto for `false`, a tela mostra a CONTAGEM e o risco, **sem imprimir o número do artigo**:
 * o contador confia no número e age, e artigo errado na tela é pior que artigo nenhum.
 * Mesma disciplina do `verificadoTrial` das integrações.
 */
export const REGRA_RESCISAO_PADRAO = Object.freeze({
  id: "IN_RFB_2063_2022_ART_18",
  descricao: "3 prestações, consecutivas ou não; ou 2 se as demais estiverem pagas ou a última vencida",
  limiteAbsoluto: 3,        // (I)
  limiteComDemaisPagas: 2,  // (II)
  citacaoConferida: false,
});

export const NIVEL = Object.freeze({
  OK: "ok",                    // nada em atraso
  ATENCAO: "atencao",          // 1 em atraso
  CRITICO: "critico",          // 2 em atraso — a próxima rescinde
  RESCINDIVEL: "rescindivel",  // já atingiu a regra
});

/**
 * @param {Array<{numeroParcela?: number, vencimento: Date|string, quitada: boolean}>} parcelas
 * @param {object} [regra] regra da MODALIDADE cadastrada (RELP/Simples tem a sua própria)
 * @param {Date} [agora]
 */
export function avaliarRiscoRescisao({ parcelas, regra = REGRA_RESCISAO_PADRAO, agora = new Date() } = {}) {
  const lista = (Array.isArray(parcelas) ? parcelas : [])
    .map((p) => ({ ...p, venc: p?.vencimento ? new Date(p.vencimento) : null }))
    .filter((p) => p.venc && !Number.isNaN(p.venc.getTime()));

  if (!lista.length) {
    return { nivel: NIVEL.OK, emAtraso: 0, vencidas: 0, regra, avaliavel: false, caso: null };
  }

  // ⚠ SÓ PRESTAÇÃO VENCIDA CONTA. Parcela futura não é "não paga", é "ainda não devida" — contá-la
  // acenderia alerta vermelho em todo parcelamento recém-aberto, e um alerta que acende sempre é
  // um alerta que ninguém lê.
  const vencidas = lista.filter((p) => p.venc.getTime() < agora.getTime());
  const naoQuitadas = vencidas.filter((p) => !p.quitada);
  const emAtraso = naoQuitadas.length;

  // Caso (II): as DEMAIS prestações já foram quitadas, ou a última do cronograma já venceu — ou
  // seja, não há mais prestação futura por onde regularizar.
  const demaisQuitadas = lista.filter((p) => !naoQuitadas.includes(p)).every((p) => p.quitada);
  const ultima = lista.reduce((a, b) => (a.venc.getTime() >= b.venc.getTime() ? a : b));
  const ultimaVencida = ultima.venc.getTime() < agora.getTime();

  let nivel = NIVEL.OK;
  let caso = null;
  if (emAtraso >= regra.limiteAbsoluto) {
    nivel = NIVEL.RESCINDIVEL;
    caso = "I";
  } else if (emAtraso >= regra.limiteComDemaisPagas && (demaisQuitadas || ultimaVencida)) {
    nivel = NIVEL.RESCINDIVEL;
    caso = "II";
  } else if (emAtraso >= 2) {
    nivel = NIVEL.CRITICO;
  } else if (emAtraso === 1) {
    nivel = NIVEL.ATENCAO;
  }

  return {
    nivel,
    caso,
    emAtraso,
    vencidas: vencidas.length,
    // Quantas ainda faltam para atingir a regra — é o número que o contador precisa ver.
    faltamParaRescindir: nivel === NIVEL.RESCINDIVEL ? 0 : Math.max(0, regra.limiteAbsoluto - emAtraso),
    parcelasEmAtraso: naoQuitadas.map((p) => ({ numeroParcela: p.numeroParcela ?? null, vencimento: p.venc })),
    regra,
    avaliavel: true,
  };
}
