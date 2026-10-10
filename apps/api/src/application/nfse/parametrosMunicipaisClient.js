import axios from 'axios';
import https from 'node:https';

// Contrato autenticado /parametrizacao/swagger/v1/swagger.json, 10/10/2026.
// Não usar os endpoints de manutenção exclusivos dos municípios.
export const BASES_PARAMETROS = Object.freeze({
  homolog: 'https://adn.producaorestrita.nfse.gov.br/parametrizacao',
  producao: 'https://adn.nfse.gov.br/parametrizacao',
});
export function erroParametros(code, message) { return Object.assign(new Error(message), { code }); }

export function caminhoParametros({ municipio, recurso, codigoServico }) {
  if (typeof municipio !== 'string' || !/^\d{7}$/.test(municipio)) throw erroParametros('NFSE_PARAMETROS_ENTRADA_INVALIDA', 'Informe o código IBGE do município com sete dígitos.');
  if (!['convenio', 'servico'].includes(recurso)) throw erroParametros('NFSE_PARAMETROS_ENTRADA_INVALIDA', 'Escolha convênio ou serviço.');
  if (recurso === 'servico' && (typeof codigoServico !== 'string' || !/^\d{9}$/.test(codigoServico))) throw erroParametros('NFSE_PARAMETROS_ENTRADA_INVALIDA', 'Informe o código nacional com seis dígitos e o complemento municipal com três dígitos.');
  // O serviço oficial exige a máscara 00.00.00.000, embora a mensagem 400
  // mencione apenas nove dígitos. Confirmado em produção restrita em 10/10/2026.
  const codigoFormatado = codigoServico?.replace(/^(\d{2})(\d{2})(\d{2})(\d{3})$/, '$1.$2.$3.$4');
  return recurso === 'convenio' ? `/${municipio}/convenio` : `/${municipio}/${codigoFormatado}/historicoaliquotas`;
}

export function criarClienteParametros({ ambiente, certificado, criarHttp = axios.create }) {
  const baseURL = BASES_PARAMETROS[ambiente];
  if (!baseURL) throw erroParametros('NFSE_PARAMETROS_AMBIENTE_INVALIDO', 'Ambiente de consulta municipal inválido.');
  if (!certificado?.pfxBuffer) throw erroParametros('NO_COMPANY_CERT', 'É necessário o certificado A1 da própria empresa.');
  const credencial = certificado.certPem && certificado.keyPem
    ? { cert: certificado.certPem, key: certificado.keyPem }
    : { pfx: certificado.pfxBuffer, passphrase: certificado.password || undefined };
  const agent = new https.Agent({ ...credencial, rejectUnauthorized: true });
  const http = criarHttp({ baseURL, httpsAgent: agent, timeout: 15000, maxRedirects: 0,
    maxContentLength: 1024 * 1024, responseType: 'text', transformResponse: [x => x],
    headers: { Accept: 'application/json' } });
  return {
    origem: baseURL,
    fechar: () => agent.destroy(),
    async consultar(entrada) {
      const caminho = caminhoParametros(entrada);
      let r;
      try {
        r = await http.get(caminho);
      } catch (err) {
        const httpStatus = Number(err?.response?.status) || null;
        const code = httpStatus === 404 ? 'NFSE_PARAMETROS_NAO_LOCALIZADOS'
          : [401, 403].includes(httpStatus) ? 'NFSE_PARAMETROS_ACESSO_RECUSADO' : 'NFSE_PARAMETROS_CONSULTA_FALHOU';
        throw Object.assign(erroParametros(code, 'Não foi possível consultar os parâmetros municipais. Confira o certificado, a conexão e o acesso ao serviço oficial.'), { httpStatus });
      }
      try {
        if (r.status !== 200) throw erroParametros('NFSE_PARAMETROS_RESPOSTA_INVALIDA', 'A consulta não retornou um documento de parâmetros.');
        const texto = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
        if (!texto || Buffer.byteLength(texto) > 1024 * 1024) throw new Error('limite');
        const dados = JSON.parse(texto);
        if (!dados || typeof dados !== 'object') throw new Error('formato');
        // HTTP 200/JSON não comprova vigência, convênio ativo nem enquadramento fiscal.
        return { caminho, resposta: dados };
      } catch (err) {
        // Nunca devolver erro Axios/config/PFX, nem interpretar indisponibilidade como isenção.
        throw Object.assign(erroParametros('NFSE_PARAMETROS_RESPOSTA_INVALIDA', 'O serviço oficial não retornou um documento de parâmetros válido.'), { httpStatus: r.status || null });
      }
    },
  };
}
