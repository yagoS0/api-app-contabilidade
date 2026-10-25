import { criarCursor, hojeBrasilia, lerCursor, normalizarFiltros, predicado, projetar, recortes, versao } from '../solicitacoesProjection.js';
const now = new Date('2026-10-25T02:00:00Z');
const row = { id: 's1', portalClientId: 'pc1', estado: 'RESOLVIDO', resumo: 'Original', motivo: 'Original', responsavelId: 'u',
  resolvidoEm: now, createdAt: now, updatedAt: now, contratoVersao: null, revisao: 0 };
test('RESOLVIDO antigo continua encerrado sem solução nem autor fabricados', () => {
  expect(projetar(row)).toMatchObject({ situacao: 'ENCERRADA_LEGADO', adocaoPendente: true, concluidoPorId: null, concluidoEm: null, criadorId: null, prioridade: null, prazoCivil: null });
  expect(projetar({ ...row, estado: 'OUTRO_ESTADO' }).situacao).toBe('A_VERIFICAR');
});
test('conclusão só com evidência e encerramento correspondente; alteração legada invalida token', () => {
  const complete = { ...row, contratoVersao: 1, concluidoPorId: 'u', concluidoEm: now };
  expect(projetar(complete).situacao).toBe('CONCLUIDA');
  expect(projetar({ ...complete, resolvidoEm: new Date('2026-10-26') }).situacao).toBe('ENCERRADA_LEGADO');
  expect(versao({ ...row, responsavelId: 'outro' })).not.toBe(versao(row));
  expect(versao({ ...row, updatedAt: new Date('2026-10-26') })).not.toBe(versao(row));
});
test('data de Brasília e ausência de prazo não criam atraso; recortes são sobrepostos', () => {
  expect(hojeBrasilia(now)).toBe('2026-10-24');
  expect(recortes('2026-10-24').atrasadas).toEqual({ estado: { not: 'RESOLVIDO' }, prazoCivil: { lt: '2026-10-24' } });
  expect(recortes('2026-10-24').prioritarias).toMatchObject({ prioridade: 'ALTA' });
});
test('cursor tem desempate, vinculado ao filtro e escopo, e não aceita lixo', () => {
  const cursor = criarCursor(row, 'f1');
  expect(lerCursor(cursor, 'f1').OR[1]).toEqual({ createdAt: now, id: { gt: 's1' } });
  expect(() => lerCursor(cursor, 'f2')).toThrow('cursor_invalido');
  expect(() => lerCursor('!', 'f1')).toThrow('cursor_invalido');
});
test('predicado vazio nega acesso; mesmos filtros sustentam listas e recortes', () => {
  const fields = { concluidoEm: 'field-reference' };
  expect(predicado({ empresas: [], triagem: false }, {}, '2026-10-25', fields).AND[0]).toEqual({ id: { in: [] } });
  const where = predicado({ empresas: ['pc1'], triagem: false }, normalizarFiltros({ recorte: 'atrasadas', prioridade: 'ALTA' }), '2026-10-25', fields);
  expect(where.AND).toContainEqual(recortes('2026-10-25').atrasadas);
  expect(JSON.stringify(where)).toContain('atendimentoId');
  expect(() => normalizarFiltros({ limite: 1 })).toThrow('filtro_invalido');
});
