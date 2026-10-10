import { prepararPreatendimento } from '../preatendimentoComercial.js';
import { ordemQualificacao, perguntasQualificacao } from '../qualificacaoComercial.js';

const base = { qualificacaoVersao: 2, intencao: 'INATIVA', cnpj: '11222333000181', dadosInformados: {cnpj:'11222333000181'}, atividade:'Serviços médicos', cidade:'Recife', campoEsperado:'necessidade' };
function passo(texto, anterior=base, dados=[], comportamento='DADOS', mensagemId='m') {
  return prepararPreatendimento({texto,anterior,intencao:anterior.intencao,mensagemId,
    interpretacaoIa:{intencao:null,evidenciaIntencao:null,comportamento,resposta:null,dados:dados.map(([campo,valor])=>({campo,valor,evidencia:valor===null?texto:valor}))}});
}

test('não pagamento investiga período, obrigações e operação antes de prazo/receita',()=>{
  let r=passo('Não pago nada',base,[['necessidade','Não pago nada']]);
  expect(r.pre.campoEsperado).toBe('periodoPendencias');
  r=passo('Desde 2022',r.pre,[['periodoPendencias','Desde 2022']], 'DADOS','m2');
  expect(r.pre.campoEsperado).toBe('tipoPendencias');
  r=passo('Impostos e declarações, não sei quais',r.pre,[['tipoPendencias','Impostos e declarações, não sei quais']],'DADOS','m3');
  expect(r.pre.campoEsperado).toBe('situacaoOperacional');
  r=passo('Continuo atendendo normalmente e trabalho sozinho',r.pre,[['situacaoOperacional','Continuo atendendo normalmente'],['estrutura','trabalho sozinho']],'DADOS','m4');
  expect(r.pre.campoEsperado).toBe('urgencia');
  expect(r.pre.necessidade).toBe('Não pago nada');
  expect(r.pre.relatosCliente).toHaveLength(4);
  expect(r.pre.relatosCliente[2].texto).toBe('Impostos e declarações, não sei quais');
  expect(perguntasQualificacao(r.pre).faturamento).not.toContain('retomada');
});

test('complementos fora de ordem e operação já relatada evitam repetição',()=>{
  const r=passo('Não pago guias desde 2022. A empresa está parada',base,[['necessidade','Não pago guias desde 2022'],['periodoPendencias','desde 2022'],['tipoPendencias','guias']]);
  expect(r.pre.situacaoOperacional).toBe('Não pago guias desde 2022. A empresa está parada');
  expect(r.pre.campoEsperado).toBe('estrutura');
});

test('complemento na etapa de receita reabre somente investigação relevante',()=>{
  const r=passo('Também não paguei os impostos desde março',{...base,necessidade:'Quero voltar a operar',estrutura:'sozinho',urgencia:'amanhã',campoEsperado:'faturamento'},
    [['periodoPendencias','desde março'],['tipoPendencias','impostos']]);
  expect(r.pre.investigacaoPendencias).toBe(true);
  expect(r.pre.campoEsperado).toBe('situacaoOperacional');
});

test('não saber ou recusar um dado segue sem insistência nem inventar resposta',()=>{
  let r=passo('Não pago nada',base,[['necessidade','Não pago nada']]);
  r=passo('Não lembro',r.pre,[],'DESCONHECIDO','m2');
  expect(r.pre.campoEsperado).toBe('tipoPendencias');
  expect(r.pre.dispensados).toContain('periodoPendencias');
  r=passo('Prefiro não falar sobre isso',r.pre,[],'DESCONHECIDO','m3');
  expect(r.pre.campoEsperado).toBe('situacaoOperacional');
  expect(r.pre.dispensados).toContain('tipoPendencias');
  expect(r.pre.tipoPendencias).toBeUndefined();
});

test('correção altera campo, preserva todos relatos e não duplica reprocessamento',()=>{
  let r=passo('Não pago desde 2022',base,[['necessidade','Não pago desde 2022'],['periodoPendencias','desde 2022']]);
  r=passo('Corrigindo, desde 2023',r.pre,[['periodoPendencias','desde 2023']],'DADOS','m2');
  expect(r.pre.periodoPendencias).toBe('desde 2023');
  expect(r.pre.relatosCliente.map(x=>x.texto)).toEqual(['Não pago desde 2022','Corrigindo, desde 2023']);
  r=passo('Corrigindo, desde 2023',r.pre,[['periodoPendencias','desde 2023']],'DADOS','m2');
  expect(r.pre.relatosCliente).toHaveLength(2);
});

test('pedido de pessoa e pausa continuam superiores à investigação',()=>{
  const estado={...base,investigacaoPendencias:true,necessidade:'Não pago impostos',campoEsperado:'periodoPendencias'};
  expect(passo('Quero falar com uma pessoa',estado,[],'HUMANO').encaminhar).toBe(true);
  const pausa=passo('Aguarde um momento',estado,[],'PAUSAR');
  expect(pausa.leitura.aguardar).toBe(true);
  expect(pausa.encaminhar).toBe(false);
});

test.each(['Se eu não pago impostos, tenho dívida?', 'Meu amigo disse: não pago impostos', 'Não tenho pendências'])('não presume dívida: %s',texto=>{
  const r=passo(texto,base,[]);
  expect(r.pre.investigacaoPendencias).toBeFalsy();
});

test('abertura não recebe etapas fiscais e investigação tem limite explícito',()=>{
  expect(ordemQualificacao({...base,intencao:'ABERTURA',investigacaoPendencias:true})).not.toContain('periodoPendencias');
  expect(passo('Não lembro',{...base,necessidade:'não pago',investigacaoPendencias:true,perguntasFeitas:11,campoEsperado:'periodoPendencias'},[],'DESCONHECIDO').encaminhar).toBe(true);
});

test('relato real empresa toda atrasada ativa investigação desde o primeiro contato',()=>{
  let r=passo('Quero ativar minha empresa esta toda atrasada',{qualificacaoVersao:2,intencao:'INATIVA'},
    [['necessidade','minha empresa esta toda atrasada']]);
  expect(r.pre.investigacaoPendencias).toBe(true);
  expect(r.pre.campoEsperado).toBe('cnpj');
  r=passo('11.222.333/0001-81',r.pre,[],'DADOS','m2');
  expect(r.pre.campoEsperado).toBe('periodoPendencias');
});

test('atraso do contador em responder não presume pendência fiscal',()=>{
  const r=passo('O contador atrasou a resposta',base,[['necessidade','O contador atrasou a resposta']]);
  expect(r.pre.investigacaoPendencias).toBeFalsy();
  expect(r.pre.campoEsperado).toBe('estrutura');
});

test('pedido de ajuda após declaração de não pagamento mantém investigação',()=>{
  const texto='Não pago os impostos desde 2022, vocês podem me ajudar?';
  const r=passo(texto,base,[['necessidade',texto],['periodoPendencias','desde 2022'],['tipoPendencias','impostos']]);
  expect(r.pre.investigacaoPendencias).toBe(true);
  expect(r.pre.campoEsperado).toBe('situacaoOperacional');
});

test('desconhecimento citado de terceiro não dispensa obrigações do cliente',()=>{
  const r=passo('Meu sócio disse: não sei quais impostos',{...base,investigacaoPendencias:true,necessidade:'Não pago impostos',
    periodoPendencias:'desde 2022',campoEsperado:'tipoPendencias'},[],'DESCONHECIDO');
  expect(r.pre.dispensados).not.toContain('tipoPendencias');
  expect(r.pre.campoEsperado).toBe('tipoPendencias');
});

test.each(['Se eu não pago impostos, vocês ajudam?', 'Não pago impostos?', 'Vocês ajudam quem não paga impostos, mesmo assim?'])('pergunta hipotética não ativa pendências: %s',texto=>{
  expect(passo(texto,base,[]).pre.investigacaoPendencias).toBeFalsy();
});

test('negar dívidas não apaga relato simultâneo de não pagamento',()=>{
  const texto='Não tenho dívidas mas não pago impostos desde 2022';
  expect(passo(texto,base,[['necessidade',texto]]).pre.investigacaoPendencias).toBe(true);
});

test('não saber quais obrigações permite aproveitar período declarado',()=>{
  const r=passo('Não sei quais, parei em 2022',{...base,investigacaoPendencias:true,necessidade:'Não pago impostos',campoEsperado:'tipoPendencias'},
    [['periodoPendencias','em 2022']]);
  expect(r.pre.periodoPendencias).toBe('em 2022');
  expect(r.pre.dispensados).toContain('tipoPendencias');
  expect(r.pre.campoEsperado).toBe('situacaoOperacional');
});

test.each(['faz tempo','há muito tempo','há bastante tempo','há anos','há meses'])('período impreciso pede esclarecimento uma vez: %s',periodo=>{
  const texto=`Trabalho sozinho, mas ${periodo} que não pago nada`;
  let r=passo(texto,{...base,necessidade:'Quero voltar a operar',campoEsperado:'estrutura'},
    [['estrutura','sozinho'],['periodoPendencias',periodo]]);
  expect(r.pre.campoEsperado).toBe('periodoPendencias');
  expect(r.pre.periodoPendencias).toBe(periodo);
  expect(r.pre.periodoPendenciasEsclarecimentoPerguntado).toBe(true);
  r=passo(periodo,r.pre,[['periodoPendencias',periodo]],'DADOS','m2');
  expect(r.pre.campoEsperado).toBe('tipoPendencias');
  expect(r.pre.dispensados).toContain('periodoPendencias');
});

test.each(['Não lembro','Prefiro não informar'])('esclarecimento respeita recusa preservando período vago: %s',texto=>{
  const estado={...base,necessidade:'Não pago',investigacaoPendencias:true,periodoPendencias:'faz tempo',
    periodoPendenciasEsclarecimentoPerguntado:true,campoEsperado:'periodoPendencias'};
  const r=passo(texto,estado,[],'DESCONHECIDO');
  expect(r.pre.campoEsperado).toBe('tipoPendencias');
  expect(r.pre.periodoPendencias).toBe('faz tempo');
});

test('período concreto vence comentário vago posterior e aceita correção explícita',()=>{
  const anterior={...base,necessidade:'Não pago',investigacaoPendencias:true,periodoPendencias:'desde 2022',campoEsperado:'tipoPendencias'};
  let r=passo('Já faz tempo',anterior,[['periodoPendencias','faz tempo']]);
  expect(r.pre.periodoPendencias).toBe('desde 2022');
  expect(r.pre.campoEsperado).toBe('tipoPendencias');
  r=passo('Corrigindo, faz tempo, não lembro desde quando',anterior,[['periodoPendencias','faz tempo']]);
  expect(r.pre.periodoPendencias).toBe('faz tempo');
  expect(r.pre.dispensados).toContain('periodoPendencias');
});

test('esclarecimento concreto substitui vago sem inventar nem dispensar o dado',()=>{
  const r=passo('Desde 2022',{...base,necessidade:'Não pago',investigacaoPendencias:true,periodoPendencias:'faz tempo',
    periodoPendenciasEsclarecimentoPerguntado:true,campoEsperado:'periodoPendencias'},[['periodoPendencias','Desde 2022']]);
  expect(r.pre.periodoPendencias).toBe('Desde 2022');
  expect(r.pre.dispensados).not.toContain('periodoPendencias');
  expect(r.pre.campoEsperado).toBe('tipoPendencias');
});

test('primeiro contato completo preserva relato mesmo quando IA classifica necessidade genérica',()=>{
  const texto='Quero regularizar minha empresa. Não pago os impostos desde 2022, continuo atendendo normalmente, trabalho sozinho';
  const r=passo(texto,base,[['necessidade','Quero regularizar minha empresa'],['periodoPendencias','desde 2022'],['tipoPendencias','impostos'],
    ['situacaoOperacional','continuo atendendo normalmente'],['estrutura','trabalho sozinho']]);
  expect(r.pre.necessidade).toBe(texto);
  expect(r.pre.evidenciasDeclaradas.necessidade.trecho).toBe(texto);
  expect(r.pre.campoEsperado).toBe('urgencia');
});

test('desconhecimento não perde turno por intenção herdada de mensagem anterior',()=>{
  const r=prepararPreatendimento({texto:'Não lembro',intencao:'INATIVA',anterior:{...base,necessidade:'Não pago nada',investigacaoPendencias:true,campoEsperado:'periodoPendencias'},
    interpretacaoIa:{intencao:'INATIVA',evidenciaIntencao:'Quero regularizar minha empresa, não pago nada',comportamento:'DESCONHECIDO',dados:[],resposta:null}});
  expect(r.encaminhar).toBe(false);
  expect(r.pre.dispensados).toContain('periodoPendencias');
  expect(r.pre.campoEsperado).toBe('tipoPendencias');
});

test.each(['não pago nada','tudo','nada','tudo atrasado'])('tipo genérico não substitui pergunta de obrigações: %s',tipo=>{
  const texto=`Não pago nada, ${tipo}`;
  let r=passo(texto,base,[['necessidade',texto],['tipoPendencias',tipo]]);
  expect(r.pre.tipoPendencias).toBeUndefined();
  expect(r.pre.evidenciasIa.tipoPendencias).toBeUndefined();
  expect(r.pre.relatosCliente[0].texto).toBe(texto);
  r=passo('Não lembro',r.pre,[],'DESCONHECIDO','m2');
  expect(r.pre.campoEsperado).toBe('tipoPendencias');
  r=passo('Não sei quais',r.pre,[],'DESCONHECIDO','m3');
  expect(r.pre.dispensados).toContain('tipoPendencias');
  expect(r.pre.campoEsperado).toBe('situacaoOperacional');
});

test('todos os impostos identifica tipo sem inventar impostos específicos',()=>{
  const r=passo('Não pago todos os impostos',base,[['tipoPendencias','todos os impostos']]);
  expect(r.pre.tipoPendencias).toBe('todos os impostos');
});

test('comentário genérico preserva tipo específico já declarado',()=>{
  const r=passo('Não pago nada',{...base,tipoPendencias:'guias mensais'},[['tipoPendencias','Não pago nada']]);
  expect(r.pre.tipoPendencias).toBe('guias mensais');
});

test('faturamento não presume retomada quando operação é desconhecida ou dispensada',()=>{
  expect(perguntasQualificacao({...base,dispensados:['situacaoOperacional']}).faturamento).not.toMatch(/retomada|voltar|parada/i);
});
