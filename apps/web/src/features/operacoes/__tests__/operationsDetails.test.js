import { operationDate, operationMoney, operationInstant, calculationAuditLabel } from '../operationsDetails';
test('auditoria REVIEW é concluída com achados e o resumo identifica o cálculo salvo', () => {
  const auditSummary = { status: 'REVIEW', totalAchados: 2, warnings: ['Anexo alterado'] };
  expect(calculationAuditLabel(auditSummary)).toBe('Auditoria concluída · 2 achados');
  expect(calculationAuditLabel(auditSummary, { saved: true })).toBe('Auditoria no cálculo salvo · 2 achados');
  const result = calculationColumns({ auditSummary, calculationWarnings: ['Anexo alterado'] });
  expect(result.warnings).toEqual(['Anexo alterado']);
});
test.each([['REVIEW','Preencher folha Fator R'],['UNCERTAIN','Conferir tentativa anterior'],['STALE','As notas mudaram']])('tentativa %s conserva motivo na tabela após fechar resultado', (status, reason) => {
  const result = calculationColumns({ manualCalculation: { status, reason } });
  expect(result.errors.join(' ')).toContain(reason);
  expect(result.errors.join(' ')).toMatch(/Revisão necessária|Resultado a conferir|Dados alterados/);
});
test.each([null, '', '2026-02-30', '2026-13-01', '2026-10-10T99:00'])('data inválida %s permanece a verificar', value => {
  expect(operationDate(value)).toBe('A verificar');
});
test('data civil não desloca de dia; zero explícito difere de ausência', () => {
  expect(operationDate('2026-10-30')).toBe('30/10/2026');
  expect(operationMoney(0)).toContain('0,00');
  for (const value of [null, undefined, '', false, NaN]) expect(operationMoney(value)).toBe('Não disponível');
});

test('instantes usam Brasília e datas civis não mudam', () => {
  expect(operationInstant('2026-10-30T02:00:00Z')).toContain('29/10/2026');
  expect(operationDate('2026-10-30T00:00:00Z')).toBe('30/10/2026');
  expect(operationInstant('2026-02-30T02:00:00Z')).toBe('A verificar');
});

import {calculationColumns,approvalEvidenceError} from '../operationsDetails';
test('execução histórica concluída não aparece como erro nem habilita nova liberação',()=>{
 const operation={companyId:'a',competencia:'2026-10',status:'EXECUTED',execution:{status:'DONE',message:'Concluída'},details:{snapshot:{value:{portalClientId:'a',competencia:'2026-10',estado:'transmitida',receitaInterna:100,receitaExterna:0}},auditoria:{value:{competencia:'2026-10',perguntas:[]}}}};
 expect(calculationColumns(operation).errors).toEqual([]);expect(approvalEvidenceError(operation)).toMatch(/Execução já concluída/);expect(calculationColumns({...operation,details:{...operation.details,auditoria:{error:'Leitura recusada'}}}).errors.join()).toMatch(/Leitura recusada/);
});

import { reconcileOperationGuides, guideSendBlock } from '../operationsDetails';
test('parcela conserva identidade, exclui versão antiga e não funde contratos por valor', () => {
 const row={company:{companyId:'a'},guideSummary:{items:[{key:'p1',parcelaId:'p1',parcelamentoId:'c1',numeroParcela:1,guideId:'atual',label:'Parcela'},{key:'p2',parcelaId:'p2',parcelamentoId:'c2',numeroParcela:1,guideId:'outra',label:'Parcela'}]}};
 const base={companyId:'a',competencia:'2026-10',valor:100,status:'PROCESSED'};
 const docs=[{...base,guideId:'antiga',status:'SUBSTITUIDA',parcelamentoId:'c1',numeroParcela:1},{...base,guideId:'atual',parcelamentoId:'c1',numeroParcela:1},{...base,guideId:'outra',parcelamentoId:'c2',numeroParcela:1}];
 const result=reconcileOperationGuides(docs,row,'2026-10');
 expect(result.guides.map(g=>g.guideId)).toEqual(['atual','outra']);expect(result.missing).toEqual([]);expect(docs).toHaveLength(3);
});
test.each([{status:'ERROR'},{status:'NEEDS_REVIEW'},{status:'SUBSTITUIDA'},{status:'PROCESSED',paymentStatus:'PAID'},{status:'PROCESSED',envio:{canais:[{status:'indeterminado'}]}}])('envio indisponível para %j',guide=>expect(guideSendBlock(guide)).toBeTruthy());


test('snapshot antigo não oculta documento novo da parcela ausente da leitura anterior',()=>{
 const row={company:{companyId:'a'},guideSummary:{items:[{guideId:'antiga',parcelaId:'p1'}]}};
 const nova={companyId:'a',competencia:'2026-10',guideId:'nova',parcelaId:'p1',status:'PROCESSED'};
 expect(reconcileOperationGuides([nova],row,'2026-10').guides).toEqual([nova]);
});


test('duas revisões sem prova de substituição ficam visíveis e bloqueadas',()=>{
 const row={company:{companyId:'a'},guideSummary:{items:[{guideId:'antiga',parcelaId:'p1'}]}};
 const docs=['antiga','nova'].map(guideId=>({guideId,companyId:'a',competencia:'2026-10',parcelaId:'p1',status:'PROCESSED'}));
 const result=reconcileOperationGuides(docs,row,'2026-10');
 expect(result.guides.map(g=>g.guideId)).toEqual(['antiga','nova']);expect(result.missing).toEqual([]);
 result.guides.forEach(g=>expect(guideSendBlock(g)).toMatch(/Mais de uma revisão/));expect(docs.every(g=>!g.operationsIdentityConflict)).toBe(true);
});
