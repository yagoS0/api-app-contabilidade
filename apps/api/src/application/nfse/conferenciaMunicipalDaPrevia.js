import { parametrosMunicipaisDaCompetencia } from './parametrosMunicipaisCompetencia.js';
import { conferirConvenioMunicipal } from './convenioMunicipalCompetencia.js';
import { diaFiscal } from './regimeDaCompetencia.js';

// Leitura auxiliar do histórico já obtido. Não substitui a alíquota fiscal ou envia consultas.
export async function conferenciaMunicipalDaPrevia({ db, companyId, ambiente, municipio, codigoServicoNacional, codigoServicoMunicipal, competencia, habilitado }) {
  const pendente = motivo => ({ estado: 'PENDENTE', motivo, validacaoMunicipalCompleta: false, somenteLeitura: true });
  if (!habilitado) return pendente('CONSULTA_MUNICIPAL_DESABILITADA');
  if (!diaFiscal(competencia)) return pendente('INFORMAR_DIA_PRESTACAO');
  if (!/^\d{7}$/.test(municipio || '') || !/^\d{6}$/.test(codigoServicoNacional || '') || !/^\d{3}$/.test(codigoServicoMunicipal || '') || codigoServicoMunicipal === '000') return pendente('ESCOPO_MUNICIPAL_INCOMPLETO');
  const codigoServico = codigoServicoNacional + codigoServicoMunicipal;
  try {
    const consultas = await db.nfseConsultaMunicipal.findMany({ where: { companyId, ambiente, municipio,
      status: 'RECEBIDO_PARA_CONFERENCIA', OR: [{ recurso: 'servico', codigoServico }, { recurso: 'convenio' }] } });
    const escopo = { consultas, companyId, ambiente, municipio, codigoServico, competencia };
    return { ...parametrosMunicipaisDaCompetencia(escopo), convenio: conferirConvenioMunicipal(escopo), somenteLeitura: true };
  } catch { return pendente('HISTORICO_MUNICIPAL_INDISPONIVEL'); }
}
