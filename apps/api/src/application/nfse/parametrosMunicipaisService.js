import { prisma } from '../../infrastructure/db/prisma.js';
import { NFSE_ENV, INTEGRACAO_PARAMETROS_MUNICIPAIS } from '../../config.js';
import { resolverCertificadosDaEmpresa } from './nfseCertificado.js';
import { criarClienteParametros, caminhoParametros, erroParametros } from './parametrosMunicipaisClient.js';

export function criarServicoParametros({ db = prisma, ambiente = NFSE_ENV, habilitado = INTEGRACAO_PARAMETROS_MUNICIPAIS,
  resolverCertificados = resolverCertificadosDaEmpresa, criarCliente = criarClienteParametros } = {}) {
  async function empresa(portalClientId) {
    const portal = await db.portalClient.findUnique({ where: { id: portalClientId }, select: { companyId: true } });
    const company = portal?.companyId && await db.company.findUnique({ where: { id: portal.companyId },
      select: { id: true, codigoMunicipioIbge: true, codigoServicoNacional: true, codigosServicoNacional: true, codigoServicoMunicipal: true } });
    if (!company) throw erroParametros('NFSE_PARAMETROS_EMPRESA_AUSENTE', 'Empresa sem cadastro de emissão vinculado.');
    return company;
  }
  return {
    async listar(portalClientId) {
      const company = await empresa(portalClientId);
      const consultas = habilitado ? await db.nfseConsultaMunicipal.findMany({ where: { companyId: company.id, ambiente },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }) : [];
      return { habilitado, ambiente, municipio: company.codigoMunicipioIbge,
        codigoServicoNacional: company.codigoServicoNacional, codigoServicoMunicipal: company.codigoServicoMunicipal,
        servicos: company.codigosServicoNacional?.length ? company.codigosServicoNacional : [company.codigoServicoNacional].filter(Boolean),
        consultas, validacaoMunicipalCompleta: false };
    },
    async consultar({ portalClientId, autorId, municipio, recurso, codigoServico, codigoServicoMunicipal, requestKey }) {
      if (!habilitado) throw erroParametros('NFSE_PARAMETROS_DESABILITADOS', 'A consulta de parâmetros municipais ainda não está habilitada neste ambiente.');
      const company = await empresa(portalClientId);
      if (recurso === 'servico' && (typeof codigoServico !== 'string' || !/^\d{6}$/.test(codigoServico)
        || typeof codigoServicoMunicipal !== 'string' || !/^\d{3}$/.test(codigoServicoMunicipal))) {
        throw erroParametros('NFSE_PARAMETROS_ENTRADA_INVALIDA', 'Confira o serviço nacional e informe o complemento municipal com três dígitos, sem presumir zeros.');
      }
      const entrada = { municipio: municipio || company.codigoMunicipioIbge, recurso, codigoServico: recurso === 'servico' ? codigoServico + codigoServicoMunicipal : null };
      const caminho = caminhoParametros(entrada);
      const servicos = company.codigosServicoNacional?.length ? company.codigosServicoNacional : [company.codigoServicoNacional].filter(Boolean);
      if (recurso === 'servico' && !servicos.includes(codigoServico)) throw erroParametros('NFSE_PARAMETROS_ENTRADA_INVALIDA', 'O serviço precisa estar cadastrado nesta empresa.');
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestKey || '')) throw erroParametros('NFSE_PARAMETROS_ENTRADA_INVALIDA', 'Identificador da consulta inválido.');
      const where = { companyId_ambiente_requestKey: { companyId: company.id, ambiente, requestKey } };
      const existente = await db.nfseConsultaMunicipal.findUnique({ where });
      function repetir(registro) {
        if (registro.caminho !== caminho) throw erroParametros('NFSE_PARAMETROS_CONFLITO', 'Este identificador já pertence a outra consulta.');
        return registro; // Em andamento/interrompida também não provoca reenvio.
      }
      if (existente) return repetir(existente);
      const certificados = await resolverCertificados(company.id);
      const client = criarCliente({ ambiente, certificado: certificados.transporte });
      try {
        let registro;
        try {
          registro = await db.nfseConsultaMunicipal.create({ data: { companyId: company.id, autorId, ambiente, requestKey,
            ...entrada, caminho, origem: client.origem, status: 'CONSULTANDO' } });
        } catch (err) {
          if (err?.code !== 'P2002') throw err;
          return repetir(await db.nfseConsultaMunicipal.findUnique({ where }));
        }
        let resultado;
        try {
          const retorno = await client.consultar(entrada);
          resultado = { status: 'RECEBIDO_PARA_CONFERENCIA', resposta: retorno.resposta, httpStatus: 200 };
        } catch (err) {
          resultado = { status: 'FALHOU', erroCodigo: err?.code?.startsWith('NFSE_PARAMETROS_') ? err.code : 'NFSE_PARAMETROS_CONSULTA_FALHOU', httpStatus: err.httpStatus || null };
        }
        // Falha de persistência não autoriza nova consulta; a reserva permanece visível.
        return await db.nfseConsultaMunicipal.update({ where: { id: registro.id }, data: { ...resultado, concluidaEm: new Date() } });
      } finally { client.fechar(); }
    },
  };
}
