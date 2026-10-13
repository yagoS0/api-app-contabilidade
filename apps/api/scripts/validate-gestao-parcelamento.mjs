// Integração real, somente em banco local dedicado a validação.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
assert.equal(process.env.DATABASE_URL, 'postgresql://codex@127.0.0.1:55441/competencia_validation');
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { consultarGestaoParcelamento, preverCorrecaoParcelamento, corrigirParcelamento } = await import('../src/application/accounting/parcelamento/GestaoParcelamentoService.js');
const { preverBaixaGestao, executarBaixaGestao } = await import('../src/application/accounting/parcelamento/BaixaGestaoParcelamentoService.js');
const { executarEstorno, previewEstorno } = await import('../src/application/accounting/EstornoBaixaService.js');
const { preverConciliacao, executarConciliacao } = await import('../src/application/accounting/parcelamento/ConciliacaoGestaoParcelamentoService.js');
const tag=randomUUID();
let company;
const ids=[];
try {
  company=await db.portalClient.create({data:{razao:`Fixture gestão ${tag}`,cnpj:tag.replace(/\D/g,'').padEnd(14,'0').slice(0,14)}});
  for(const tipo of ['PARCSN','OUTRO']) {
    const acordo=await db.parcelamento.create({data:{portalClientId:company.id,label:`Teste ${tipo}`,kind:tipo,tipo,numParcelas:3,numEntradas:1,principalTotal:500,competenciaInicial:'2026-08',formaPagamento:'GUIA_MENSAL'}});
    ids.push(acordo.id);
    const abertura=await db.accountingEntry.create({data:{portalClientId:company.id,parcelamentoId:acordo.id,tipo:'PROVISAO',tipoLinha:'PARC',data:new Date('2026-08-01T12:00:00Z'),competencia:'2026-08',historico:'Abertura fixture',lines:{create:{conta:'200',tipo:'C',valor:500,tipoLinha:'PARC'}}}});
    await db.parcelamento.update({where:{id:acordo.id},data:{aberturaEntryId:abertura.id}});
    const rows=[];
    for(let n=1;n<=3;n++)rows.push(await db.parcela.create({data:{portalClientId:company.id,parcelamentoId:acordo.id,numeroParcela:n,competencia:`2026-${String(n+7).padStart(2,'0')}`,vencimento:new Date(`2026-${String(n+7).padStart(2,'0')}-20T12:00:00Z`),valorPrevisto:n===1?300:100}}));
    const args={companyId:company.id,parcelamentoId:acordo.id,userId:'fixture-local'};
    const entrada=await consultarGestaoParcelamento({...args,referencia:'2026-10'});
    assert.deepEqual(entrada.quadro.doMes,[3]);
    const alteracao={motivo:'Correção do calendário importado',parcelas:rows.map(p=>({id:p.id,numeroParcela:p.numeroParcela,competencia:p.competencia,vencimento:p.vencimento.toISOString().slice(0,10),valorPrevisto:Number(p.valorPrevisto),tipo:p.numeroParcela===1?'ENTRADA':'PARCELA'}))};
    alteracao.parcelas[2].vencimento='2026-10-30';
    const cp=await preverCorrecaoParcelamento({...args,alteracao});
    await corrigirParcelamento({...args,alteracao,confirmacao:cp.confirmacao});
    await assert.rejects(corrigirParcelamento({...args,alteracao,confirmacao:cp.confirmacao}),/dados mudaram/);
    assert.equal(Number((await db.parcela.findUnique({where:{id:rows[0].id}})).valorPrevisto),300);
    const guia=await db.guide.create({data:{portalClientId:company.id,parcelamentoId:acordo.id,numeroParcela:2,tipo:'PARCELAMENTO',competencia:'2026-09',valor:105,vencimento:new Date('2026-09-20T12:00:00Z'),pdfBytes:Buffer.from('fixture'),hash:randomUUID()}});
    await db.parcela.update({where:{id:rows[1].id},data:{guiaId:guia.id}});
    for(const p of rows.slice(0,2)) {
      const principal=Number(p.valorPrevisto);
      const baixa={dataPagamento:'2026-10-13',linhas:[{tipoLinha:'PARC',tipo:'D',valor:principal,conta:'200',historico:'Amortização'},{tipoLinha:'JUROS',tipo:'D',valor:5,conta:'500',historico:'Juros'},{tipoLinha:'CAIXA',tipo:'C',valor:principal+5,conta:'100',historico:'Pagamento'}]};
      const pay={...args,parcelaId:p.id,baixa};
      const preview=await preverBaixaGestao(pay);
      const attempts=await Promise.allSettled([executarBaixaGestao({...pay,confirmacao:preview.confirmacao}),executarBaixaGestao({...pay,confirmacao:preview.confirmacao})]);
      assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
      const result=attempts.find(x=>x.status==='fulfilled').value;
      assert.equal(result.lancamentos.length,3);
      const entries=await db.accountingEntry.findMany({where:{id:{in:result.lancamentos}},include:{lines:true}});
      assert.equal(entries.reduce((s,e)=>s+e.lines.reduce((s,l)=>s+(l.tipo==='D'?1:-1)*Number(l.valor),0),0),0);
      assert.ok(entries.every(e=>e.openEntryId===abertura.id&&e.origem==='MANUAL'));
      const estado=await consultarGestaoParcelamento({...args,referencia:'2026-10'});
      assert.equal(estado.quadro.baixadas,1);
      if(p.id===rows[1].id){
        const renumeracao={motivo:'Correção de número mantendo a baixa',parcelas:estado.acordo.parcelasContratadas.map(x=>({id:x.id,numeroParcela:x.numeroParcela===2?3:x.numeroParcela===3?2:x.numeroParcela,competencia:x.competencia,vencimento:x.vencimento.toISOString().slice(0,10),valorPrevisto:Number(x.valorPrevisto),tipo:x.numeroParcela===1?'ENTRADA':'PARCELA'}))};
        const rp=await preverCorrecaoParcelamento({...args,alteracao:renumeracao});
        await corrigirParcelamento({...args,alteracao:renumeracao,confirmacao:rp.confirmacao});
        assert.equal((await db.guide.findUnique({where:{id:guia.id}})).numeroParcela,3);
        assert.ok((await db.accountingEntry.findMany({where:{id:{in:result.lancamentos}}})).every(e=>e.numeroParcela===3));
      }
      const est=await previewEstorno({portalClientId:company.id,entryId:result.lancamentos[0]});
      await executarEstorno({portalClientId:company.id,entryId:result.lancamentos[0],motivo:'Reversão de teste local',userId:'fixture-local',totalConferido:est.totalEstornado});
      assert.equal((await consultarGestaoParcelamento(args)).quadro.baixadas,0);
      await preverBaixaGestao(pay); // volta a permitir a baixa depois do estorno.
    }
    await db.companyMonthlyCircular.create({data:{portalClientId:company.id,competencia:'2026-10',fechadoContabilEm:new Date()}});
    await assert.rejects(preverBaixaGestao({...args,parcelaId:rows[2].id,baixa:{dataPagamento:'2026-10-13',linhas:[]}}),/fechado/);
    await db.companyMonthlyCircular.delete({where:{portalClientId_competencia:{portalClientId:company.id,competencia:'2026-10'}}});
    await assert.rejects(consultarGestaoParcelamento({...args,companyId:'outra-empresa'}),/não encontrado/);
    const lote=`fixture-${randomUUID()}`;
    for(const [tipoLinha,tipo,conta] of [['PARC','D','200'],['CAIXA','C','100']])await db.accountingEntry.create({data:{portalClientId:company.id,tipo:'BAIXA',tipoLinha,loteImportacao:lote,data:new Date('2026-10-13T12:00:00Z'),competencia:'2026-10',historico:'Pagamento já registrado',lines:{create:{tipoLinha,tipo,conta,valor:100}}}});
    const vinculo={...args,conciliacao:{tipo:'VINCULO',parcelaIds:[rows[2].id],lote,motivo:'Pagamento anteriormente lançado'}};
    const vp=await preverConciliacao(vinculo);
    const quantidadeAntes=await db.accountingEntry.count({where:{portalClientId:company.id}});
    await executarConciliacao({...vinculo,confirmacao:vp.confirmacao});
    assert.equal(await db.accountingEntry.count({where:{portalClientId:company.id}}),quantidadeAntes);
    assert.equal((await consultarGestaoParcelamento(args)).quadro.baixadas,1);
    await assert.rejects(executarConciliacao({...vinculo,confirmacao:vp.confirmacao}),/já contabilizada/);
    const estVinculo=await previewEstorno({portalClientId:company.id,entryId:vp.grupo.ids[0]});
    await executarEstorno({portalClientId:company.id,entryId:vp.grupo.ids[0],motivo:'Teste de vínculo reversível',totalConferido:estVinculo.totalEstornado});
    const historico={...args,conciliacao:{tipo:'HISTORICO',parcelaIds:[rows[0].id],dataCorte:'2026-09-01',motivo:'Parcelas anteriores à escrituração'}};
    await assert.rejects(preverConciliacao(historico),/saldo da provisão/);
    // Simula abertura de migração que já reconhecia apenas as parcelas restantes.
    await db.accountingEntryLine.updateMany({where:{entryId:abertura.id},data:{valor:200}});
    const hp=await preverConciliacao(historico);
    const antesHistorico=await db.accountingEntry.count({where:{portalClientId:company.id}});
    await executarConciliacao({...historico,confirmacao:hp.confirmacao});
    const fim=await consultarGestaoParcelamento(args);
    assert.equal(fim.quadro.historicas,1);assert.equal(fim.quadro.baixadas,0);
    assert.equal(await db.accountingEntry.count({where:{portalClientId:company.id}}),antesHistorico);
    assert.ok(await db.appSetting.count({where:{key:{startsWith:`parcelamento_gestao:${acordo.id}:`}}})>=3);
  }
  console.log('PASS PostgreSQL: entrada diferente, correção auditada, versão concorrente, baixa com/sem guia, duplo clique, lançamentos balanceados, estorno, mês fechado, isolamento entre empresas, vínculo sem duplicação e histórico com saldo de abertura validado (Simples e OUTRO).');
} finally {
  if(company) {
    await db.appSetting.deleteMany({where:{OR:ids.map(id=>({key:{startsWith:`parcelamento_gestao:${id}:`}}))}});
    await db.portalClient.delete({where:{id:company.id}});
  }
  await db.$disconnect();
}
