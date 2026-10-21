import { createHash } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { exigirEscopo } from './ComercialService.js';
import { exigirGestor } from './RecursosComerciaisService.js';
import { OnboardingError, extrairColunas } from './OnboardingService.js';
import { cnpjValido } from './interpretacaoComercialWhatsapp.js';
import { normalizarConsultaCadastral } from './ConsultaCadastralInicial.js';
import { consultarCnpjComCache } from '../tomador/consultaCnpjRuntime.js';

const fechados = ['CONVERTIDO', 'DESISTIU', 'CONCLUIDO_AVULSO'];
const erro = (code, message, status = 409) => new OnboardingError(code, message, status);
const texto = v => ['string', 'number'].includes(typeof v) ? String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 400) : '';
const digitos = v => texto(v).replace(/\D/g, '');
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const campos = ['razaoSocial', 'nomeFantasia', 'situacaoCadastral', 'dataAbertura', 'naturezaJuridica', 'porte', 'cnaePrincipal', 'atividadePrincipal', 'endereco', 'municipio', 'uf', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'telefone', 'email'];

export function normalizarCadastroComercial(empresa, cnpj, { manual = false } = {}) {
  if (!empresa || typeof empresa !== 'object' || Array.isArray(empresa)) throw erro('cadastro_invalido', 'Confira os dados da empresa.', 400);
  if (empresa.endereco && typeof empresa.endereco === 'object' && !Array.isArray(empresa.endereco)) {
    const e = empresa.endereco;
    empresa = { ...empresa, ...Object.fromEntries(['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf'].map(k => [k, e[k]])), endereco: ['logradouro', 'numero', 'complemento', 'bairro', 'cep'].map(k => texto(e[k])).filter(Boolean).join(', ') };
  }
  if (!cnpjValido(cnpj) || (empresa.cnpj && digitos(empresa.cnpj) !== cnpj)) throw erro('cnpj_invalido', 'Confira o CNPJ da empresa.', 400);
  const dados = Object.fromEntries(campos.map(k => [k, texto(empresa[k])]));
  dados.uf = dados.uf.toUpperCase();
  dados.email = dados.email.toLowerCase();
  dados.cnpj = cnpj;
  for (const campo of ['cnaesSecundarios', 'socios']) {
    if (empresa[campo] != null && (!Array.isArray(empresa[campo]) || empresa[campo].length > 100 || empresa[campo].some(item => !item || typeof item !== 'object' || Array.isArray(item)))) {
      throw new OnboardingError('cadastro_invalido', 'Confira os itens cadastrais indicados.', 400, { campos: [campo] });
    }
  }
  dados.cnaesSecundarios = (Array.isArray(empresa.cnaesSecundarios) ? empresa.cnaesSecundarios : []).slice(0, 100).map(c => ({ codigo: texto(c.codigo), descricao: texto(c.descricao) }));
  dados.socios = (Array.isArray(empresa.socios) ? empresa.socios : []).slice(0, 100).map(s => ({ nome: texto(s.nome), qualificacao: texto(s.qualificacao), entrada: texto(s.entrada) }));
  dados.capitalSocial = typeof empresa.capitalSocial === 'number' && Number.isFinite(empresa.capitalSocial) && empresa.capitalSocial >= 0 ? empresa.capitalSocial : null;
  for (const k of ['opcaoSimples', 'opcaoMei']) dados[k] = typeof empresa[k] === 'boolean' ? empresa[k] : null;
  const obrigatorios = manual ? ['razaoSocial', 'endereco', 'municipio', 'uf', 'cnaePrincipal', 'naturezaJuridica', 'porte'] : ['razaoSocial'];
  const pendentes = obrigatorios.filter(k => !dados[k]);
  if (pendentes.length) throw new OnboardingError('cadastro_incompleto', 'Preencha os dados cadastrais indicados.', 400, { campos: pendentes });
  if (dados.uf && !/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(dados.uf)) throw erro('uf_invalida', 'Confira a UF.', 400);
  return dados;
}

// R32/R34: cadastro declarado não é prova fiscal. Revisão material invalida derivados;
// assinatura, contratação, pagamentos, documentos e histórico permanecem intactos.
export function criarCadastroComercial({ db = prisma, consultarCnpj = consultarCnpjComCache, agora = () => new Date() } = {}) {
  function conferir(ficha, body) {
    if (fechados.includes(ficha.status) || ficha.portalClientId) throw erro('ficha_encerrada', 'Esta oportunidade está encerrada.');
    if (!Number.isInteger(body.versao) || body.versao !== ficha.versao) throw erro('ficha_alterada', 'A ficha mudou. Atualize antes de salvar.');
    if (ficha.origem === 'PESSOA_FISICA') throw erro('cadastro_inaplicavel', 'Use o cadastro de pessoa física.');
  }
  async function persistir(id, user, body, empresa, origem, fonte, consulta = null) {
    return db.$transaction(async tx => {
      const ficha = await exigirEscopo(id, user, tx);
      conferir(ficha, body);
      const anterior = ficha.dados || {};
      const fingerprint = hash(empresa);
      const material = anterior.cadastroCnpj?.fingerprint !== fingerprint || anterior.cadastroCnpj?.origem !== origem || anterior.cadastroCnpj?.fonte !== fonte;
      const em = agora().toISOString();
      const cadastroCnpj = { empresa, origem, fonte, atorId: user.id, em, fingerprint, ...(consulta ? { consulta } : {}) };
      const dados = { ...anterior, ...empresa, cadastroCnpj,
        cadastroRevisao: material ? (Number(anterior.cadastroRevisao) || 0) + 1 : (Number(anterior.cadastroRevisao) || 0) };
      if (material) dados.derivadosCadastro = { estado: 'REVISAR', cadastroFingerprint: fingerprint, em };
      if (ficha.cnpj !== empresa.cnpj) delete dados.procuracaoManual;
      const reserva = await tx.onboarding.updateMany({ where: { id, versao: body.versao, status: { notIn: fechados }, portalClientId: null }, data: {
        dados, ...extrairColunas(ficha.origem, dados), versao: { increment: 1 },
        fontesDados: { ...(ficha.fontesDados || {}), cadastroCnpj: { origem, fonte, atorId: user.id, em } },
      } });
      if (reserva.count !== 1) throw erro('ficha_alterada', 'A ficha mudou durante o salvamento.');
      if (ficha.cnpj !== empresa.cnpj) await tx.atendimentoLead.updateMany({ where: { onboardingId: id }, data: {
        autorizacao: {}, representanteVerificadoEm: null, representanteVerificadoPor: null, evidenciaRepresentante: null,
      } });
      await tx.onboardingEvento.create({ data: { onboardingId: id, tipo: 'CADASTRO_COMERCIAL_SALVO', atorId: user.id, dados: {
        cnpj: empresa.cnpj, origem, fonte, fingerprint, anteriorFingerprint: anterior.cadastroCnpj?.fingerprint || null,
        versaoAnterior: body.versao, versao: body.versao + 1, derivadosDesatualizados: material,
      } } });
      return { ok: true, versao: body.versao + 1, cadastroCnpj, dados, cadastroRevisao: dados.cadastroRevisao };
    }, { isolationLevel: 'Serializable' });
  }
  async function consultar(id, user, body = {}) {
    exigirGestor(user);
    const ficha = await exigirEscopo(id, user, db);
    conferir(ficha, body);
    const cnpj = digitos(body.cnpj);
    if (!cnpjValido(cnpj)) throw erro('cnpj_invalido', 'Confira o CNPJ.', 400);
    let out;
    try { out = await consultarCnpj(cnpj); } catch { throw erro('consulta_indisponivel', 'Não foi possível consultar. Tente novamente ou preencha manualmente.', 503); }
    const em = agora();
    const normalizado = normalizarConsultaCadastral(out, cnpj, em);
    if (!normalizado) throw erro('consulta_indisponivel', 'A consulta não retornou dados válidos para este CNPJ. Preencha manualmente ou tente novamente.', 503);
    const b = out.bruto || {};
    const empresa = normalizarCadastroComercial({ ...normalizado, cep: b.cep, logradouro: b.logradouro, numero: b.numero, complemento: b.complemento, bairro: b.bairro }, cnpj);
    return persistir(id, user, body, empresa, 'CONSULTA', normalizado.fonte, { cnpj, consultadoEm: em.toISOString(), fingerprint: hash(empresa) });
  }
  async function salvar(id, user, body = {}) {
    exigirGestor(user);
    const ficha = await exigirEscopo(id, user, db);
    conferir(ficha, body);
    const cnpj = digitos(body.cnpj);
    if (body.origem === 'CONSULTA') {
      // Análises antigas guardam apenas um resumo. Não completar com dados do browser
      // e atribuir-lhes origem oficial. Reconsultar pelo método acima é explícito.
      const salvo = ficha.dados?.cadastroCnpj;
      if (body.analiseId || salvo?.origem !== 'CONSULTA' || salvo?.consulta?.cnpj !== cnpj || hash(salvo.empresa) !== salvo.consulta.fingerprint) throw erro('consulta_cadastral_necessaria', 'Consulte o CNPJ nesta etapa ou salve as alterações como preenchimento manual.');
      if (body.empresa && hash(normalizarCadastroComercial(body.empresa, cnpj)) !== salvo.fingerprint) throw erro('cadastro_editado', 'Salve os dados editados como preenchimento manual.');
      return persistir(id, user, body, salvo.empresa, 'CONSULTA', salvo.fonte, salvo.consulta);
    }
    if (body.origem !== 'MANUAL') throw erro('origem_invalida', 'Informe a origem do cadastro.', 400);
    const empresa = normalizarCadastroComercial(body.empresa, cnpj, { manual: true });
    return persistir(id, user, body, empresa, 'MANUAL', 'Preenchimento pelo contador');
  }
  return { salvar, consultar };
}
