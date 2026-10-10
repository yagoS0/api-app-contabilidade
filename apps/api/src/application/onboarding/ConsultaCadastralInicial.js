import { consultarCnpj } from '../tomador/consultaCnpj.js';
import { cnpjValido } from './interpretacaoComercialWhatsapp.js';

const texto = v => ['string', 'number'].includes(typeof v) ? String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 400) || null : null;
const lista = v => Array.isArray(v) ? v.slice(0, 50) : [];
const simNao = v => typeof v === 'boolean' ? v : null;

export function normalizarConsultaCadastral(out, cnpj, agora) {
  if (!out?.ok || String(out.bruto?.cnpj || out.cnpj || '').replace(/\D/g, '') !== cnpj) return null;
  const b = out.bruto || {};
  return {
    cnpj, fonte: out.fonte === 'BRASILAPI' ? 'BrasilAPI' : out.fonte === 'MINHA_RECEITA' ? 'Minha Receita' : 'Cadastro público',
    consultadoEm: agora.toISOString(), razaoSocial: texto(b.razao_social), nomeFantasia: texto(b.nome_fantasia),
    situacaoCadastral: texto(b.descricao_situacao_cadastral), dataSituacao: texto(b.data_situacao_cadastral), motivoSituacao: texto(b.descricao_motivo_situacao_cadastral),
    dataAbertura: texto(b.data_inicio_atividade), naturezaJuridica: texto(b.natureza_juridica), porte: texto(b.porte),
    cnaePrincipal: texto(b.cnae_fiscal), atividadePrincipal: texto(b.cnae_fiscal_descricao),
    cnaesSecundarios: lista(b.cnaes_secundarios).map(c => ({ codigo: texto(c.codigo), descricao: texto(c.descricao) })),
    municipio: texto(b.municipio), uf: texto(b.uf),
    endereco: [b.descricao_tipo_de_logradouro, b.logradouro, b.numero, b.complemento, b.bairro, b.cep].map(texto).filter(Boolean).join(', ') || null,
    telefone: texto(b.ddd_telefone_1), email: texto(b.email),
    capitalSocial: typeof b.capital_social === 'number' && Number.isFinite(b.capital_social) ? b.capital_social : null,
    opcaoSimples: simNao(b.opcao_pelo_simples), opcaoMei: simNao(b.opcao_pelo_mei),
    socios: lista(b.qsa).map(s => ({ nome: texto(s.nome_socio), qualificacao: texto(s.qualificacao_socio), entrada: texto(s.data_entrada_sociedade) })),
  };
}

// Apenas cadastro público; sem vínculo operacional, procuração ou consulta fiscal privada.
export async function consultarCadastroInicial({ cnpj, anterior, mensagemId, agora = new Date(), consultar = consultarCnpj }) {
  if (!cnpjValido(cnpj)) return null;
  // Uma consulta por CNPJ no primeiro atendimento. Replays e mensagens seguintes reutilizam o resultado, inclusive indisponibilidade.
  if (anterior?.cnpj === cnpj) return anterior;
  let dados;
  try { dados = normalizarConsultaCadastral(await consultar(cnpj), cnpj, agora); } catch { /* resposta de indisponibilidade abaixo */ }
  return { cnpj, estado: dados ? 'CONCLUIDA' : 'INDISPONIVEL', mensagemId, consultadoEm: agora.toISOString(), ...(dados ? { dados } : {}) };
}

export function enriquecerResumoCadastral(anterior = {}, consulta) {
  const pre = { ...anterior, fontesPublicas: { ...anterior.fontesPublicas } };
  if (!consulta) return pre;
  if (pre.consultaPublica?.cnpj !== consulta.cnpj) {
    for (const [campo, fonte] of Object.entries(pre.fontesPublicas)) if (pre[campo] === fonte.valor) delete pre[campo];
    pre.fontesPublicas = {};
  }
  pre.consultaPublica = consulta;
  const d = consulta.dados;
  for (const [campo, valor] of Object.entries({ atividade: d?.atividadePrincipal, cidade: d?.municipio })) {
    if (valor && !pre[campo]) { pre[campo] = valor; pre.fontesPublicas[campo] = { valor, cnpj: consulta.cnpj, fonte: d.fonte, consultadoEm: d.consultadoEm }; }
  }
  return pre;
}

export function resumoDaConsulta(consulta) {
  if (!consulta) return null;
  if (consulta.estado !== 'CONCLUIDA') return 'Não consegui consultar o cadastro agora. Podemos continuar com as informações que você tiver.';
  const d = consulta.dados;
  return [`Encontrei ${d.razaoSocial || 'o cadastro desse CNPJ'}${d.municipio ? ` em ${d.municipio}${d.uf ? `/${d.uf}` : ''}` : ''}.`,
    d.situacaoCadastral ? `Na consulta pública, a situação cadastral consta como ${d.situacaoCadastral}.` : null].filter(Boolean).join(' ');
}
