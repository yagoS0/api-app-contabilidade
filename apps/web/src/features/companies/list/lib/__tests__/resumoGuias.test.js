import { resumirGuias } from '../resumoGuias';
import { projetarOperacoesEmpresas } from '../../../../operacoes/operacoes';

const node = (state, guideId) => ({ required: true, state, guideId });
const compliance = {
  irpj: node('enviada', 'a'), csll: node('enviada', 'b'),
  pisCofins: node('falhou', 'c'), iss: node('missing'),
};
test('quatro obrigações: disponibilidade, envio e falha são eixos independentes', () => {
  const r = resumirGuias(compliance);
  expect(r).toMatchObject({ esperadas: 4, disponiveis: 3, faltantes: 1, enviadas: 2, falhas: 1, enviosPendentes: 1, rotulo: '3/4 disponíveis' });
  const company = { companyId: 'a', guideCompliance: compliance };
  const p = projetarOperacoesEmpresas([company], '2026-09');
  expect(p.groups.faltantes).toHaveLength(r.faltantes);
  expect(p.groups.envios).toHaveLength(r.enviosPendentes);
  expect(p.groups.erros).toHaveLength(r.falhas);
});
test('uma guia consolidada cobre duas obrigações; não chama cobertura de quantidade de PDFs', () => {
  const r = resumirGuias({ irpj: node('gerada', 'mesmo'), csll: node('gerada', 'mesmo') });
  expect(r.disponiveis).toBe(2);
  expect(r.unidade).toBe('obrigações com guia');
});
test('ausência e erro não viram nenhuma guia exigível; dispensa não apaga INSS', () => {
  for (const value of [null, {}, { erro: 'offline' }, { expected: 'SIMPLES', ok: true }]) {
    expect(resumirGuias(value).rotulo).toBe('Cobertura a conferir');
  }
  expect(resumirGuias({ das: node('vazio'), inss: node('missing') })).toMatchObject({ esperadas: 1, faltantes: 1 });
  expect(resumirGuias({ das: { required: false, state: 'na' } }).rotulo).toBe('Nenhuma guia exigível');
});
test('manual e mudança de estado atualizam os conjuntos sem deduzir transmissão', () => {
  const imported = { ...compliance, iss: node('gerada', 'd') };
  expect(resumirGuias(imported)).toMatchObject({ disponiveis: 4, faltantes: 0, enviadas: 2, enviosPendentes: 2 });
  const projected = projetarOperacoesEmpresas([{ companyId: 'a', guideCompliance: imported }], '2026-09');
  expect(projected.groups.apuracoes).toHaveLength(1);
  expect(projected.groups.faltantes).toHaveLength(0);
  expect(projected.groups.envios).toHaveLength(2);
});
test('conflito é revisão, não um documento ausente; parcela fica separada', () => {
  const r = resumirGuias({ das: node('conflito'), parcDas: node('missing') });
  expect(r).toMatchObject({ revisoes: 1, faltantes: 0, completo: false, esperadas: 1 });
});

test('parcelas não alteram cobertura de obrigações e documentos repetidos são contados uma vez', () => {
  const parcelas = [{ id: 'p1', guideId: 'pdf', documento: 'disponivel' }, { id: 'p2', guideId: 'pdf', documento: 'disponivel' }, { id: 'p3', documento: 'faltante' }];
  const r = resumirGuias({ das: node('gerada', 'das'), coberturaParcelamentoMes: parcelas });
  expect(r).toMatchObject({ esperadas: 1, disponiveis: 1, documentosParcelamento: 1, unidade: 'obrigações com guia' });
  expect(r.parcelas).toEqual(parcelas);
});

it('pagamento prevalece no grupo sem fabricar envio e falha conserva documento', () => {
  const r = resumirGuias({ das: { ...node('gerada', 'paga'), paymentStatus: 'PAID' }, inss: node('falhou', 'falha'), iss: node('missing'), irpj: node('enviada', 'enviada') });
  expect(r.items.map(i => i.grupo).sort()).toEqual(['disponivel', 'enviada', 'paga', 'pendente']);
  expect(r.items.find(i => i.key === 'das')).toMatchObject({ paga: true, enviada: false, pagamento: 'Confirmado', comunicacao: 'Pendente' });
  expect(r.items.find(i => i.key === 'inss')).toMatchObject({ grupo: 'disponivel', documento: 'Disponível', comunicacao: 'Falhou' });
});
it('dispensa e débito automático de parcela ficam fora dos faltantes; desconhecido fica em revisão', () => {
  const r = resumirGuias({ das: node('vazio'), inss: { required: true }, parcDas: { required: true, state: 'debito_automatico' } });
  expect(r.faltantes).toBe(0); expect(r.revisoes).toBe(1); expect(r.completo).toBe(false);
  expect(r.items.find(i => i.key === 'inss').grupo).toBe('verificar');
});
