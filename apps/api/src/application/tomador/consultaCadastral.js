import { cnpjTemDvValido, normalizarDocumento } from '@contabilidade/shared/documentos-fiscais';

const ELEGIVEIS = new Set(['rede', 'timeout', 'nao_encontrado', 'indisponivel', 'resposta_invalida']);
export const cadastroGratuitoSuficiente = bruto => [bruto?.razao_social, bruto?.logradouro, bruto?.bairro, bruto?.municipio, bruto?.uf]
  .every(v => typeof v === 'string' && v.trim()) && /^\d{8}$/.test(String(bruto?.cep ?? '').replace(/[\s-]/g, ''));
const completude = resultado => ['razao_social', 'logradouro', 'bairro', 'municipio', 'uf', 'cep']
  .filter(campo => typeof resultado?.bruto?.[campo] === 'string' && resultado.bruto[campo].trim()).length;

/**
 * Política gratuita primeiro. Dependências pagas são de composição no servidor.
 * consultaCnpjRepository reserva orçamento + requestKey atomicamente e mantém
 * reservas incertas. Sem uma reserva autorizada, não há chamada paga.
 */
export function criarConsultaCadastral({ consultarGratuito, serpro = null,
  habilitarPago = false, reservas = null, precoUnitarioMicros = null, modalidade = 'BASICA', finalidade = 'EMISSOR' } = {}) {
  if (typeof consultarGratuito !== 'function') throw new TypeError('Consulta gratuita obrigatória.');
  return async function consultar(cnpj, opcoes = {}) {
    const gratuito = await consultarGratuito(cnpj, { ...opcoes, exigirCadastroSuficiente: true });
    if (gratuito.ok && cadastroGratuitoSuficiente(gratuito.bruto) && modalidade === 'BASICA') return gratuito;
    if (!gratuito.ok && !ELEGIVEIS.has(gratuito.motivo)) return gratuito;
    const documento = normalizarDocumento(cnpj);
    if (habilitarPago !== true || !/^\d{14}$/.test(documento) || !cnpjTemDvValido(documento)
      || typeof serpro?.consultar !== 'function' || typeof reservas?.reservar !== 'function'
      || typeof reservas?.concluir !== 'function' || !['BASICA','EMPRESA'].includes(modalidade)
      || (reservas.precosPersistidos !== true && (!Number.isSafeInteger(precoUnitarioMicros) || precoUnitarioMicros <= 0))
      || (modalidade === 'EMPRESA' && finalidade !== 'CADASTRO') || typeof opcoes.escritorioId !== 'string' || !opcoes.escritorioId.trim()
      || typeof opcoes.requestKey !== 'string' || !opcoes.requestKey.trim()) return gratuito;

    let reserva;
    try {
      reserva = await reservas.reservar({ escritorioId: opcoes.escritorioId, requestKey: opcoes.requestKey,
        cnpj: documento, modalidade, finalidade, precoUnitarioMicros });
    } catch { return gratuito; }
    if (!reserva?.id || reserva.autorizada !== true) return gratuito;

    let pago;
    try { pago = await serpro.consultar(documento, { municipios: opcoes.municipios }); }
    catch { pago = { ok: false, motivo: 'serpro_indisponivel', resultadoIncerto: true }; }
    // O adaptador precisa confirmar a identidade antes de oferecer dados à interface.
    if (pago?.ok && (pago.cnpj !== documento || pago.bruto?.cnpj !== documento || !pago.tomador)) {
      pago = { ok: false, motivo: 'resposta_invalida', resultadoIncerto: true };
    }
    try {
      await reservas.concluir({ id: reserva.id, status: pago?.ok ? 'CONCLUIDA' : 'INCERTA',
        motivo: pago?.ok ? null : 'consulta_sem_resultado_util' });
    } catch {
      // A reserva continua consumindo orçamento; não repetir nem liberar a cobrança.
      return { ...gratuito, consultaPaga: { status: 'INCERTA' } };
    }
    if (!pago?.ok) return { ...gratuito, consultaPaga: { status: 'INCERTA' } };
    if (modalidade === 'BASICA' && gratuito.ok && ((gratuito.tomador?.endereco && !pago.tomador.endereco)
      || completude(gratuito) > completude(pago))) {
      return { ...gratuito, consultaPaga: { status: 'CONCLUIDA' },
        fontesTentadas: [...(gratuito.fontesTentadas || []), 'SERPRO_BASICA'] };
    }
    return { ...pago, fonte: `SERPRO_${modalidade}`, modalidade,
      fontesTentadas: [...(gratuito.fontesTentadas || []), `SERPRO_${modalidade}`] };
  };
}
