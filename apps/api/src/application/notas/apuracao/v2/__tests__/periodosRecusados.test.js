import { executarComRetomada, prepararRetomada, assinaturaSimulacao, assinaturasSimulacao } from '../PeriodosRecusadosService.js';
import { executarComAjusteDePeriodos } from '../FechamentoService.js';
import { PgdasSimulacaoService } from '../../../../fiscal/serpro/PgdasSimulacaoService.js';
import { SerproPgdasdService } from '../../../../fiscal/serpro/SerproPgdasdService.js';
import { chaveResposta } from '../../../../fiscal/serpro/SerproRespostaCache.js';
import { createHash } from 'node:crypto';

const params = {
  competencia: '2026-09', contratanteCnpj: '11111111000191', contribuinteCnpj: '22222222000191',
  atividades: [{ idAtividade: 11, valorInterno: 100 }],
  receitasBrutasAnteriores: ['2025-09', '2025-10', '2025-11', '2025-12'].map(pa => ({ pa, valorInterno: 10, valorExterno: 0 })),
  folhasSalario: [{ pa: '2025-09', valor: 5 }],
};
const ctx = { portalClientId: 'empresa1', competencia: params.competencia, ajustarPeriodos: executarComAjusteDePeriodos };
const mensagem = pa => `SN-Entregar: Foi enviada receita bruta de um período desnecessário: ${pa.slice(5)}/${pa.slice(0, 4)}. Remova este período e tente novamente.`;
const recusar = pa => Object.assign(new Error(mensagem(pa)), { code: 'SERPRO_BUSINESS_ERROR', status: 400 });
function banco() {
  const rows = new Map(); const ledger = new Map();
  return { rows, ledger, db: {
    apuracaoPeriodoRecusado: {
      findMany: jest.fn(async ({ where }) => [...rows.values()].filter(r => Object.entries(where).every(([k,v]) => r[k] === v))),
      upsert: jest.fn(async ({ create }) => { if (!rows.has(create.id)) rows.set(create.id, create); return rows.get(create.id); }),
    },
    serproChamada: { findFirst: jest.fn(async ({ where }) => {
      const row = where.assinatura.in.map(s => ledger.get(s)).find(Boolean);
      return row && row.portalClientId === where.portalClientId && row.cnpj === where.cnpj ? row : null;
    }) },
  } };
}

test('recusas ficam gravadas mesmo se uma falha técnica interromper; nova ação não reapresenta os mesmos períodos', async () => {
  const { db, rows } = banco();
  const erro = Object.assign(new Error('Rede indisponível'), { code: 'NETWORK_ERROR' });
  const executar = jest.fn(async p => {
    if (p.receitasBrutasAnteriores.length === 1) throw erro;
    throw recusar(p.receitasBrutasAnteriores[0].pa);
  });
  await expect(executarComRetomada(executar, params, { ...ctx, db })).rejects.toBe(erro);
  expect(executar).toHaveBeenCalledTimes(4); expect(rows.size).toBe(3);
  const sucesso = jest.fn(async () => ({ dasValor: 6 }));
  const resultado = await executarComRetomada(sucesso, params, { ...ctx, db });
  expect(sucesso.mock.calls[0][0].receitasBrutasAnteriores.map(r => r.pa)).toEqual(['2025-12']);
  expect(sucesso.mock.calls[0][0].folhasSalario).toEqual(params.folhasSalario);
  expect(resultado.periodosReaproveitados.receitas).toEqual(['2025-09', '2025-10', '2025-11']);
  expect(sucesso).toHaveBeenCalledTimes(1);
});

test('simulação conclui após mais de três recusas, cada payload distinto e persistido antes da próxima chamada', async () => {
  const { db, rows } = banco(); const assinaturas = [];
  const executar = jest.fn(async p => {
    expect(rows.size).toBe(assinaturas.length);
    assinaturas.push(await assinaturaSimulacao(p));
    if (p.receitasBrutasAnteriores.length) throw recusar(p.receitasBrutasAnteriores[0].pa);
    return { dasValor: 6 };
  });
  const out = await executarComRetomada(executar, params, { ...ctx, db });
  expect(out.resultado.dasValor).toBe(6);
  expect(executar).toHaveBeenCalledTimes(5);
  expect(new Set(assinaturas).size).toBe(5);
  expect(rows.size).toBe(4);
  expect(out.folhasAceitas).toEqual(params.folhasSalario);
});

test('erro de rede com texto semelhante a recusa não é repetido nem gravado', async () => {
  const { db, rows } = banco();
  const erro = Object.assign(new Error(mensagem('2025-09')), { code: 'NETWORK_ERROR' });
  const executar = jest.fn(async () => { throw erro; });
  await expect(executarComRetomada(executar, params, { ...ctx, db })).rejects.toBe(erro);
  expect(executar).toHaveBeenCalledTimes(1); expect(rows.size).toBe(0);
});

test('recusa de período já removido interrompe sem reenviar o mesmo payload', async () => {
  const { db, rows } = banco();
  const executar = jest.fn(async () => { throw recusar('2025-09'); });
  await expect(executarComRetomada(executar, params, { ...ctx, db })).rejects.toMatchObject({ code: 'SERPRO_BUSINESS_ERROR' });
  expect(executar).toHaveBeenCalledTimes(2); expect(rows.size).toBe(1);
});

test('limite da simulação continua finito mesmo com uma lista maior que a série mensal', async () => {
  const { db, rows } = banco();
  const receitasBrutasAnteriores = Array.from({ length: 26 }, (_, i) => ({ pa: new Date(Date.UTC(2023, i, 1)).toISOString().slice(0, 7), valorInterno: 10 }));
  const executar = jest.fn(async p => { throw recusar(p.receitasBrutasAnteriores[0].pa); });
  await expect(executarComRetomada(executar, { ...params, receitasBrutasAnteriores }, { ...ctx, db })).rejects.toMatchObject({ code: 'RECEITAS_ANTERIORES_NAO_CONVERGIU' });
  expect(executar).toHaveBeenCalledTimes(25); expect(rows.size).toBe(25);
});

test('caminho sem wrapper persistente mantém teto de três chamadas usado pela transmissão', async () => {
  const executar = jest.fn(async p => { throw recusar(p.receitasBrutasAnteriores[0].pa); });
  await expect(executarComAjusteDePeriodos(executar, params)).rejects.toMatchObject({ code: 'RECEITAS_ANTERIORES_NAO_CONVERGIU' });
  expect(executar).toHaveBeenCalledTimes(3);
});

test.each(['empresa', 'competencia', 'valor'])('recusas não atravessam alteração de %s', async tipo => {
  const { db } = banco();
  const preparado = await prepararRetomada(params, { ...ctx, db });
  await preparado.onPeriodoRemovido({ lista: 'receitas', pa: '2025-09' });
  const p = tipo === 'competencia' ? { ...params, competencia: '2026-10' } : tipo === 'valor' ? { ...params, atividades: [{ idAtividade: 11, valorInterno: 200 }] } : params;
  const out = await prepararRetomada(p, { ...ctx, db, competencia: p.competencia, portalClientId: tipo === 'empresa' ? 'outra' : ctx.portalClientId });
  expect(out.params.receitasBrutasAnteriores).toHaveLength(4);
});

test('falha no registro após recusa para antes da segunda chamada', async () => {
  const { db } = banco(); db.apuracaoPeriodoRecusado.upsert.mockRejectedValue(new Error('DB'));
  const executar = jest.fn(async () => { throw recusar('2025-09'); });
  await expect(executarComRetomada(executar, params, { ...ctx, db })).rejects.toMatchObject({ code: 'PERIODOS_RECUSADOS_REGISTRO_INDISPONIVEL' });
  expect(executar).toHaveBeenCalledTimes(1);
});

test('falha de leitura não autoriza chamada', async () => {
  const { db } = banco(); db.apuracaoPeriodoRecusado.findMany.mockRejectedValue(new Error('DB'));
  const executar = jest.fn();
  await expect(executarComRetomada(executar, params, { ...ctx, db })).rejects.toMatchObject({ code: 'PERIODOS_RECUSADOS_REGISTRO_INDISPONIVEL' });
  expect(executar).not.toHaveBeenCalled();
});

test('reconstitui cadeia histórica só com assinatura exata e pode inspecionar sem gravações', async () => {
  const { db, ledger } = banco();
  for (let i = 0; i < 3; i += 1) {
    const p = { ...params, receitasBrutasAnteriores: params.receitasBrutasAnteriores.slice(i) };
    ledger.set(await assinaturaSimulacao(p), { id: `l${i}`, portalClientId: ctx.portalClientId, cnpj: params.contribuinteCnpj,
      status: 'erro', httpStatus: 400, erroCodigo: 'SERPRO_BUSINESS_ERROR', erroMensagem: mensagem(p.receitasBrutasAnteriores[0].pa) });
  }
  const out = await prepararRetomada(params, { ...ctx, db, persist: false });
  expect(out.evidenciasLedger).toHaveLength(3);
  expect(out.params.receitasBrutasAnteriores.map(r => r.pa)).toEqual(['2025-12']);
  expect(db.apuracaoPeriodoRecusado.upsert).not.toHaveBeenCalled();
  const modificado = await prepararRetomada({ ...params, atividades: [{ idAtividade: 11, valorInterno: 101 }] }, { ...ctx, db, persist: false });
  expect(modificado.evidenciasLedger).toEqual([]);
});

test('transmissão nunca tem assinatura de simulação', async () => {
  // Mesmo que chamador acrescente a flag, a construção da evidência é sempre simulação.
  expect(await assinaturaSimulacao({ ...params, indicadorTransmissao: true })).toBe(await assinaturaSimulacao(params));
});

test('upsert idempotente preserva recusas concorrentes sem sobrescrever uma pela outra', async () => {
  const { db, rows } = banco();
  const a = await prepararRetomada(params, { ...ctx, db });
  const b = await prepararRetomada(params, { ...ctx, db });
  await Promise.all([a.onPeriodoRemovido({ lista: 'receitas', pa: '2025-09' }), b.onPeriodoRemovido({ lista: 'folhas', pa: '2025-09' }), a.onPeriodoRemovido({ lista: 'receitas', pa: '2025-09' })]);
  expect(rows.size).toBe(2);
});

test.each([{}, { regimeApuracao: 'COMPETENCIA', tipoDeclaracao: 1, valorFixo: { iss: 10 } }, { receitasBrutasAnteriores: [], folhasSalario: [] }])('assinaturas coincidem com envelope do simulador real, inclusive defaults: %j', extra => {
  return conferirEnvelope({ ...params, ...extra });
});

async function conferirEnvelope(p) {
  let envelope; let rota;
  const parada = new Error('TRANSPORTE_LOCAL');
  const pgdasService = new SerproPgdasdService({ client: { post: (r, payload) => { envelope = payload; rota = r; throw parada; } } });
  await expect(new PgdasSimulacaoService({ pgdasService }).simular(p)).rejects.toBe(parada);
  const legada = createHash('sha256').update(`${rota}|${JSON.stringify(envelope)}`).digest('hex');
  expect(await assinaturasSimulacao(p)).toEqual([chaveResposta(envelope, rota), legada]);
  expect(JSON.parse(envelope.pedidoDados.dados).indicadorTransmissao).toBe(false);
  const { db, ledger } = banco();
  ledger.set(legada, { id: 'antigo', portalClientId: ctx.portalClientId, cnpj: p.contribuinteCnpj,
    status: 'erro', httpStatus: 400, erroCodigo: 'SERPRO_BUSINESS_ERROR', erroMensagem: mensagem('2025-09') });
  const preparado = await prepararRetomada(p, { ...ctx, db, persist: false });
  expect(preparado.evidenciasLedger).toHaveLength(p.receitasBrutasAnteriores.length ? 1 : 0);
}
