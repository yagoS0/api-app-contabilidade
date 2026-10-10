import { validarInterpretacaoLead } from '../interpretacaoLeadIa.js';

const interpretar = (campo, valor, evidencia = valor) => ({
  intencao: null, evidenciaIntencao: null, comportamento: 'DADOS',
  dados: [{ campo, valor, evidencia }], resposta: null,
});

test.each([
  ['No próximo mês', 'urgencia', 'no próximo mês', 'no próximo mês', 'No próximo mês'],
  ['Tenho três funcionários', 'estrutura', 'Três funcionários', 'tenho três funcionários', 'três funcionários'],
  ['Tenho  três\nfuncionários', 'estrutura', 'três funcionários', 'tenho três funcionários', 'três\nfuncionários'],
  ['Sou a ANA', 'nome', 'ana', 'sou a ana', 'ANA'],
  ['Em Recife', 'cidade', 'em recife', 'em recife', 'Recife'],
])('recupera o trecho original sem inventar: %s', (texto, campo, valor, evidencia, esperado) => {
  const entrada = interpretar(campo, valor, evidencia);
  const original = structuredClone(entrada);
  const r = validarInterpretacaoLead(entrada, texto);
  expect(r.dados[0].valor).toBe(esperado);
  expect(texto).toContain(r.dados[0].evidencia);
  expect(r.dados[0].evidencia).toContain(r.dados[0].valor);
  expect(entrada).toEqual(original);
});

test('intenção também conserva a evidência original', () => {
  const r = validarInterpretacaoLead({ ...interpretar('necessidade', 'quero entender a margem'),
    intencao: 'GESTAO', evidenciaIntencao: 'quero entender a margem' }, 'Quero entender a margem');
  expect(r.evidenciaIntencao).toBe('Quero entender a margem');
  expect(r.dados[0].valor).toBe('Quero entender a margem');
});

test.each([
  ['Tenho três funcionários', 'estrutura', '3 funcionários', 'Tenho três funcionários'],
  ['No próximo mês', 'urgencia', 'No próximo mês.', 'No próximo mês'],
  ['No próximo mês', 'urgencia', 'no proximo mes', 'No próximo mês'],
  ['No próximo mês', 'urgencia', 'no mês seguinte', 'No próximo mês'],
  ['Tenho dois funcionários', 'estrutura', 'três funcionários', 'Tenho dois funcionários'],
  ['Receita 10.000', 'faturamento', '10000', 'Receita 10.000'],
  ['Sou Ana', 'nome', 'Ana', 'Sou Ana, em Recife'],
  ['Sou Ana', 'nome', '.*', 'Sou Ana'],
])('mantém rejeição de alteração não comprovada: %s / %s / %s', (texto, campo, valor, evidencia) => {
  expect(validarInterpretacaoLead(interpretar(campo, valor, evidencia), texto)).toBeNull();
});

test('valor válido em outro trecho não justifica evidência errada', () => {
  expect(validarInterpretacaoLead(interpretar('nome', 'Ana', 'Recife'), 'Ana em Recife')).toBeNull();
});

test('não salva campo bom junto com uma interpretação que inventa dados', () => {
  const entrada = interpretar('nome', 'ana', 'sou ana');
  entrada.dados.push({ campo: 'cidade', valor: 'Paris', evidencia: 'Paris' });
  expect(validarInterpretacaoLead(entrada, 'Sou Ana')).toBeNull();
});

test('normalização não autoriza remoção sem evidência de correção', () => {
  expect(validarInterpretacaoLead(interpretar('nome', null, 'sou ana'), 'Sou Ana')).toBeNull();
});

test('correção explícita conserva a grafia da negação', () => {
  const r = validarInterpretacaoLead(interpretar('cidade', null, 'desconsidere recife'), 'DESCONSIDERE Recife');
  expect(r.dados).toEqual([{ campo: 'cidade', valor: null, evidencia: 'DESCONSIDERE Recife' }]);
});

test.each([
  ['Trabalho com dois funcionários', 'TRANSFERENCIA', 'Meu contador demora dias para responder', 'estrutura', 'dois funcionários'],
  ['Corrigindo, vou trabalhar em Olinda', 'ABERTURA', null, 'cidade', 'Olinda'],
])('ignora intenção antiga da qualificação e mantém dado novo: %s', (texto, intencao, evidenciaIntencao, campo, valor) => {
  const r = validarInterpretacaoLead({ ...interpretar(campo, valor, texto), intencao, evidenciaIntencao }, texto);
  expect(r).toMatchObject({ intencao: null, evidenciaIntencao: null, dados: [{ campo, valor, evidencia: texto }] });
});

test('descartar intenção antiga não autoriza dado inventado', () => {
  expect(validarInterpretacaoLead({ ...interpretar('estrutura', 'três funcionários', 'Trabalho com dois funcionários'),
    intencao: 'TRANSFERENCIA', evidenciaIntencao: 'Meu contador demora' }, 'Trabalho com dois funcionários')).toBeNull();
});

test('pedido novo explícito continua exigindo sua própria evidência', () => {
  expect(validarInterpretacaoLead({ ...interpretar('cidade', 'Olinda'), intencao: 'ABERTURA', evidenciaIntencao: null },
    'Quero abrir uma empresa em Olinda')).toBeNull();
});

test('desconhecimento ignora intenção sem domínio atual, mas nunca aceita dados inventados', () => {
  const resposta={intencao:'INATIVA',evidenciaIntencao:'Quero regularizar minha empresa, não pago nada',comportamento:'DESCONHECIDO',dados:[],resposta:null};
  expect(validarInterpretacaoLead(resposta,'Não lembro')).toMatchObject({intencao:null,evidenciaIntencao:null,comportamento:'DESCONHECIDO',dados:[]});
  expect(validarInterpretacaoLead({...resposta,dados:[{campo:'periodoPendencias',valor:'Não lembro',evidencia:'Não lembro'}]},'Não lembro')).toBeNull();
});
