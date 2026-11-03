import { operationDate, operationMoney, operationInstant } from '../operationsDetails';
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
