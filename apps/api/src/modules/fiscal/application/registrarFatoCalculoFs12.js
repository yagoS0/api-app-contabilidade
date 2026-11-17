import { erroFs12, validarIdentidadeFs12 } from '../domain/serieManualFs12.js';
const tipos = ['TENTATIVA_INICIADA', 'RESULTADO_CONFIRMADO', 'RESULTADO_INCERTO', 'RESULTADO_CONCILIADO', 'RECUSA_COMPROVADA'];
const erro = () => erroFs12('FS12_FATO_SEM_EVIDENCIA', 'Não foi possível comprovar o fato para este cálculo e tentativa.', 409);
const texto = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;

// Internal command only. No route accepts fiscal evidence from a browser.
// This journal never changes the snapshot state and never authorizes a dispatch.
export async function registrarFatoCalculoFs12(entrada, { transacionar }) {
  validarIdentidadeFs12(entrada);
  if (!tipos.includes(entrada.tipo) || !texto(entrada.calculoId) || !texto(entrada.tentativaId)
    || !texto(entrada.chaveIdempotencia) || !texto(entrada.evidenciaReferencia)) throw erro();
  return transacionar(async p => {
    await p.autorizar(entrada);
    const contexto = await p.lerContexto(entrada);
    if (!contexto) throw erro();
    const vinculo = await p.lerVinculo({ ...entrada, companyId: contexto.empresaId });
    if (!vinculo) throw erro();
    // Trusted adapter must read a persisted, correlated fact. A reference/string/hash alone is no proof.
    const evidencia = await p.lerEvidenciaFiscal({ vinculo, tentativaId: entrada.tentativaId, referencia: entrada.evidenciaReferencia, tipo: entrada.tipo });
    if (!evidencia || evidencia.tipo !== entrada.tipo || evidencia.referencia !== entrada.evidenciaReferencia
      || evidencia.calculoId !== vinculo.calculoId || evidencia.portalClientId !== vinculo.portalClientId
      || evidencia.companyId !== vinculo.companyId || evidencia.competencia !== vinculo.competencia
      || evidencia.tentativaId !== entrada.tentativaId || !texto(evidencia.origem)) throw erro();
    const confirmado = ['RESULTADO_CONFIRMADO', 'RESULTADO_CONCILIADO'].includes(entrada.tipo);
    if (confirmado && (!['RESPOSTA_OFICIAL_CORRELACIONADA', 'RECIBO_OFICIAL_CORRELACIONADO'].includes(evidencia.proveniencia)
      || !texto(evidencia.numeroDeclaracao))) throw erro();
    if (entrada.tipo !== 'TENTATIVA_INICIADA' && !await p.lerTentativa({ vinculoId: vinculo.id, tentativaId: entrada.tentativaId })) throw erro();
    const data = { vinculoId: vinculo.id, tentativaId: entrada.tentativaId, tipo: entrada.tipo,
      chaveIdempotencia: entrada.chaveIdempotencia, origem: evidencia.origem, evidenciaReferencia: evidencia.referencia,
      numeroDeclaracao: confirmado ? evidencia.numeroDeclaracao : null,
      versaoDocumentoId: confirmado ? evidencia.versaoDocumentoId || null : null };
    const conteudoHash = p.hash(data);
    const anterior = await p.lerFato(data);
    if (anterior) {
      if (anterior.conteudoHash !== conteudoHash) throw erro();
      return { fato: anterior, replay: true, autorizaEfeitoFiscal: false };
    }
    return { fato: await p.inserirFato({ ...data, conteudoHash }), replay: false, autorizaEfeitoFiscal: false };
  }, { escrita: true });
}
