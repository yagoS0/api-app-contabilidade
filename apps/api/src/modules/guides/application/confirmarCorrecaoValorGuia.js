import { carregarGuiaParaCorrecao, CorrecaoValorError } from "./preverCorrecaoValorGuia.js";

const recusar = (code, message, status) => { throw new CorrecaoValorError(code, message, status); };

export async function confirmarCorrecaoValorGuia({ companyId, guideId, valor, revisao, userId }, { prever, emTransacao }) {
  if (!userId || !revisao) recusar("revisao_obrigatoria", "Confira a prévia antes de corrigir a guia.", 400);
  const previa = await prever({ companyId, guideId, valor });
  if (revisao !== previa.revisao) recusar("guia_alterada", "A guia ou o lançamento mudou. Abra uma nova prévia.");
  const { novoValor } = previa;
  return emTransacao(async portas => {
    const atual = await carregarGuiaParaCorrecao({ companyId, guideId, novoValor }, portas);
    if (atual.revisao !== revisao) recusar("guia_alterada", "A guia ou o lançamento mudou. Abra uma nova prévia.");
    const quantidade = await portas.atualizarValorGuia({
      companyId, guideId, updatedAt: atual.g.updatedAt, novoValor, leitura: previa._leitura, userId,
    });
    if (quantidade !== 1) recusar("guia_alterada", "A guia mudou. Abra uma nova prévia.");
    const entradas = atual.g.accountingEntries;
    for (const entrada of entradas) await portas.corrigirProvisao(entrada, novoValor);
    await portas.registrarAuditoria({
      companyId, guideId, userId, valorAnterior: previa.valorAtual, valorCorrigido: novoValor,
      revisao, em: new Date().toISOString(), lancamentos: entradas.map(e => e.id), pdfPreservado: true,
    });
    return { ok: true, guideId, valor: novoValor, lancamentosAfetados: entradas.length };
  });
}
