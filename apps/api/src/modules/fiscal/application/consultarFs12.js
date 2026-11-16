import { avaliarExigenciaFs12 } from './avaliarExigenciaFs12.js';

// Consulta somente leitura. Não recebe evidências ou conferência do navegador.
export async function consultarFs12({ portalClientId, competencia }, { lerContexto, agora }) {
  if (typeof portalClientId !== 'string' || !portalClientId.trim()
    || typeof competencia !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(competencia)) {
    throw Object.assign(new Error('Informe empresa e competência válidas.'), { status: 400, code: 'CONTEXTO_FS12_INVALIDO' });
  }
  const contexto = await lerContexto({ portalClientId, competencia });
  if (!contexto) throw Object.assign(new Error('Empresa não encontrada.'), { status: 404, code: 'EMPRESA_NAO_ENCONTRADA' });
  if (contexto.competenciaApuracao !== competencia || !contexto.empresaId) {
    throw Object.assign(new Error('Não foi possível identificar o contexto da FS12.'), { status: 503, code: 'CONTEXTO_FS12_INDISPONIVEL' });
  }
  // Não há ainda fonte mensal autenticada e versionada. Memória, agregado e razão
  // contábil não são adaptados para fatos de evidência nem para zero fiscal.
  const avaliacao = avaliarExigenciaFs12({ contexto, evidencias: [], avaliadoEm: agora() });
  return { portalClientId, competencia, ...avaliacao,
    integracao: { situacao: 'PENDENTE', permiteNovoCalculo: false,
      motivo: 'A conferência fiscal mensal e sua integração ao cálculo ainda não estão disponíveis. Reúna a folha dos meses indicados; o rascunho não libera cálculo.' } };
}
