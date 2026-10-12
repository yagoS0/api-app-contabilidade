import axios from 'axios';
import { createHash } from 'node:crypto';
import { cnpjTemDvValido } from '@contabilidade/shared/documentos-fiscais';
import { diaFiscal } from './regimeDaCompetencia.js';

const GATEWAY = 'https://gateway.apiserpro.serpro.gov.br';
// Credenciais específicas do produto Consulta CNPJ. Não reutilizar Integra Contador.
// Consulta atual; dataAbertura e situacaoCadastral.data NÃO são vigência do endereço.
export function criarClienteRfbCnpj({ consumerKey, consumerSecret, criarHttp = axios.create, agora = () => new Date() } = {}) {
  const http = criarHttp({ baseURL: GATEWAY, timeout: 8000, maxRedirects: 0, maxContentLength: 1_000_000,
    responseType: 'json', headers: { Accept: 'application/json' } });
  let token, expira = 0;
  const falha = motivo => ({ ok: false, fonte: 'RFB_SERPRO', motivo, vigenciaComprovada: false });
  return { async consultar(cnpj) {
    if (typeof cnpj !== 'string' || !/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || !cnpjTemDvValido(cnpj)) return falha('CNPJ_INVALIDO');
    if (!consumerKey || !consumerSecret) return falha('RFB_CNPJ_NAO_CONFIGURADO');
    try {
      if (!token || agora().getTime() >= expira) {
        const r = await http.post('/token', 'grant_type=client_credentials', { headers: {
          Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded' } });
        if (r.status !== 200 || typeof r.data?.access_token !== 'string' || !r.data.access_token || !Number.isFinite(Number(r.data.expires_in)) || Number(r.data.expires_in) <= 0) return falha('RFB_AUTENTICACAO_INVALIDA');
        token = r.data.access_token;
        expira = agora().getTime() + Math.max(0, Math.min(Number(r.data.expires_in), 3600) - 30) * 1000;
      }
      const r = await http.get(`/consulta-cnpj-df/v2/basica/${cnpj}`, { headers: { Authorization: `Bearer ${token}` } });
      const b = r.data;
      if (r.status !== 200 || !b || b.ni !== cnpj || !diaFiscal(b.dataAbertura) || !b.endereco || typeof b.endereco !== 'object') return falha('RFB_RESPOSTA_INVALIDA');
      return { ok: true, fonte: 'RFB_SERPRO', consultadoEm: agora().toISOString(), vigenciaComprovada: false,
        sha256: createHash('sha256').update(JSON.stringify(b)).digest('hex'),
        documento: cnpj, dataAbertura: b.dataAbertura, cep: typeof b.endereco.cep === 'string' && /^\d{8}$/.test(b.endereco.cep) ? b.endereco.cep : null,
        municipioDescricao: typeof b.endereco.municipio?.descricao === 'string' ? b.endereco.municipio.descricao : null,
        uf: typeof b.endereco.uf === 'string' ? b.endereco.uf : null,
        // O código do município da RFB não é presumido como código IBGE.
        pendencias: ['CADASTRO_RFB_POR_COMPETENCIA'] };
    } catch (e) {
      if (e.response?.status === 401) { token = null; expira = 0; }
      return falha([401,403].includes(e.response?.status) ? 'RFB_ACESSO_RECUSADO' : e.response?.status === 404 ? 'RFB_NAO_LOCALIZADO' : 'RFB_INDISPONIVEL');
    }
  } };
}
