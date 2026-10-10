import { prepararPreatendimento } from '../preatendimentoComercial.js';
import { respostaNaturalPermitida } from '../qualificacaoComercial.js';
import { validarInterpretacaoLead } from '../../assistente/interpretacaoLeadIa.js';

const interpretar = (dados = [], resposta = null, comportamento = 'DADOS') => ({ intencao: null, evidenciaIntencao: null, comportamento,
  dados: dados.map(([campo, valor]) => ({ campo, valor, evidencia: valor })), resposta });
const passo = (texto, anterior, dados, resposta, extra = {}) => prepararPreatendimento({ texto, anterior, intencao: 'ABERTURA', nomeConhecido: 'Ana',
  interpretacaoIa: interpretar(dados, resposta), ...extra });

test('médico no Rio segue para operação, prazo e faixa antes do contador', () => {
  let r = passo('Quero abrir uma empresa', {}, []);
  expect(r.pre.campoEsperado).toBe('atividade');
  r = passo('Sou médico', r.pre, [['atividade', 'médico']], {campo:'cidade',texto:'Entendi. Em qual cidade você vai atender?'});
  expect(r.respostaNatural).toContain('Em qual cidade');
  r = passo('Rio de Janeiro', r.pre, [['cidade','Rio de Janeiro']], {campo:'estrutura',texto:'Você pretende atender em consultório próprio ou prestar serviços para clínicas e hospitais?'});
  expect(r.encaminhar).toBe(false);expect(r.pre.campoEsperado).toBe('estrutura');expect(r.respostaNatural).toContain('consultório');
  r = passo('Vou prestar serviços para hospitais', r.pre, [['estrutura','prestar serviços para hospitais']]);
  expect(r.pre.campoEsperado).toBe('urgencia');
  r = passo('Quero começar no mês que vem', r.pre, [['urgencia','no mês que vem']]);
  expect(r.pre.campoEsperado).toBe('faturamento');
  r = passo('Uns 20 mil por mês', r.pre, [['faturamento','20 mil por mês']]);
  expect(r.encaminhar).toBe(true);expect(r.pre.evidenciasIa.faturamento.trecho).toBe('20 mil por mês');
});

test('dados enviados juntos dispensam perguntas repetidas', () => {
  const r=passo('médico, Recife, sozinho, em novembro, 20 mil', {}, [['atividade','médico'],['cidade','Recife'],['estrutura','sozinho'],['urgencia','em novembro'],['faturamento','20 mil']]);
  expect(r.encaminhar).toBe(true);expect(r.pre.perguntasFeitas).toBe(0);
});
test('não saber a faixa não prende nem inventa receita', () => {
  const anterior={qualificacaoVersao:2,nome:'Ana',atividade:'médica',cidade:'Recife',estrutura:'clínicas',urgencia:'novembro',campoEsperado:'faturamento'};
  const r=passo('não sei',anterior,[],null,{interpretacaoIa:interpretar([],null,'DESCONHECIDO')});
  expect(r.encaminhar).toBe(true);expect(r.pre.faturamento).toBeUndefined();expect(r.pre.dispensados).toContain('faturamento');
});
test('prazo desconhecido segue para faixa opcional', () => {
  const r=passo('não sei',{qualificacaoVersao:2,nome:'Ana',atividade:'médica',cidade:'Recife',estrutura:'clínicas',campoEsperado:'urgencia'},[],null,{interpretacaoIa:interpretar([],null,'DESCONHECIDO')});
  expect(r.encaminhar).toBe(false);expect(r.pre.campoEsperado).toBe('faturamento');
});
test('correção usa só a cidade nova e não perde operação já coletada', () => {
  const r=passo('Na verdade será em Olinda',{qualificacaoVersao:2,nome:'Ana',atividade:'médica',cidade:'Recife',estrutura:'clínicas'},[['cidade','Olinda']]);
  expect(r.pre.cidade).toBe('Olinda');expect(r.pre.campoEsperado).toBe('urgencia');
});
test('transferência qualifica além da reclamação inicial', () => {
  const r=passo('Meu contador demora a responder',{},[['necessidade','Meu contador demora a responder']],null,{intencao:'TRANSFERENCIA'});
  expect(r.encaminhar).toBe(false);expect(r.pre.campoEsperado).toBe('atividade');
});
test('pedido explícito de pessoa vence qualquer pergunta gerada', () => {
  const r=passo('Quero falar com uma pessoa',{},[],{campo:'atividade',texto:'Qual atividade você exerce?'},{interpretacaoIa:interpretar([],null,'HUMANO')});
  expect(r.encaminhar).toBe(true);expect(r.respostaNatural).toBeNull();
});
test('limite de perguntas encaminha sem laço', () => {
  expect(passo('oi',{qualificacaoVersao:2,perguntasFeitas:8},[]).encaminhar).toBe(true);
});
test('campo errado gerado cai na pergunta autorizada', () => {
  const r=passo('Sou médico',{},[['atividade','médico']],{campo:'faturamento',texto:'Qual seu faturamento mensal?'});
  expect(r.respostaNatural).toBeNull();expect(r.pergunta).toContain('cidade');
});
test.each(['Garantimos economia. Qual cidade?', 'Você será MEI. Qual cidade?', 'Consultei seu cadastro. Qual cidade?',
  'O plano custa R$ 100. Qual cidade?', 'Vou encaminhar. Qual cidade?', 'Veja https://falso.test. Qual cidade?',
  'Qual cidade? Qual atividade?', 'Me envie sua senha. Qual cidade?'])('não publica resposta indevida: %s', texto => {
  expect(respostaNaturalPermitida({campo:'cidade',texto},'cidade')).toBeNull();
});
test.each(['médico','médica','designer','programador','dentista','arquiteta','fisioterapeuta','psicóloga','engenheiro','professora'])('profissão %s permanece evidenciada', atividade => {
  const texto=`Sou ${atividade}`;
  const r=passo(texto,{},[['atividade',atividade]]);
  expect(r.pre.atividade).toBe(atividade);expect(r.pre.campoEsperado).toBe('cidade');expect(r.encaminhar).toBe(false);
});
test.each(['Rio de Janeiro','Recife','Olinda','Niterói','São Paulo','Salvador','Manaus','Curitiba','Porto Alegre','Brasília'])('cidade %s não encerra antes da qualificação', cidade => {
  const r=passo(cidade,{nome:'Ana',atividade:'médica',campoEsperado:'cidade'},[['cidade',cidade]]);
  expect(r.encaminhar).toBe(false);expect(r.pre.campoEsperado).toBe('estrutura');
});
test.each(['estrutura','faturamento','urgencia'])('dado %s inventado é recusado', campo => {
  expect(validarInterpretacaoLead(interpretar([[campo,'inventado']]),'Não informei isso')).toBeNull();
});

test('pergunta de prazo aceita tempo e faturamento exige referência mensal', () => {
  expect(respostaNaturalPermitida({campo:'urgencia',texto:'Em quanto tempo você quer começar?'},'urgencia')).toBeTruthy();
  expect(respostaNaturalPermitida({campo:'faturamento',texto:'Qual faturamento você prevê?'},'faturamento')).toBeNull();
  expect(respostaNaturalPermitida({campo:'faturamento',texto:'Qual faturamento mensal você prevê?'},'faturamento')).toBeTruthy();
});

test('evidência de ativação sustenta intenção de empresa existente', () => {
  const texto='Quero ativar minha empresa';
  const ia=validarInterpretacaoLead({intencao:'INATIVA',evidenciaIntencao:texto,comportamento:'DADOS',dados:[],resposta:null},texto);
  expect(ia.intencao).toBe('INATIVA');
  const r=prepararPreatendimento({texto,intencao:ia.intencao,nomeConhecido:'Ana',interpretacaoIa:ia});
  expect(r.encaminhar).toBe(false);expect(r.pre.campoEsperado).toBe('cnpj');
  expect(r.pergunta).not.toMatch(/abrir|abertura/i);
});

test('qualificação da ativação pode perguntar a situação sem afirmar inatividade', () => {
  const texto='Ela está funcionando normalmente hoje ou está parada?';
  expect(respostaNaturalPermitida({campo:'necessidade',texto},'necessidade')).toBe(texto);
});
