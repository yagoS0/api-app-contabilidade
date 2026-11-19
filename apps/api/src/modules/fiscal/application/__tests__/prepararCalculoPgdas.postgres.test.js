import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { prepararCalculoPgdas } from '../prepararCalculoPgdas.js';
import { prepararFs12ParaNovoCalculo, vincularFs12AoCalculo, consultarVinculoFs12DoCalculo } from '../vincularFs12AoCalculo.js';
import { confirmarFs12DaApuracao } from '../confirmarFs12DaApuracao.js';
import { consultarFs12DaApuracao } from '../consultarFs12DaApuracao.js';
import { criarPersistenciaFs12 } from '../../infrastructure/prisma/fs12DaApuracao.js';
import { criarPersistenciaFs12DoCalculo } from '../../infrastructure/prisma/fs12DoCalculo.js';
import { planejarRemessaFs12 } from '../../domain/planejarRemessaFs12.js';
import { classificarResultadoPgdas } from '../../domain/resultadoPgdas.js';
import { hashCalculo, validarCalculoConfirmado } from '../../../../application/notas/apuracao/v2/CalculoConfirmado.js';
import { buildDeclaracaoPayload, parseRetornoSimulacao, PgdasSimulacaoService } from '../../../../application/fiscal/serpro/PgdasSimulacaoService.js';

// Este harness não é importado pela aplicação. Não cria transporte HTTP, credenciais
// ou fatos oficiais. A seleção inteira abaixo é SINTÉTICA, não homologação SERPRO.
const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
let db; let outra;
const b32 = (client = db, tx) => criarPersistenciaFs12DoCalculo({ db: client, tx, validarSnapshot: validarCalculoConfirmado });
const copia = value => JSON.parse(JSON.stringify(value));
async function fixture() {
  const id = randomUUID(); const cnpj = BigInt(`0x${id.replaceAll('-', '').slice(0, 11)}`).toString().padStart(14, '0');
  const client = await db.client.create({ data: { name: 'SYNTHETIC PGDAS FLOW', login: id, email: `${id}@example.test`, passwordHash: 'not-a-login' } });
  const company = await db.company.create({ data: { clientId: client.id, razaoSocial: 'SYNTHETIC PGDAS FLOW', cnpj, atividades: [], dataAbertura: new Date('2020-01-01T00:00:00Z') } });
  const portal = await db.portalClient.create({ data: { companyId: company.id, razao: company.razaoSocial, cnpj } });
  const user = await db.user.create({ data: { name: 'Synthetic accountant', email: `${randomUUID()}@example.test`, passwordHash: 'not-a-login', role: 'contador', accountType: 'FIRM', status: 'active' } });
  await db.companyFirmAccess.create({ data: { companyId: portal.id, userId: user.id, role: 'ACCOUNTANT', status: 'ACTIVE' } });
  await db.regimeHistorico.create({ data: { companyId: company.id, regime: 'SIMPLES', vigenciaInicio: new Date('2020-01-01T00:00:00Z') } });
  const identidade = { portalClientId: portal.id, competencia: '2026-11', autorId: user.id };
  const consulta = await consultarFs12DaApuracao(identidade, criarPersistenciaFs12(db));
  const serie = consulta.politica.janela.competencias.map((mes, index) => ({ mes, valorCentavos: index === 0 ? 0 : 12345 }));
  const revisao = (await confirmarFs12DaApuracao({ ...identidade, serie, contextoRevisao: consulta.contextoRevisao,
    revisaoEsperada: 0, chaveIdempotencia: randomUUID() }, criarPersistenciaFs12(db))).confirmacao;
  const parametros = { ...identidade, companyId: company.id, contribuinteCnpj: cnpj, contratanteCnpj: '00000000000200',
    regimeApuracao: 'COMPETENCIA', atividades: [{ idAtividade: 1, valorInterno: 1000 }], receitasBrutasAnteriores: [] };
  const entrada = { ...identidade, revisaoEsperada: revisao.revisao, contextoHash: revisao.contextoRevisao };
  const portas = {
    prepararFs12: args => prepararFs12ParaNovoCalculo(args, b32()),
    planejarRemessa: async ({ prova }) => ({ versaoPolitica: 'SINTETICA_NAO_HOMOLOGADA', mesesPropostos: prova.serie.map(m => m.mes), impedimentos: [] }),
    lerParametrosCalculo: async () => parametros, construirPayload: buildDeclaracaoPayload,
  };
  return { company, portal, user, identidade, entrada, revisao, serie, parametros, portas };
}
async function confirmarNova(f, client = outra) {
  return confirmarFs12DaApuracao({ ...f.identidade, serie: f.serie.map(m => ({ ...m, valorCentavos: m.valorCentavos + 1 })),
    contextoRevisao: f.revisao.contextoRevisao, revisaoEsperada: 1, chaveIdempotencia: randomUUID(), motivo: 'Synthetic replacement' }, criarPersistenciaFs12(client));
}
function calculoIdentificado(f, preparado, retorno) {
  const dados = { portalClientId: f.portal.id, competencia: f.identidade.competencia,
    contribuinteCnpj: f.company.cnpj, contratanteCnpj: f.parametros.contratanteCnpj,
    formulario: { atividades: f.parametros.atividades, folhaMensal12: preparado.prova.serie.map(m => m.valorCentavos / 100), regimeApuracao: 'COMPETENCIA' },
    receitasBrutasAnteriores: [], folhasSalario: preparado.folhasSalario,
    fs12: { revisaoId: preparado.prova.revisaoFs12Id, revisao: preparado.prova.revisaoFs12,
      contextoHash: preparado.prova.contextoHash, politicaVersao: preparado.prova.politicaVersao },
    origemEnsaio: 'SINTETICA_SEM_VALIDADE_FISCAL', resultadoSimulado: parseRetornoSimulacao(retorno).dasValor };
  return { ...dados, calculoId: `fech:v1:${randomUUID()}:${hashCalculo(dados)}` };
}
async function persistirEnsaio(f, calculo, client = db, falhar = false) {
  return client.$transaction(async tx => {
    const existing = await tx.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: {
      portalClientId: f.portal.id, competencia: f.identidade.competencia,
    } } });
    if (!existing) await tx.apuracaoSnapshot.create({ data: { portalClientId: f.portal.id, competencia: f.identidade.competencia,
      rbt12: 0, receitaPorTipo: {}, atividadesEscolhidas: calculo.formulario.atividades,
      folhaMensal12: calculo.formulario.folhaMensal12, simulacaoSerpro: { _portalCalculo: calculo, origem: 'SINTETICA_SEM_VALIDADE_FISCAL' },
      estado: 'calculada', idempotencyKey: calculo.calculoId } });
    const result = await vincularFs12AoCalculo({ ...f.entrada, calculoId: calculo.calculoId }, b32(client, tx));
    if (falhar) throw Error('SYNTHETIC_FAILURE_AFTER_LINK');
    return result;
  }, { isolationLevel: 'Serializable' });
}
const retornoSintetico = { status: 200, dados: JSON.stringify([{ idDeclaracao: 'SIMULACAO-FICTICIA', valoresDevidos: [{ codigoTributo: 1010, valor: 60 }] }]) };
async function simular(f, preparado, transporte) {
  // Só um callback local. A classe produtiva continua bloqueando PA11/12.
  const retorno = await transporte(preparado.payload);
  expect(classificarResultadoPgdas(retorno, { ...f.parametros, indicadorTransmissao: false })).toMatchObject({ estado: 'SIMULACAO_CONCLUIDA', confirmada: false });
  return calculoIdentificado(f, preparado, retorno);
}

suite('FS12 B31/B32 → payload sintético → cálculo/vínculo, PostgreSQL16 descartável', () => {
  beforeAll(async () => {
    const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL; const url = new URL(raw);
    if (process.env.NODE_ENV !== 'test' || raw !== process.env.DATABASE_URL || url.hostname !== '127.0.0.1'
      || !['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/altan_piloto_governance_test' || url.search || url.hash) throw Error('Explicit disposable database required');
    db = new PrismaClient({ datasources: { db: { url: raw } } }); outra = new PrismaClient({ datasources: { db: { url: raw } } });
    await db.$connect(); await outra.$connect();
    const [server] = await db.$queryRaw`SELECT current_setting('server_version_num')::int AS version`;
    if (server.version < 160000 || server.version >= 170000) throw Error('PostgreSQL16 required');
  });
  afterAll(async () => { await db?.$disconnect(); await outra?.$disconnect(); });

  test('FS12 confirmada sem Fator R, zero explícito, simulação e vínculo imutável não comprovam transmissão', async () => {
    const f = await fixture(); const preparado = await prepararCalculoPgdas(f.entrada, f.portas);
    const transporte = jest.fn(async () => retornoSintetico); const calculo = await simular(f, preparado, transporte);
    expect(preparado.payload.declaracao.folhasSalario).toEqual(f.serie.map(m => ({ pa: Number(m.mes.replace('-', '')), valor: m.valorCentavos / 100 })));
    expect(preparado.payload.indicadorTransmissao).toBe(false);
    const result = await persistirEnsaio(f, calculo);
    expect(result.vinculo.calculoConfirmado.fs12.revisaoId).toBe(f.revisao.id);
    expect((await persistirEnsaio(f, calculo)).replay).toBe(true);
    expect(transporte).toHaveBeenCalledTimes(1);
    expect(await db.apuracaoFs12CalculoFato.count({ where: { vinculoId: result.vinculo.id } })).toBe(0);
    const snapshot = await db.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: f.portal.id, competencia: '2026-11' } } });
    expect(snapshot).toMatchObject({ estado: 'calculada', numeroDeclaracao: null, transmitidoEm: null });
    await db.apuracaoSnapshot.update({ where: { id: snapshot.id }, data: { estado: 'aberta', idempotencyKey: `reaberta:${randomUUID()}` } });
    expect((await consultarVinculoFs12DoCalculo({ ...f.identidade, calculoId: calculo.calculoId }, b32())).id).toBe(result.vinculo.id);
  });

  test('política real lê revisão completa mas mantém payload null e transporte produtivo bloqueado', async () => {
    const f = await fixture();
    f.portas.planejarRemessa = async () => planejarRemessaFs12({
      identidade: { portalClientId: f.portal.id, companyId: f.company.id, competencia: '2026-11', cnpj: f.company.cnpj, dataAbertura: '2020-01-01' },
      // Origem é comprovada pelo produtor B31/tabela dedicada, não por campo do navegador.
      contexto: f.revisao.contexto, revisaoManual: { ...copia(f.revisao), origem: 'MANUAL_APURACAO' },
      revisaoVigente: copia(f.revisao), calculoExistente: null,
      historicoOficial: { portalClientId: f.portal.id, companyId: f.company.id, competencia: '2026-11', cnpj: f.company.cnpj, estado: 'DESCONHECIDA', meses: [] },
    });
    expect(await prepararCalculoPgdas(f.entrada, f.portas)).toMatchObject({ estado: 'BLOQUEADO', payload: null,
      planejamento: { mesesPropostos: null, fontes: { revisaoManual: { id: f.revisao.id } } } });
    const transmitirDeclaracao = jest.fn();
    await expect(new PgdasSimulacaoService({ pgdasService: { transmitirDeclaracao } }).simular(f.parametros)).rejects.toMatchObject({ code: 'FS12_INTEGRACAO_B33_PENDENTE' });
    expect(transmitirDeclaracao).not.toHaveBeenCalled();
    expect(await db.apuracaoSnapshot.count({ where: { portalClientId: f.portal.id } })).toBe(0);
  });

  test('mudança da confirmação durante preparo e acesso a outra empresa bloqueiam antes de simular', async () => {
    const f = await fixture(); const g = await fixture();
    await expect(prepararCalculoPgdas({ ...f.entrada, portalClientId: g.portal.id }, f.portas)).rejects.toMatchObject({ status: 403 });
    const original = f.portas.lerParametrosCalculo;
    f.portas.lerParametrosCalculo = async () => { await confirmarNova(f); return original(); };
    await expect(prepararCalculoPgdas(f.entrada, f.portas)).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' });
    expect(await db.apuracaoSnapshot.count({ where: { portalClientId: f.portal.id } })).toBe(0);
  });

  test('resposta tardia após nova revisão não grava snapshot nem vínculo', async () => {
    const f = await fixture(); const preparado = await prepararCalculoPgdas(f.entrada, f.portas);
    const transporte = jest.fn(async () => { await confirmarNova(f); return retornoSintetico; });
    const calculo = await simular(f, preparado, transporte);
    await expect(persistirEnsaio(f, calculo)).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' });
    expect(await db.apuracaoSnapshot.count({ where: { portalClientId: f.portal.id } })).toBe(0);
    expect(await db.apuracaoFs12Calculo.count({ where: { portalClientId: f.portal.id } })).toBe(0);
    expect(transporte).toHaveBeenCalledTimes(1);
  });

  test('rollback após vínculo e revogação de autorização preservam ausência de efeitos parciais', async () => {
    const f = await fixture(); const preparado = await prepararCalculoPgdas(f.entrada, f.portas);
    const calculo = await simular(f, preparado, async () => retornoSintetico);
    await expect(persistirEnsaio(f, calculo, db, true)).rejects.toThrow('SYNTHETIC_FAILURE_AFTER_LINK');
    expect(await db.apuracaoSnapshot.count({ where: { portalClientId: f.portal.id } })).toBe(0);
    expect(await db.apuracaoFs12Calculo.count({ where: { portalClientId: f.portal.id } })).toBe(0);
    await outra.companyFirmAccess.update({ where: { companyId_userId: { companyId: f.portal.id, userId: f.user.id } }, data: { status: 'REVOKED' } });
    await expect(persistirEnsaio(f, calculo)).rejects.toMatchObject({ status: 403 });
    expect(await db.apuracaoSnapshot.count({ where: { portalClientId: f.portal.id } })).toBe(0);
  });

  test('duas conexões não duplicam vínculo e timeout falso não é repetido', async () => {
    const f = await fixture(); const preparado = await prepararCalculoPgdas(f.entrada, f.portas);
    const timeout = jest.fn(async () => { throw Object.assign(Error('SYNTHETIC_TIMEOUT'), { code: 'ETIMEDOUT' }); });
    await expect(simular(f, preparado, timeout)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(timeout).toHaveBeenCalledTimes(1);
    const calculo = await simular(f, preparado, async () => retornoSintetico);
    const results = await Promise.allSettled([persistirEnsaio(f, calculo), persistirEnsaio(f, calculo, outra)]);
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    expect(await db.apuracaoFs12Calculo.count({ where: { portalClientId: f.portal.id } })).toBe(1);
    expect((await persistirEnsaio(f, calculo)).replay).toBe(true);
  });
});
