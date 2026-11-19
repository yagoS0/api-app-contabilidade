import { identificarDeclaracaoNoIndice, projetarEstadoDocumentalPgdas } from '../domain/evidenciaDocumentalPgdas.js';

function validarEntrada({ portalClientId, competencia }) {
  if (!portalClientId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia || '')) throw Object.assign(new Error('Informe a empresa e competência para a consulta documental.'), { code: 'PGDAS_CONSULTA_NAO_CONFIRMADA', status: 400 });
}
export async function consultarDocumentosPgdas(entrada, { autorizar, ler }) {
  validarEntrada(entrada);
  await autorizar();
  return projetarEstadoDocumentalPgdas(await ler(entrada));
}

// Só capacidades documentais: sem cálculo, transmissão, pagamento ou contabilização.
export async function recuperarDocumentosPgdas(entrada, portas) {
  validarEntrada(entrada);
  if (entrada.confirmCompetencia !== entrada.competencia) throw Object.assign(new Error('Confirme a competência para consultar documentos.'), { code: 'PGDAS_CONSULTA_NAO_CONFIRMADA', status: 400 });
  await portas.autorizar();
  const anterior = await portas.ler(entrada);
  const local = projetarEstadoDocumentalPgdas(anterior);
  if (local.completos) return local;
  const indice = await portas.consultarIndice({ ...entrada, contribuinteCnpj: anterior.company.cnpj });
  const consulta = identificarDeclaracaoNoIndice(indice, { competencia: entrada.competencia, contribuinteCnpj: anterior.company.cnpj });
  if (!consulta) return { ...local, partial: true, consultaOficial: 'DECLARACAO_NAO_ENCONTRADA' };
  await portas.autorizar();
  await portas.registrarConsulta({ portalClientId: entrada.portalClientId, competencia: entrada.competencia, cnpj: anterior.company.cnpj, numeroDeclaracao: consulta.numeroDeclaracao });
  const contexto = { ...entrada, indiceExistente: indice, numeroDeclaracao: consulta.numeroDeclaracao };
  const pendencias = [];
  const executar = async (tipo, capacidade) => {
    try { await portas.autorizar(); await capacidade(contexto); }
    catch (error) {
      if (error?.code === 'ACESSO_NEGADO' || error?.status === 401 || error?.status === 403) throw error;
      pendencias.push({ documento: tipo, code: error?.code || 'PGDAS_DOCUMENTO_INDISPONIVEL', mensagem: 'Documento não confirmado. Confira a pendência antes de tentar novamente.' });
    }
  };
  // O índice oficial não associa uma declaração externa ao cálculo local.
  if (!local.documentos.extrato.ok || local.numeroDeclaracao !== consulta.numeroDeclaracao) await executar('extrato', portas.recuperarExtrato);
  await portas.autorizar();
  const aposExtrato = projetarEstadoDocumentalPgdas({ ...await portas.ler(entrada), consulta });
  // Falhas de identidade, autorização ou guarda não autorizam outro despacho.
  if (!pendencias.length && !aposExtrato.documentos.guia.ok) await executar('guia', portas.recuperarGuia);
  await portas.autorizar();
  const resultado = projetarEstadoDocumentalPgdas({ ...await portas.ler(entrada), consulta });
  return { ...resultado, partial: resultado.partial || pendencias.length > 0, pendencias };
}
