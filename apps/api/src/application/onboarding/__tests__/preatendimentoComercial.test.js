import { identificarIntencaoComercial, prepararPreatendimento, mensagemDeValor } from '../preatendimentoComercial.js';

test.each([
  ['ABRIR', 'ABERTURA'], ['CONTADOR', 'TRANSFERENCIA'], ['contador', 'TRANSFERENCIA'],
  ['IMPOSTO', 'PLANEJAMENTO'], ['MARGEM', 'GESTAO'], ['DRE', 'GESTAO'],
  ['Quero pagar menos impostos', 'PLANEJAMENTO'], ['Preciso entender o lucro da minha empresa', 'GESTAO'],
  ['Não quero planejamento tributário', null], ['Qual o meu faturamento?', null],
  ['Sou médico e quero abrir uma empresa', 'ABERTURA'], ['Quero trocar de contador', 'TRANSFERENCIA'],
])('intenção sem modelo: %s', (texto, esperado) => expect(identificarIntencaoComercial(texto)).toBe(esperado));
test('botão usa ID, nunca título livre', () => {
  expect(identificarIntencaoComercial('Quero abrir empresa', { id: 'altan.comercial.planejamento.v1' })).toBe('PLANEJAMENTO');
  expect(identificarIntencaoComercial('Quero abrir empresa', { id: 'inventado' })).toBeNull();
});
test.each(['CONTADOR', 'contador'])('palavra %s inicia conversa sobre a troca, sem ser confundida com pedido humano', texto => {
  const r = prepararPreatendimento({ texto, intencao: 'TRANSFERENCIA' });
  expect(r.encaminhar).toBe(false); expect(r.pergunta).toContain('melhorar');
  expect(r.pre.nome).toBeNull(); expect(r.pre.necessidade).toBeNull();
});
test('palavra de campanha não inventa a origem da pessoa', () => {
  const { pre } = prepararPreatendimento({ texto: 'DRE', intencao: 'GESTAO' });
  expect(pre.palavraEntrada).toBe('DRE'); expect(pre.origemDeclarada).toBeUndefined();
  const r = prepararPreatendimento({ texto: 'Vim pelo Instagram; tenho uma loja; me chamo Caio', intencao: 'GESTAO', anterior: pre });
  expect(r.pre.origemDeclarada).toBe('Instagram'); expect(r.encaminhar).toBe(true);
});
test('perfil conhecido dispensa perguntar nome, mas não preenche campo fiscal confirmado', () => {
  const r = prepararPreatendimento({ texto: 'Sou médica e quero abrir uma empresa; cidade: Rio/RJ', intencao: 'ABERTURA', nomeConhecido: 'Ana' });
  expect(r.encaminhar).toBe(true); expect(r.operacoes.some(o => o.campo === 'responsavelNome')).toBe(false);
});
test('pedido de reunião segue à equipe sem inventar agendamento', () => {
  const r = prepararPreatendimento({ texto: 'Quero agendar uma conversa', intencao: 'PLANEJAMENTO' });
  expect(r.encaminhar).toBe(true); expect(r.pre.preferenciaContato).toContain('a confirmar');
});
test('benefício contextual não promete redução de imposto nem proposta automática', () => {
  expect(mensagemDeValor({ intencao: 'TRANSFERENCIA', necessidade: 'Meu contador só manda guias' })).toContain('resultados');
  expect(mensagemDeValor({ intencao: 'PLANEJAMENTO' })).toContain('antes de falar em economia');
});
