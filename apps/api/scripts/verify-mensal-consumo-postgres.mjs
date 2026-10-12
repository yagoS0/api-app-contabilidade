import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { vincularEstabelecimentos, salvarConfiguracaoConsumo } from '../src/application/fiscal/consumo/ApuracaoConsumoService.js';
import { lerMensalConsumo, executarAcaoMensalConsumo, listarHistoricoMensalConsumo } from '../src/application/fiscal/consumo/MensalConsumoService.js';

const [url, clientPath] = process.argv.slice(2), parsed = new URL(url);
if (parsed.hostname !== '127.0.0.1' || parsed.username !== 'coleta_cbs_test' || parsed.pathname !== '/coleta_cbs_check') throw Error('Somente banco descartável coleta_cbs_check.');
const { PrismaClient } = createRequire(import.meta.url)(path.join(clientPath, 'index.js'));
const db = new PrismaClient({ datasources: { db: { url } } });
const admin = { id: 'admin-mensal-teste', role: 'admin' };
const ctx = { tributo: 'CBS', ambiente: 'HOMOLOGACAO', competencia: '2027-01' };
const evidencia = { referencia: 'Pasta fictícia', sha256: 'a'.repeat(64), descricao: 'Somente teste isolado' };
const checks = [];
try {
  const empresa = await db.portalClient.create({ data: { razao: 'Livro local fictício', cnpj: '11222333000181' } });
  const grupo = await vincularEstabelecimentos(db, empresa.id, { portalClientIds: [empresa.id] }, admin);
  await salvarConfiguracaoConsumo(db, empresa.id, { id: randomUUID(), versao: 0, tributo: ctx.tributo, ambiente: ctx.ambiente, habilitado: true, dados: { motivo: 'Teste local' } }, admin);
  await db.reformaFiscalRevisao.create({ data: { id: randomUUID(), portalClientId: empresa.id, versao: 1, createdBy: admin.id, createdByName: 'Administrador de teste',
    dados: { periodos: [{ inicio: '2027-01-01', fim: null, regime: 'LUCRO_PRESUMIDO', forma: 'REGULAR', situacao: 'CONFIRMADA', evidencia: 'Teste' }] } } });
  let atual = await lerMensalConsumo(db, empresa.id, ctx, admin);
  assert.equal(atual.versao, 0);
  assert.equal(await db.apuracaoConsumoMesLocal.count({ where: { contribuinteId: grupo.id } }), 0);
  const comando = (acao, dados, patch = {}) => ({ ...ctx, id: randomUUID(), versao: atual.versao, acao, dados,
    ...(acao === 'REGISTRAR_BASE' ? { contextoHash: atual.contextoHash } : {}), ...patch });
  const executar = async entrada => { atual = await executarAcaoMensalConsumo(db, empresa.id, entrada, admin); return atual; };
  await assert.rejects(executar(comando('CONFERIR_LOCAL', { documentosConferidos: true, motivo: 'Teste', evidencia })), { status: 409 });
  const base = { valoresDeclarados: { debitosCentavos: '999999999999999999', creditosCentavos: '0' },
    tratamento: { tipo: 'REGULAR_PADRAO', evidencia },
    cobertura: { inicio: '2027-01-01', fim: '2027-01-31', estabelecimentoIds: [empresa.id], recursos: ['DEBITOS', 'CREDITOS'], evidencia }, pendencias: [] };
  await executar(comando('REGISTRAR_BASE', base));
  assert.equal(atual.dados.valoresDeclarados.debitosCentavos, '999999999999999999');
  await executar(comando('CONFERIR_LOCAL', { documentosConferidos: true, motivo: 'Conferência fictícia', evidencia }));
  assert.equal(atual.estado, 'CONFERIDA_LOCAL'); assert.equal(atual.valoresOficiais, null);
  checks.push('GET sem escrita; mês incompleto bloqueado; conferência humana separada de valores oficiais e decimais exatos');
  await executar(comando('REGISTRAR_GUIA', { referencia: 'GUIA-1', valorCentavos: '10000', vencimento: '2027-02-20', evidencia }));
  const guia = atual.dados.guias[0];
  const pagamentoIntent = comando('REGISTRAR_PAGAMENTO', { referencia: 'PAGAMENTO-1', valorCentavos: '7000', data: '2027-02-15', tipo: 'PAGAMENTO_MANUAL', evidencia });
  await executar(pagamentoIntent);
  const versao = atual.versao, pagamento = atual.dados.pagamentos[0];
  await executar(pagamentoIntent); assert.equal(atual.versao, versao); assert.equal(atual.dados.pagamentos.length, 1);
  await assert.rejects(executar({ ...pagamentoIntent, dados: { ...pagamentoIntent.dados, valorCentavos: '8000' } }), { status: 409 });
  await assert.rejects(executar(comando('REGISTRAR_PAGAMENTO', pagamentoIntent.dados, { competencia: '2027-02', versao: 0 })), { status: 409 });
  const concorrentes = await Promise.allSettled([1, 2].map(() => executarAcaoMensalConsumo(db, empresa.id, comando('ALOCAR', { guiaId: guia.id, pagamentoId: pagamento.id, valorCentavos: '6000' }), admin)));
  assert.equal(concorrentes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(concorrentes.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1);
  atual = await lerMensalConsumo(db, empresa.id, ctx, admin);
  assert.equal(atual.dados.pagamentos[0].saldoCentavos, '1000'); assert.equal(atual.dados.guias[0].saldoCentavos, '4000');
  assert.equal(atual.dados.guias[0].estadoLocal, 'PARCIAL_LOCALMENTE');
  await assert.rejects(executar(comando('ALOCAR', { guiaId: guia.id, pagamentoId: pagamento.id, valorCentavos: '1001' })), { status: 409 });
  await assert.rejects(executar(comando('CANCELAR_PAGAMENTO', { pagamentoId: pagamento.id, motivo: 'Teste', evidencia })), { status: 409 });
  checks.push('Intenção e referência repetidas recusadas; concorrência real impede sobrealocação e pagamento não vira confirmação fiscal');
  await executar(comando('ESTORNAR_ALOCACAO', { alocacaoId: atual.dados.alocacoes[0].id, motivo: 'Correção documentada', evidencia }));
  assert.equal(atual.dados.pagamentos[0].saldoCentavos, '7000');
  await executar(comando('CANCELAR_PAGAMENTO', { pagamentoId: pagamento.id, motivo: 'Correção', evidencia }));
  await assert.rejects(executar(comando('ALOCAR', { guiaId: guia.id, pagamentoId: pagamento.id, valorCentavos: '1' })), { status: 409 });
  const historico = await listarHistoricoMensalConsumo(db, empresa.id, ctx, admin);
  assert.equal(historico.historico.length, atual.versao);
  await assert.rejects(db.apuracaoConsumoMesLocal.update({ where: { id: atual.revisaoId }, data: { estado: 'EM_CONFERENCIA' } }));
  await assert.rejects(db.apuracaoConsumoMesLocal.delete({ where: { id: atual.revisaoId } }));
  await assert.rejects(db.apuracaoConsumoDocumentoLocal.delete({ where: { id: pagamento.id } }));
  await assert.rejects(lerMensalConsumo(db, empresa.id, ctx, { id: 'sem-acesso', role: 'STAFF' }), { status: 403 });
  assert.equal((await lerMensalConsumo(db, empresa.id, { ...ctx, ambiente: 'PRODUCAO' }, admin)).versao, 0);
  assert.equal((await lerMensalConsumo(db, empresa.id, { ...ctx, tributo: 'IBS' }, admin)).versao, 0);
  checks.push('Estorno preserva histórico; cancelamento exige saldo liberado; banco protege revisões/documentos; ambiente/tributo/permissão isolados');
  const baseAntesMudanca = comando('REGISTRAR_BASE', base);
  await salvarConfiguracaoConsumo(db, empresa.id, { id: randomUUID(), versao: 1, tributo: ctx.tributo, ambiente: ctx.ambiente, habilitado: false, dados: { motivo: 'Teste alteração' } }, admin);
  await assert.rejects(executar(baseAntesMudanca), { status: 409 });
  atual = await lerMensalConsumo(db, empresa.id, ctx, admin);
  assert.equal(atual.desatualizada, true); assert.equal(atual.estado, 'EM_CONFERENCIA'); assert.equal(atual.podeConferir, false);
  checks.push('Mudança posterior de configuração invalida conferência derivada e recusa base do formulário antigo sem alterar histórico');
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally { await db.$disconnect(); }
