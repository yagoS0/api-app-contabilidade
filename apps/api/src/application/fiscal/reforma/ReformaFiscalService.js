import { validarCadastroReforma, cadastroReformaVazio, resumirCadastroReforma, diaValido } from '@contabilidade/shared/reforma-cadastro';
import { verificarNfse, VERSAO_VERIFICADOR, ESCOPO_VERIFICADOR } from './verificarNfse.js';

const erro = (status, message) => Object.assign(new Error(message), { status });
// JSONB não preserva ordem de propriedades. Idempotência compara valores, não a ordem textual.
const canonico = v => JSON.stringify(v, function (k, valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor)
    ? Object.fromEntries(Object.keys(valor).sort().map(chave => [chave, valor[chave]])) : valor;
});
export function intervaloCompetencia(competencia) {
  if (typeof competencia !== 'string' || !/^\d{4}-\d{2}$/.test(competencia) || !diaValido(`${competencia}-01`)) throw erro(400, 'Informe uma competência válida (AAAA-MM).');
  const [ano, mes] = competencia.split('-').map(Number);
  return { gte: new Date(`${competencia}-01T00:00:00Z`), lt: new Date(Date.UTC(ano, mes, 1)) };
}
const whereNotas = (id, competencia) => ({ clientId: id, type: 'NFSE', OR: [{ competencia: intervaloCompetencia(competencia) }, { competencia: null }] });
export async function origemNotas(db, id, competencia) {
  const r = await db.portalInvoice.aggregate({ where: whereNotas(id, competencia), _count: { id: true }, _max: { updatedAt: true } });
  return { total: r._count.id, atualizadaEm: r._max.updatedAt?.toISOString() || null };
}
export async function cadastroAtual(db, id) {
  return db.reformaFiscalRevisao.findFirst({ where: { portalClientId: id }, orderBy: { versao: 'desc' } });
}
export async function salvarCadastroReforma(db, id, entrada, usuario) {
  if (!Number.isSafeInteger(entrada?.versao) || entrada.versao < 0) throw erro(400, 'Versão do cadastro inválida. Recarregue a página.');
  if (typeof entrada.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entrada.id)) throw erro(400, 'Identificador da revisão inválido.');
  const dados = validarCadastroReforma(entrada.dados);
  const repetida = await db.reformaFiscalRevisao.findFirst({ where: { id: entrada.id, portalClientId: id } });
  if (repetida) {
    if (canonico(repetida.dados) !== canonico(dados) || repetida.versao !== entrada.versao + 1) throw erro(409, 'Essa revisão já foi registrada com outro conteúdo. Recarregue o cadastro.');
    return repetida;
  }
  const atual = await cadastroAtual(db, id);
  if ((atual?.versao || 0) !== entrada.versao) throw erro(409, 'Outro usuário alterou o cadastro. Recarregue antes de salvar sua revisão.');
  try {
    return await db.reformaFiscalRevisao.create({ data: { id: entrada.id, portalClientId: id, versao: entrada.versao + 1, dados,
      createdBy: String(usuario.id), createdByName: String(usuario.name || usuario.id) } });
  } catch (e) {
    if (e.code !== 'P2002') throw e;
    const existente = await db.reformaFiscalRevisao.findFirst({ where: { id: entrada.id, portalClientId: id } });
    if (existente && existente.versao === entrada.versao + 1 && canonico(existente.dados) === canonico(dados)) return existente;
    throw erro(409, 'O cadastro mudou durante a gravação. Recarregue antes de salvar.');
  }
}
export function desatualizada(verificacao, cadastro, origem) {
  return Boolean(verificacao && (verificacao.cadastroVersao !== (cadastro?.versao || 0) || verificacao.versaoRegras !== VERSAO_VERIFICADOR || canonico(verificacao.origem) !== canonico(origem)));
}
export async function conferirNfse(db, id, competencia, usuario) {
  intervaloCompetencia(competencia);
  const [portal, cadastro, origem] = await Promise.all([
    db.portalClient.findUnique({ where: { id }, select: { cnpj: true, companyId: true } }), cadastroAtual(db, id), origemNotas(db, id, competencia),
  ]);
  if (!portal) throw erro(404, 'Empresa não encontrada.');
  // Limite explícito: lotes maiores não ganham um resultado integral fictício.
  const limite = 1000;
  const itens = [];
  for (let offset = 0; offset < Math.min(origem.total, limite); offset += 100) {
    const notas = await db.portalInvoice.findMany({ where: whereNotas(id, competencia), orderBy: { id: 'asc' }, skip: offset, take: Math.min(100, limite - offset),
      select: { id: true, numero: true, papel: true, status: true, statusEfetivo: true, competencia: true, xmlRaw: true, chaveAcesso: true, idDps: true } });
    const chaves = notas.filter(n => n.papel === 'EMIT').map(n => n.chaveAcesso).filter(Boolean);
    const dps = notas.filter(n => n.papel === 'EMIT').map(n => n.idDps).filter(Boolean);
    const emissoes = portal.companyId && (chaves.length || dps.length) ? await db.serviceInvoice.findMany({
      where: { companyId: portal.companyId, status: 'issued', OR: [{ chaveAcesso: { in: chaves } }, { idDps: { in: dps } }] },
      select: { chaveAcesso: true, idDps: true, configuracaoFiscal: true },
    }) : [];
    for (const nota of notas) {
      const candidatas = emissoes.filter(e => (nota.chaveAcesso && e.chaveAcesso === nota.chaveAcesso) || (nota.idDps && e.idDps === nota.idDps));
      itens.push(verificarNfse(nota, { cadastro: cadastro?.dados, cnpj: portal.cnpj, configuracaoFiscal: candidatas.length === 1 ? candidatas[0].configuracaoFiscal : null }));
    }
  }
  const [depois, cadastroDepois] = await Promise.all([origemNotas(db, id, competencia), cadastroAtual(db, id)]);
  if (canonico(depois) !== canonico(origem) || (cadastroDepois?.versao || 0) !== (cadastro?.versao || 0)) throw erro(409, 'As notas ou o cadastro mudaram durante a análise. Execute novamente a conferência.');
  const resumo = { total: origem.total, verificadas: itens.length, parcial: itens.length < origem.total,
    erros: 0, revisao: 0, alertas: 0, semAchados: 0, excluidas: 0 };
  const chaves = { ERRO: 'erros', REVISAO: 'revisao', ALERTA: 'alertas', SEM_ACHADOS: 'semAchados', EXCLUIDA: 'excluidas' };
  for (const item of itens) resumo[chaves[item.status]]++;
  return db.reformaNfseVerificacao.create({ data: { portalClientId: id, competencia, cadastroVersao: cadastro?.versao || 0,
    versaoRegras: VERSAO_VERIFICADOR, origem, resumo, itens, createdBy: String(usuario.id) } });
}
export async function lerConferencia(db, id, competencia) {
  intervaloCompetencia(competencia);
  const [verificacao, cadastro, origem] = await Promise.all([
    db.reformaNfseVerificacao.findFirst({ where: { portalClientId: id, competencia }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    cadastroAtual(db, id), origemNotas(db, id, competencia),
  ]);
  return { verificacao, desatualizada: desatualizada(verificacao, cadastro, origem), escopo: ESCOPO_VERIFICADOR };
}
export async function carteiraReforma(db, usuario, competencia) {
  intervaloCompetencia(competencia);
  const admin = String(usuario.role || '').toLowerCase() === 'admin';
  const ids = admin ? null : (await db.companyFirmAccess.findMany({ where: { userId: String(usuario.id), status: 'ACTIVE' }, select: { companyId: true } })).map(v => v.companyId);
  const empresas = await db.portalClient.findMany({ where: ids ? { id: { in: ids } } : {}, select: { id: true, razao: true, cnpj: true }, orderBy: { razao: 'asc' } });
  const empresasIds = empresas.map(e => e.id);
  const [cadastros, verificacoes] = await Promise.all([
    db.reformaFiscalRevisao.findMany({ where: { portalClientId: { in: empresasIds } }, orderBy: { versao: 'desc' }, distinct: ['portalClientId'] }),
    db.reformaNfseVerificacao.findMany({ where: { portalClientId: { in: empresasIds }, competencia }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], distinct: ['portalClientId'],
      select: { portalClientId: true, createdAt: true, cadastroVersao: true, versaoRegras: true, origem: true, resumo: true } }),
  ]);
  const linhas = [];
  // Cadência limitada ao banco local; nenhuma consulta fiscal externa ao abrir o painel.
  for (const empresa of empresas) {
    const cadastro = cadastros.find(c => c.portalClientId === empresa.id);
    const verificacao = verificacoes.find(v => v.portalClientId === empresa.id) || null;
    const origem = verificacao ? await origemNotas(db, empresa.id, competencia) : null;
    linhas.push({ ...empresa, ...resumirCadastroReforma(cadastro?.dados, `${competencia}-01`), versao: cadastro?.versao || 0,
      verificacao, desatualizada: desatualizada(verificacao, cadastro, origem) });
  }
  return { empresas: linhas, competencia, escopo: ESCOPO_VERIFICADOR };
}
export { cadastroReformaVazio };
