import { cnpjTemDvValido, normalizarDocumento } from '@contabilidade/shared/documentos-fiscais';
import { tomadorDaReceita } from './consultaTomador.js';
import { municipioSerpro } from './municipioSerpro.js';

const GATEWAY = 'https://gateway.apiserpro.serpro.gov.br';
const texto = valor => typeof valor === 'string' ? valor.trim() : '';
// https://apicenter.estaleiro.serpro.gov.br/documentacao/consulta-cnpj/pt/tipos_situacao_cadastral/
// Conferido em 13/10/2026; código desconhecido permanece sem descrição.
const SITUACOES = Object.freeze({ '1': 'NULA', '2': 'ATIVA', '3': 'SUSPENSA', '4': 'INAPTA',
  '5': 'ATIVA NÃO REGULAR', '8': 'BAIXADA' });

export function mapearSerproBasica(body, cnpj, { municipios = null } = {}) {
  if (!body || Array.isArray(body) || body.ni !== cnpj || !texto(body.nomeEmpresarial)) return null;
  const endereco = body.endereco || {};
  const municipio = municipioSerpro(endereco, municipios);
  return {
    cnpj, razao_social: texto(body.nomeEmpresarial), nome_fantasia: texto(body.nomeFantasia),
    descricao_tipo_de_logradouro: texto(endereco.tipoLogradouro), logradouro: texto(endereco.logradouro),
    numero: texto(endereco.numero), complemento: texto(endereco.complemento), bairro: texto(endereco.bairro),
    cep: texto(endereco.cep), municipio: texto(endereco.municipio?.descricao), uf: texto(endereco.uf),
    ...municipio,
    email: texto(body.correioEletronico),
    // Descrição provém da tabela oficial, nunca do código bruto.
    situacao_cadastral: texto(body.situacaoCadastral?.codigo),
    descricao_situacao_cadastral: SITUACOES[String(Number(body.situacaoCadastral?.codigo))] || '',
    data_situacao_cadastral: texto(body.situacaoCadastral?.data),
  };
}

/** Adaptador com modalidade fixa na composição. Não lê env e nasce desabilitado. */
export function criarSerproCnpjBasica({ habilitado = false, consumerKey, consumerSecret,
  fetchImpl = globalThis.fetch, agora = () => Date.now(), timeoutMs = 4000, modalidade = 'BASICA' } = {}) {
  if (!['BASICA','EMPRESA'].includes(modalidade)) throw new Error('modalidade_invalida');
  let token = null, expiraEm = 0;
  return { async consultar(valor, { municipios = null } = {}) {
    const cnpj = normalizarDocumento(valor);
    const falha = (motivo, resultadoIncerto = false) => ({ ok: false, cnpj, fonte: `SERPRO_${modalidade}`, motivo, resultadoIncerto });
    if (!/^\d{14}$/.test(cnpj) || !cnpjTemDvValido(cnpj)) return falha('cnpj_invalido');
    if (habilitado !== true || !texto(consumerKey) || !texto(consumerSecret) || typeof fetchImpl !== 'function') return falha('serpro_desabilitado');
    const controller = new AbortController();
    let timer, consultaEnviada = false;
    const limiteMs = Math.min(4000, Math.max(1, Number(timeoutMs) || 4000));
    try {
      return await Promise.race([
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error('timeout'));
        }, limiteMs); }),
        (async () => {
          const options = { signal: controller.signal, redirect: 'error' };
          if (!token || agora() >= expiraEm) {
            const auth = await fetchImpl(`${GATEWAY}/token`, { ...options, method: 'POST',
              headers: { Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
            if (auth.status !== 200) return falha('serpro_autenticacao');
            const body = await auth.json();
            if (!texto(body?.access_token) || !Number.isFinite(Number(body.expires_in)) || Number(body.expires_in) <= 0) return falha('serpro_autenticacao');
            // Fetch/JSON injetado pode ignorar o aborto: não iniciar consulta após o prazo.
            if (controller.signal.aborted) return falha('serpro_timeout');
            token = body.access_token;
            expiraEm = agora() + Math.max(0, Math.min(Number(body.expires_in), 3600) - 30) * 1000;
          }
          if (controller.signal.aborted) return falha('serpro_timeout');
          consultaEnviada = true;
          const response = await fetchImpl(`${GATEWAY}/consulta-cnpj-df/v2/${modalidade.toLowerCase()}/${cnpj}`, {
            ...options, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
          if (response.status === 401) { token = null; expiraEm = 0; }
          if (![200, 206].includes(response.status)) return falha('serpro_indisponivel', true);
          const dados = await response.json();
          const bruto = mapearSerproBasica(dados, cnpj, { municipios });
          if (!bruto) return falha('resposta_invalida', true);
          if (modalidade === 'EMPRESA') Object.assign(bruto, {
            cnae_fiscal: texto(dados.cnaePrincipal?.codigo), cnae_fiscal_descricao: texto(dados.cnaePrincipal?.descricao),
            natureza_juridica: texto(dados.naturezaJuridica?.descricao), data_inicio_atividade: texto(dados.dataAbertura),
            qsa: Array.isArray(dados.socios) ? dados.socios.map(s => ({ nome_socio: texto(s.nome), cnpj_cpf_do_socio: texto(s.cpf || s.cnpj), qualificacao_socio: texto(s.qualificacao) })) : [],
          });
          return { ok: true, cnpj, fonte: `SERPRO_${modalidade}`, modalidade,
            consultadoEm: new Date(agora()).toISOString(), bruto, tomador: tomadorDaReceita(bruto, { municipios }) };
        })(),
      ]);
    } catch { return falha(controller.signal.aborted ? 'serpro_timeout' : 'serpro_indisponivel', consultaEnviada); }
    finally { clearTimeout(timer); controller.abort(); }
  } };
}

export function criarSerproCnpjEmpresa(opcoes = {}) {
  return criarSerproCnpjBasica({ ...opcoes, modalidade: 'EMPRESA' });
}
