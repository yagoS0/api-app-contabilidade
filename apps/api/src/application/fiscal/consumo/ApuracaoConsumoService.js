import { createHash } from 'node:crypto';
import { periodoNaData } from '@contabilidade/shared/reforma-cadastro';
import { normalizarDocumento, cnpjTemDvValido } from '@contabilidade/shared/documentos-fiscais';
import { intervaloCompetencia } from '../reforma/ReformaFiscalService.js';
import { obterCapacidadesIbs } from '../../../infrastructure/ibs/IbsCapacidades.js';

const erro = (status, message) => Object.assign(new Error(message), { status });
const pesos = { STAFF: 1, ACCOUNTANT: 2, FIRM_ADMIN: 3 };
const canonico = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = value => createHash('sha256').update(canonico(value)).digest('hex');
const capacidades = Object.freeze({ coletar: false, conferir: false, confirmarOficial: false, emitirGuia: false, consultarPagamento: false });

function objeto(value, campos) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !campos.includes(k))) {
    throw erro(400, 'Campos inválidos para a preparação da apuração.');
  }
}
function texto(value, max, obrigatorio = false) {
  if (value == null && !obrigatorio) return '';
  if (typeof value !== 'string' || value.length > max || (obrigatorio && !value.trim())) throw erro(400, 'Texto obrigatório ausente ou inválido.');
  return value.trim();
}
function contexto(entrada, comCompetencia = false) {
  if (!['CBS', 'IBS'].includes(entrada?.tributo) || !['HOMOLOGACAO', 'PRODUCAO'].includes(entrada?.ambiente)) {
    throw erro(400, 'Informe o tributo e o ambiente explicitamente.');
  }
  const r = { tributo: entrada.tributo, ambiente: entrada.ambiente };
  if (comCompetencia) { intervaloCompetencia(entrada.competencia); r.competencia = entrada.competencia; }
  return r;
}
function intencao(entrada) {
  if (typeof entrada.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entrada.id)) throw erro(400, 'Identificador de intenção inválido.');
  if (!Number.isSafeInteger(entrada.versao) || entrada.versao < 0) throw erro(400, 'Versão inválida. Recarregue os dados.');
}
function baseCnpj(cnpj) {
  const normalizado = normalizarDocumento(cnpj);
  if (!cnpjTemDvValido(normalizado)) throw erro(400, 'O estabelecimento precisa de CNPJ com formato e dígitos verificadores válidos no cadastro.');
  return normalizado.slice(0, 8);
}

// Toda leitura/escrita do grupo exige acesso a TODOS os estabelecimentos vinculados.
// O administrador global mantém o contrato existente do ALTAN; isto não cria um novo tenant.
async function autorizar(db, ids, usuario, escrita = false) {
  if (!usuario?.id) throw erro(401, 'Autenticação necessária.');
  if (String(usuario.role).toLowerCase() === 'admin') return true;
  const vinculos = await db.companyFirmAccess.findMany({ where: { companyId: { in: ids }, userId: String(usuario.id), status: 'ACTIVE' }, select: { companyId: true, role: true } });
  const minimo = escrita ? 2 : 1;
  if (ids.some(id => !vinculos.some(v => v.companyId === id && (pesos[v.role] || 0) >= minimo))) throw erro(403, 'Acesso insuficiente aos estabelecimentos desta apuração.');
  return ids.every(id => vinculos.some(v => v.companyId === id && (pesos[v.role] || 0) >= 2));
}
async function empresa(db, id) {
  const r = await db.portalClient.findUnique({ where: { id }, select: { id: true, cnpj: true, razao: true } });
  if (!r) throw erro(404, 'Empresa não encontrada.');
  return r;
}
export async function carregarGrupo(db, companyId, usuario, escrita = false) {
  await autorizar(db, [companyId], usuario, escrita);
  await empresa(db, companyId);
  const vinculo = await db.apuracaoConsumoEstabelecimento.findUnique({ where: { portalClientId: companyId } });
  if (!vinculo) return null;
  const grupo = await db.apuracaoConsumoContribuinte.findUnique({ where: { id: vinculo.contribuinteId } });
  const vinculos = await db.apuracaoConsumoEstabelecimento.findMany({ where: { contribuinteId: grupo.id }, orderBy: { portalClientId: 'asc' } });
  const ids = vinculos.map(v => v.portalClientId);
  const podeEditar = await autorizar(db, ids, usuario, escrita);
  const estabelecimentos = await db.portalClient.findMany({ where: { id: { in: ids } }, select: { id: true, cnpj: true, razao: true }, orderBy: { id: 'asc' } });
  if (estabelecimentos.length !== ids.length || estabelecimentos.some(e => baseCnpj(e.cnpj) !== grupo.cnpjBase)) throw erro(409, 'O cadastro dos estabelecimentos mudou. Revise os vínculos antes de continuar.');
  return { ...grupo, estabelecimentos, podeEditar };
}
export async function transacao(db, fn) {
  try { return await db.$transaction(fn, { isolationLevel: 'Serializable' }); }
  catch (e) {
    if (['P2002', 'P2034'].includes(e.code)) throw erro(409, 'Os dados mudaram durante a gravação. Recarregue e confira a intenção antes de repetir.');
    throw e;
  }
}

export async function vincularEstabelecimentos(db, companyId, entrada, usuario) {
  objeto(entrada, ['portalClientIds']);
  if (!Array.isArray(entrada.portalClientIds) || !entrada.portalClientIds.length || entrada.portalClientIds.length > 100
    || entrada.portalClientIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 100)) throw erro(400, 'Informe de 1 a 100 estabelecimentos.');
  const ids = [...new Set([companyId, ...entrada.portalClientIds])].sort();
  return transacao(db, async tx => {
    await autorizar(tx, ids, usuario, true);
    const empresas = await Promise.all(ids.map(id => empresa(tx, id)));
    const cnpjBase = baseCnpj(empresas[0].cnpj);
    if (empresas.some(e => baseCnpj(e.cnpj) !== cnpjBase)) throw erro(400, 'Os estabelecimentos devem pertencer ao mesmo CNPJ-base.');
    let grupo = await tx.apuracaoConsumoContribuinte.findUnique({ where: { cnpjBase } });
    if (grupo) {
      const anteriores = await tx.apuracaoConsumoEstabelecimento.findMany({ where: { contribuinteId: grupo.id } });
      await autorizar(tx, [...new Set([...ids, ...anteriores.map(v => v.portalClientId)])], usuario, true);
    } else grupo = await tx.apuracaoConsumoContribuinte.create({ data: { cnpjBase, criadoPorId: String(usuario.id) } });
    for (const portalClientId of ids) {
      const atual = await tx.apuracaoConsumoEstabelecimento.findUnique({ where: { portalClientId } });
      if (atual && atual.contribuinteId !== grupo.id) throw erro(409, 'Um estabelecimento já pertence a outro contribuinte.');
      if (!atual) await tx.apuracaoConsumoEstabelecimento.create({ data: { contribuinteId: grupo.id, portalClientId, criadoPorId: String(usuario.id) } });
    }
    return carregarGrupo(tx, companyId, usuario, true);
  });
}

export async function ultimaConfiguracao(db, contribuinteId, ctx) {
  return db.apuracaoConsumoConfiguracao.findFirst({ where: { contribuinteId, tributo: ctx.tributo, ambiente: ctx.ambiente }, orderBy: { versao: 'desc' } });
}
export async function disponibilidadeCredencial(db, configuracao) {
  const { credencialId, credencialPortalClientId } = configuracao?.dados || {};
  if (!credencialId) return null;
  return Boolean(await db.companyCredential.findFirst({ where: { id: credencialId, portalClientId: credencialPortalClientId }, select: { id: true } }));
}
async function repetir(dbModel, contribuinteId, requestKey, requestHash) {
  const anterior = await dbModel.findFirst({ where: { contribuinteId, requestKey } });
  if (anterior && anterior.requestHash !== requestHash) throw erro(409, 'Esta intenção já foi usada com outro conteúdo.');
  return anterior;
}
function exigirGrupo(grupo) { if (!grupo) throw erro(409, 'Vincule explicitamente os estabelecimentos antes de preparar a apuração.'); }

export async function salvarConfiguracaoConsumo(db, companyId, entrada, usuario) {
  objeto(entrada, ['id', 'versao', 'tributo', 'ambiente', 'habilitado', 'dados']);
  intencao(entrada); const ctx = contexto(entrada);
  if (typeof entrada.habilitado !== 'boolean') throw erro(400, 'Informe a preparação local explicitamente.');
  objeto(entrada.dados, ['motivo', 'referenciaContrato', 'credencialId', 'credencialPortalClientId']);
  const dados = { motivo: texto(entrada.dados.motivo, 1500, true), referenciaContrato: texto(entrada.dados.referenciaContrato, 500),
    credencialId: texto(entrada.dados.credencialId, 100), credencialPortalClientId: texto(entrada.dados.credencialPortalClientId, 100) };
  if (Boolean(dados.credencialId) !== Boolean(dados.credencialPortalClientId)) throw erro(400, 'Informe a credencial e seu estabelecimento em conjunto.');
  const requestHash = hash({ ...ctx, versao: entrada.versao, habilitado: entrada.habilitado, dados });
  return transacao(db, async tx => {
    const grupo = await carregarGrupo(tx, companyId, usuario, true); exigirGrupo(grupo);
    const anterior = await repetir(tx.apuracaoConsumoConfiguracao, grupo.id, entrada.id, requestHash);
    if (anterior) return anterior;
    const atual = await ultimaConfiguracao(tx, grupo.id, ctx);
    if ((atual?.versao || 0) !== entrada.versao) throw erro(409, 'A configuração foi alterada. Recarregue antes de salvar.');
    if (dados.credencialId) {
      if (!grupo.estabelecimentos.some(e => e.id === dados.credencialPortalClientId)) throw erro(403, 'Credencial fora dos estabelecimentos autorizados.');
      const credencial = await tx.companyCredential.findFirst({ where: { id: dados.credencialId, portalClientId: dados.credencialPortalClientId }, select: { id: true } });
      if (!credencial) throw erro(400, 'Referência de credencial inválida.');
    }
    return tx.apuracaoConsumoConfiguracao.create({ data: { contribuinteId: grupo.id, ...ctx, versao: entrada.versao + 1,
      habilitado: entrada.habilitado, dados, requestKey: entrada.id, requestHash, criadoPorId: String(usuario.id) } });
  });
}

export async function enquadramentos(db, grupo, competencia) {
  const intervalo = intervaloCompetencia(competencia);
  const inicio = `${competencia}-01`, fim = new Date(intervalo.lt.getTime() - 86400000).toISOString().slice(0, 10);
  const snapshots = [];
  for (const estabelecimento of grupo.estabelecimentos) {
    const cadastro = await db.reformaFiscalRevisao.findFirst({ where: { portalClientId: estabelecimento.id }, orderBy: { versao: 'desc' } });
    const periodo = periodoNaData(cadastro?.dados, inicio);
    const cobreMes = Boolean(periodo && (!periodo.fim || periodo.fim >= fim));
    snapshots.push({ portalClientId: estabelecimento.id, cnpj: estabelecimento.cnpj, cadastroId: cadastro?.id || null,
      cadastroVersao: cadastro?.versao || 0, periodo: periodo || null, cobreMes,
      regularConfirmado: cobreMes && periodo.situacao === 'CONFIRMADA' && periodo.forma === 'REGULAR' });
  }
  return snapshots;
}

export async function prepararRevisaoConsumo(db, companyId, entrada, usuario) {
  objeto(entrada, ['id', 'versao', 'tributo', 'ambiente', 'competencia', 'motivo']);
  intencao(entrada); const ctx = contexto(entrada, true), motivo = texto(entrada.motivo, 1500, true);
  const requestHash = hash({ ...ctx, versao: entrada.versao, motivo });
  return transacao(db, async tx => {
    const grupo = await carregarGrupo(tx, companyId, usuario, true); exigirGrupo(grupo);
    const anterior = await repetir(tx.apuracaoConsumoRevisao, grupo.id, entrada.id, requestHash);
    if (anterior) return anterior;
    const atual = await tx.apuracaoConsumoRevisao.findFirst({ where: { contribuinteId: grupo.id, ...ctx }, orderBy: { versao: 'desc' } });
    if ((atual?.versao || 0) !== entrada.versao) throw erro(409, 'A revisão foi alterada. Recarregue antes de preparar outra.');
    const configuracao = await ultimaConfiguracao(tx, grupo.id, ctx);
    if (!configuracao) throw erro(409, 'Registre a configuração deste tributo e ambiente primeiro.');
    const cadastroSnapshot = await enquadramentos(tx, grupo, ctx.competencia);
    const credencialDisponivel = await disponibilidadeCredencial(tx, configuracao);
    const pendencias = ['COLETA_OFICIAL_NAO_IMPLEMENTADA'];
    if (!configuracao.habilitado) pendencias.push('PREPARACAO_LOCAL_DESABILITADA');
    if (!configuracao.dados.credencialId) pendencias.push('CREDENCIAL_NAO_REFERENCIADA');
    else if (!credencialDisponivel) pendencias.push('CREDENCIAL_REFERENCIADA_INDISPONIVEL');
    if (cadastroSnapshot.some(s => !s.regularConfirmado)) pendencias.push('ENQUADRAMENTO_REGULAR_NAO_CONFIRMADO_PARA_TODO_O_MES');
    const dados = { motivo, pendencias, credencialDisponivel, cobertura: 'NAO_COLETADA', valoresOficiais: null };
    return tx.apuracaoConsumoRevisao.create({ data: { contribuinteId: grupo.id, ...ctx, versao: entrada.versao + 1,
      estado: 'PREPARACAO', configuracaoId: configuracao.id, cadastroSnapshot, dados,
      requestKey: entrada.id, requestHash, criadoPorId: String(usuario.id) } });
  });
}

export async function lerBaseConsumo(db, companyId, entrada, usuario) {
  const ctx = contexto(entrada, true);
  const integracaoIbs = ctx.tributo === 'IBS' ? obterCapacidadesIbs(ctx) : null;
  return transacao(db, async tx => {
    // A própria existência de uma referência ao cofre requer ACCOUNTANT.
    const grupo = await carregarGrupo(tx, companyId, usuario, true);
    if (!grupo) return { contribuinte: null, configuracao: null, revisao: null, desatualizada: false,
      podeEditar: await autorizar(tx, [companyId], usuario), capacidades, integracaoIbs, ...ctx };
    const configuracao = await ultimaConfiguracao(tx, grupo.id, ctx);
    const revisao = await tx.apuracaoConsumoRevisao.findFirst({ where: { contribuinteId: grupo.id, ...ctx }, orderBy: { versao: 'desc' } });
    const cadastroAtual = await enquadramentos(tx, grupo, ctx.competencia);
    const credencialDisponivel = await disponibilidadeCredencial(tx, configuracao);
    return { contribuinte: grupo, configuracao, revisao, cadastroAtual, credencialDisponivel, integracaoIbs, ...ctx, podeEditar: grupo.podeEditar, capacidades,
      desatualizada: Boolean(revisao && (revisao.configuracaoId !== configuracao?.id || canonico(revisao.cadastroSnapshot) !== canonico(cadastroAtual)
        || revisao.dados.credencialDisponivel !== credencialDisponivel)) };
  });
}
