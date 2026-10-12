import { consultarCnpj } from '../tomador/consultaCnpj.js';
import { cnpjTemDvValido } from '@contabilidade/shared/documentos-fiscais';

// Reutiliza BrasilAPI -> Minha Receita. Não promove fonte pública a prova oficial RFB.
export function criarClienteCadastroPublico({ consultar = consultarCnpj, agora = () => new Date() } = {}) {
  return { async consultar(documento, { municipios } = {}) {
    if (typeof documento !== 'string' || !/^\d{14}$/.test(documento) || !cnpjTemDvValido(documento)) return {
      ok: false, fonte: 'CONSULTA_PUBLICA', motivo: 'DOCUMENTO_NAO_SUPORTADO', vigenciaComprovada: false };
    const r = await consultar(documento, { municipios, log: null });
    if (!r.ok) return { ok: false, fonte: r.fonte || 'CONSULTA_PUBLICA', motivo: r.motivo, vigenciaComprovada: false };
    return { ok: true, documento, fonte: r.fonte, consultadoEm: agora().toISOString(), vigenciaComprovada: false,
      municipioDescricao: typeof r.bruto?.municipio === 'string' ? r.bruto.municipio : null,
      uf: typeof r.bruto?.uf === 'string' ? r.bruto.uf : null,
      pendencias: ['CADASTRO_RFB_POR_COMPETENCIA'] };
  } };
}
