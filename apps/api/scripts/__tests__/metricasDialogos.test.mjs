import test from 'node:test';
import assert from 'node:assert/strict';
import { metricasDialogos } from '../lib/metricasDialogos.mjs';
test('custo por lead inclui chamadas falhas, sem confundir média por mensagem ou média de grupos', () => {
  const r = metricasDialogos([
    { grupo: 'abertura', custoUsd: .03, chamadas: 3, concluido: true, passou: true, turnos: [] },
    { grupo: 'abertura', custoUsd: .03, chamadas: 1, concluido: true, passou: false, turnos: [] },
    { grupo: 'humano', custoUsd: .003, chamadas: 1, concluido: true, passou: true, turnos: [] },
  ]);
  assert.equal(r.geral.custoMedioPorLeadUsd, .021);
  assert.equal(r.geral.chamadas, 5); assert.equal(r.geral.aprovados, 2);
  assert.equal(r.geral.projecao1000LeadsUsd, 21);
  assert.equal(r.porGrupo.humano.custoMedioPorLeadUsd, .003);
});
test('amostra vazia não produz custo zero como se tivesse sido medida', () => {
  assert.equal(metricasDialogos([]).geral.custoMedioPorLeadUsd, null);
});

test('projeção sem cache usa todos os tokens de entrada e não estima uso desconhecido', () => {
  const caso = { grupo: 'abertura', custoUsd: .001, chamadas: 1, concluido: true, passou: true,
    turnos: [{ modelo: [{ ms: 100, usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 100, cache_creation_input_tokens: 0 } }] }] };
  assert.equal(metricasDialogos([caso]).geral.mediaSemCacheUsd, .0012);
  assert.equal(metricasDialogos([{ ...caso, chamadas: 2 }]).geral.mediaSemCacheUsd, null);
});
