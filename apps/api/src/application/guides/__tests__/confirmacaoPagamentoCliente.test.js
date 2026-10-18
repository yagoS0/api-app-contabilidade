import { registrarConfirmacaoTx, tentarBaixaConfirmacao, versaoPagamentoGuia, lerConfirmacaoPagamento,
  PREFIXO_CONFIRMACAO, PREFIXO_ESTADO, reconfirmacaoPagamentoTx } from '../ConfirmacaoPagamentoClienteService.js';

function fixture() {
  let rows = new Map();
  const guide = { id: 'g', portalClientId: 'c', tipo: 'SIMPLES', competencia: '2026-08', status: 'PROCESSED',
    liberadaCliente: true, hash: 'pdf-v1', valor: 115, extracted: { composicao: [{ principal: 100, juros: 10, multa: 5, total: 115 }] },
    paymentStatus: 'OPEN', baixada: false, clienteConfirmouEm: null, updatedAt: new Date('2026-09-01') };
  const tx = {
    user: { findUnique: jest.fn(async () => ({ role: "client", status: "active" })) },
    companyClientUser: { findUnique: jest.fn(async () => ({ status: "ACTIVE" })) },
    estornoBaixa: { findFirst: jest.fn(async()=>null) },
    accountingEntry: { findMany: jest.fn(async()=>[]) },
    appSetting: {
      findMany: jest.fn(async({where})=>[...rows].filter(([key])=>key.startsWith(where.key.startsWith)).map(([key,value])=>({key,value:structuredClone(value)}))),
      updateMany: jest.fn(async({where,data})=>{if(JSON.stringify(rows.get(where.key))!==JSON.stringify(where.value.equals))return{count:0};rows.set(where.key,structuredClone(data.value));return{count:1};}),
      findUnique: jest.fn(async ({ where }) => rows.has(where.key) ? { key: where.key, value: structuredClone(rows.get(where.key)) } : null),
      create: jest.fn(async ({ data }) => { if (rows.has(data.key)) throw Object.assign(Error('duplicate'), { code: 'P2002' }); rows.set(data.key, structuredClone(data.value)); return data; }),
      update: jest.fn(async ({ where, data }) => { rows.set(where.key, structuredClone(data.value)); return data; }),
    },
    guide: {
      findFirst: jest.fn(async ({ where }) => where.id === guide.id && where.portalClientId === guide.portalClientId ? { ...guide } : null),
      updateMany: jest.fn(async ({ data }) => { Object.assign(guide, data); return { count: 1 }; }),
    },
  };
  const db = { ...tx, $transaction: jest.fn(async fn => {
    const beforeRows = structuredClone(rows), beforeGuide = structuredClone(guide);
    try { return await fn(tx); } catch (e) { rows = beforeRows; Object.assign(guide, beforeGuide); throw e; }
  }) };
  const args = { companyId: 'c', guideId: 'g', pagoEm: '2026-09-10', canal: 'PORTAL', autor: { userId: 'u' },
    eventId: 'click-1', expectedVersion: versaoPagamentoGuia(guide), agora: new Date('2026-09-11') };
  const register = () => db.$transaction(t => registrarConfirmacaoTx(t, args));
  return { db, tx, guide, args, register, rows: () => rows };
}

test('declaração autenticada é imutável, preserva valores, origem e duas datas', async () => {
  const f = fixture(), r = await f.register();
  expect(f.guide).toMatchObject({ paymentStatus: 'PAID', paymentStatusSource: 'CLIENTE', paymentConfirmedAt: new Date('2026-09-10') });
  const evidence = f.rows().get(`${PREFIXO_CONFIRMACAO}c:${r.confirmacaoId}`);
  expect(evidence).toMatchObject({ autor: { userId: 'u' }, documento: { valor: '115', hash: 'pdf-v1' }, pagoEm: '2026-09-10T00:00:00.000Z' });
  const baixa = jest.fn(async () => { f.guide.baixada = true; f.guide.lancamentoId = 'b1'; return { entryIds: ['b1', 'b2', 'b3'], principal: 100, juros: 10, multa: 5 }; });
  const resultado = await tentarBaixaConfirmacao({ companyId: 'c', confirmacaoId: r.confirmacaoId }, f.db, baixa);
  expect(resultado.confirmacao).toMatchObject({ estadoBaixa: 'CONCLUIDA', entryIds: ['b1', 'b2', 'b3'] });
  expect(f.rows().get(`${PREFIXO_CONFIRMACAO}c:${r.confirmacaoId}`)).toEqual(evidence);
  await tentarBaixaConfirmacao({ companyId: 'c', confirmacaoId: r.confirmacaoId }, f.db, baixa);
  expect(baixa).toHaveBeenCalledTimes(1);
  expect((await f.register()).repetida).toBe(true);
});

test.each(['MES_FECHADO', 'CONTAS_AUSENTES', 'COMPOSICAO_A_CONFERIR'])('pendência %s conserva confirmação e permite retomada', async motivo => {
  const f = fixture(), r = await f.register();
  const baixa = jest.fn().mockRejectedValueOnce(Object.assign(Error('pendência'), { pendencia: motivo })).mockImplementation(async () => { f.guide.baixada = true; f.guide.lancamentoId = 'b'; return { entryIds: ['b'] }; });
  const input = { companyId: 'c', confirmacaoId: r.confirmacaoId };
  expect((await tentarBaixaConfirmacao(input, f.db, baixa)).confirmacao).toMatchObject({ estadoBaixa: 'PENDENTE', motivo });
  expect(f.guide.paymentStatus).toBe('PAID');
  expect((await tentarBaixaConfirmacao(input, f.db, baixa)).confirmacao.estadoBaixa).toBe('CONCLUIDA');
});

test('reentrega com mesma pendência preserva evento/revisão; mudança de motivo é auditada', async () => {
  const f = fixture(), r = await f.register();
  const input = { companyId: 'c', confirmacaoId: r.confirmacaoId };
  const baixa = jest.fn().mockRejectedValue(Object.assign(Error('pendência'), { pendencia: 'MES_FECHADO' }));
  await tentarBaixaConfirmacao(input, f.db, baixa);
  const antes = structuredClone(f.rows());
  await tentarBaixaConfirmacao(input, f.db, baixa);
  expect(f.rows()).toEqual(antes);
  expect(baixa).toHaveBeenCalledTimes(2);
  baixa.mockRejectedValue(Object.assign(Error('pendência'), { pendencia: 'CONTAS_AUSENTES' }));
  await tentarBaixaConfirmacao(input, f.db, baixa);
  const eventos = [...f.rows().values()].filter(v => v.tipo === 'BAIXA_PENDENTE');
  expect(eventos.map(v => v.motivo)).toEqual(['MES_FECHADO', 'CONTAS_AUSENTES']);
  expect((await lerConfirmacaoPagamento(f.db, 'c', r.confirmacaoId)).revisao).toBe(2);
});

test('conflito serializável relê a pendência vencedora sem gerar outro evento', async () => {
  const f = fixture(), r = await f.register();
  const transaction = f.db.$transaction.getMockImplementation();
  const create = f.tx.appSetting.create.getMockImplementation();
  const evento = { tipo: 'BAIXA_PENDENTE', motivo: 'MES_FECHADO', confirmacaoId: r.confirmacaoId, companyId: 'c' };
  let conflito = false;
  f.tx.appSetting.create.mockImplementation(async args => {
    if (!conflito && args.data.value.tipo === 'BAIXA_PENDENTE') {
      conflito = true;
      throw Object.assign(Error('concorrente venceu'), { code: 'P2034' });
    }
    return create(args);
  });
  f.db.$transaction.mockImplementation(async fn => {
    try { return await transaction(fn); } catch (e) {
      if (e.code === 'P2034') {
        // Commit da outra conexão depois do rollback da perdedora.
        await create({ data: { key: 'contabil:cliente:evento:c:vencedor', value: evento } });
        await f.tx.appSetting.update({ where: { key: `${PREFIXO_ESTADO}c:${r.confirmacaoId}` }, data: { value: {
          estadoBaixa: 'PENDENTE', motivo: 'MES_FECHADO', entryIds: [], baixaAnteriorConcluida: false, revisao: 1,
        } } });
      }
      throw e;
    }
  });
  const baixa = jest.fn().mockRejectedValue(Object.assign(Error('fechado'), { code: 'MES_FECHADO' }));
  const out = await tentarBaixaConfirmacao({ companyId: 'c', confirmacaoId: r.confirmacaoId }, f.db, baixa);
  expect(conflito).toBe(true);
  expect(out.confirmacao).toMatchObject({ estadoBaixa: 'PENDENTE', motivo: 'MES_FECHADO' });
  expect([...f.rows().values()].filter(v => v.tipo === 'BAIXA_PENDENTE')).toEqual([evento]);
  expect((await lerConfirmacaoPagamento(f.db, 'c', r.confirmacaoId)).revisao).toBe(1);
});

test('falha de auditoria reverte efeito financeiro e mantém declaração anterior', async () => {
  const f = fixture(), r = await f.register();
  const original = f.tx.appSetting.create.getMockImplementation();
  f.tx.appSetting.create.mockImplementation(async args => {
    if (args.data.value.tipo === 'BAIXA_CONCLUIDA') throw Error('audit indisponível');
    return original(args);
  });
  const baixa = async () => { f.guide.baixada = true; return { entryIds: ['b'] }; };
  const resultado = await tentarBaixaConfirmacao({ companyId: 'c', confirmacaoId: r.confirmacaoId }, f.db, baixa);
  expect(f.guide.baixada).toBe(false);
  expect(resultado.confirmacao.estadoBaixa).toBe('PENDENTE');
  expect((await lerConfirmacaoPagamento(f.db, 'c', r.confirmacaoId)).eventId).toBe('click-1');
});

test('versão substituída, empresa incorreta e identidade ausente não confirmam', async () => {
  const f = fixture();
  f.args.expectedVersion = 'old';
  await expect(f.register()).rejects.toMatchObject({ code: 'GUIA_ALTERADA' });
  f.args.expectedVersion = versaoPagamentoGuia(f.guide); f.args.companyId = 'other';
  await expect(f.register()).rejects.toMatchObject({ code: 'GUIA_INDISPONIVEL' });
  f.args.companyId = 'c'; f.args.autor = {};
  await expect(f.register()).rejects.toMatchObject({ code: 'CONFIRMACAO_INVALIDA' });
  expect(f.tx.guide.updateMany).not.toHaveBeenCalled();
});

test('cliente legado pago não gera nova evidência nem baixa retroativa', async () => {
  const f = fixture(); f.guide.paymentStatus = 'PAID'; f.guide.paymentStatusSource = 'CLIENTE';
  await expect(f.register()).rejects.toMatchObject({ code: 'GUIA_JA_CONFIRMADA' });
  expect(f.rows().size).toBe(0);
});

test('documento mudado após declarar fica pendente, sem atingir outra versão', async () => {
  const f = fixture(), r = await f.register(); f.guide.hash = 'new-pdf';
  const baixa = jest.fn();
  const out = await tentarBaixaConfirmacao({ companyId: 'c', confirmacaoId: r.confirmacaoId }, f.db, baixa);
  expect(out.confirmacao.motivo).toBe('GUIA_ALTERADA'); expect(baixa).not.toHaveBeenCalled();
});

test('fingerprint abrange composição fields, tipo e acordo, sem depender de timestamp de envio', () => {
  const f = fixture();
  f.guide.extracted = { fields: { composicao: [{ principal: 100, juros: 10, multa: 5, total: 115 }] } };
  const v = versaoPagamentoGuia(f.guide);
  f.guide.updatedAt = new Date('2026-10-01'); expect(versaoPagamentoGuia(f.guide)).toBe(v);
  f.guide.extracted.fields.composicao[0].juros = 11; expect(versaoPagamentoGuia(f.guide)).not.toBe(v);
  f.guide.extracted.fields.composicao[0].juros = 10; f.guide.parcelamentoId = 'novo'; expect(versaoPagamentoGuia(f.guide)).not.toBe(v);
});

test('acesso revogado dentro da transação recusa declaração sem escrita', async () => {
  const f = fixture(); f.tx.companyClientUser.findUnique.mockResolvedValue(null);
  await expect(f.register()).rejects.toMatchObject({ code: 'ACESSO_REVOGADO' });
  expect(f.rows().size).toBe(0); expect(f.tx.guide.updateMany).not.toHaveBeenCalled();
});

test('estorno não recria baixa nem reutiliza sucesso anterior', async () => {
  const f = fixture(), r = await f.register();
  const baixar = jest.fn(async () => { f.guide.baixada = true; f.guide.lancamentoId = 'b'; return { entryIds: ['b'] }; });
  const input = { companyId: 'c', confirmacaoId: r.confirmacaoId };
  await tentarBaixaConfirmacao(input, f.db, baixar);
  f.guide.baixada = false; f.guide.lancamentoId = null;
  const out = await tentarBaixaConfirmacao(input, f.db, baixar);
  expect(out.confirmacao).toMatchObject({ estadoBaixa: 'PENDENTE', motivo: 'BAIXA_A_CONCILIAR' });
  const estado = f.rows().get(`${PREFIXO_ESTADO}c:${r.confirmacaoId}`);
  expect(estado).toMatchObject({ estadoBaixa: 'PENDENTE', motivo: 'BAIXA_A_CONCILIAR', baixaAnteriorConcluida: true, revisao: 2 });
  expect([...f.rows().values()].filter(v => v.tipo === 'BAIXA_PENDENTE')).toHaveLength(1);
  expect(baixar).toHaveBeenCalledTimes(1);
});

test('reconfirmação explícita preserva cadeia e nunca reativa versão histórica',async()=>{
 const f=fixture(),a=await f.register(),original=structuredClone(f.rows().get(`${PREFIXO_CONFIRMACAO}c:${a.confirmacaoId}`));
 f.guide.hash='pdf-v2';expect(await reconfirmacaoPagamentoTx(f.tx,f.guide)).toEqual({confirmacaoAnteriorId:a.confirmacaoId,versaoPagamento:versaoPagamentoGuia(f.guide)});
 f.args.expectedVersion=versaoPagamentoGuia(f.guide);await expect(f.register()).rejects.toMatchObject({code:'GUIA_JA_CONFIRMADA'});
 f.args.reconfirmaConfirmacaoId=a.confirmacaoId;const b=await f.register();expect((await f.register()).confirmacaoId).toBe(b.confirmacaoId);
 expect((await lerConfirmacaoPagamento(f.tx,'c',a.confirmacaoId))).toMatchObject({estadoBaixa:'SUBSTITUIDA',substituidaPor:b.confirmacaoId});
 expect(f.rows().get(`${PREFIXO_CONFIRMACAO}c:${a.confirmacaoId}`)).toEqual(original);
 const executar=jest.fn();expect((await tentarBaixaConfirmacao({companyId:'c',confirmacaoId:a.confirmacaoId},f.db,executar)).confirmacao.estadoBaixa).toBe('SUBSTITUIDA');expect(executar).not.toHaveBeenCalled();
 f.guide.hash='pdf-v1';f.args.expectedVersion=versaoPagamentoGuia(f.guide);f.args.reconfirmaConfirmacaoId=b.confirmacaoId;const c=await f.register();expect(c.confirmacaoId).not.toBe(a.confirmacaoId);expect((await lerConfirmacaoPagamento(f.tx,'c',c.confirmacaoId)).substituiConfirmacaoId).toBe(b.confirmacaoId);
});
test.each(['legado','oficial','baixada','historico','estornoManual','outraGuia'])('reconfirmação recusa %s sem transferir anuência',async caso=>{
 const f=fixture(),a=await f.register();f.guide.hash='v2';f.args.expectedVersion=versaoPagamentoGuia(f.guide);f.args.reconfirmaConfirmacaoId=a.confirmacaoId;
 if(caso==='legado')f.rows().delete(`${PREFIXO_CONFIRMACAO}c:${a.confirmacaoId}`);
 if(caso==='estornoManual')f.tx.estornoBaixa.findFirst.mockResolvedValue({id:'estorno'});
 if(caso==='oficial')f.guide.paymentStatusSource='SERPRO';if(caso==='baixada')f.guide.baixada=true;
 if(caso==='historico')f.rows().set(`contabil:cliente:estado:c:${a.confirmacaoId}`,{estadoBaixa:'CONCLUIDA',entryIds:['antiga']});
 if(caso==='outraGuia')f.args.reconfirmaConfirmacaoId='guia-alheia';
 await expect(f.register()).rejects.toMatchObject({code:'RECONFIRMACAO_INDISPONIVEL'});
});
test('falha CAS na substituição reverte nova evidência e preserva a antiga ativa',async()=>{const f=fixture(),a=await f.register();const before=structuredClone(f.rows());f.guide.hash='v2';f.args.expectedVersion=versaoPagamentoGuia(f.guide);f.args.reconfirmaConfirmacaoId=a.confirmacaoId;f.tx.appSetting.updateMany.mockResolvedValueOnce({count:0});await expect(f.register()).rejects.toMatchObject({code:'P2034'});expect(f.rows()).toEqual(before);});

test('corrigir uma guia não substitui a declaração de outra da mesma empresa',async()=>{
 const f=fixture();const a=await f.register();const outro={...structuredClone(f.guide),id:'g2',paymentStatus:'OPEN',clienteConfirmouEm:null};
 const lookup=f.tx.guide.findFirst.getMockImplementation();f.tx.guide.findFirst.mockImplementation(async arg=>arg.where.id==='g2'?outro:lookup(arg));
 const update=f.tx.guide.updateMany.getMockImplementation();f.tx.guide.updateMany.mockImplementation(async arg=>{if(arg.where.id==='g2'){Object.assign(outro,arg.data);return{count:1};}return update(arg);});
 const b=await f.db.$transaction(tx=>registrarConfirmacaoTx(tx,{...f.args,guideId:'g2',expectedVersion:versaoPagamentoGuia(outro)}));
 f.guide.hash='v2';f.args.expectedVersion=versaoPagamentoGuia(f.guide);f.args.reconfirmaConfirmacaoId=a.confirmacaoId;await f.register();
 expect((await lerConfirmacaoPagamento(f.tx,'c',b.confirmacaoId))).toMatchObject({guideId:'g2',estadoBaixa:'PENDENTE'});expect(outro.paymentStatus).toBe('PAID');
});
