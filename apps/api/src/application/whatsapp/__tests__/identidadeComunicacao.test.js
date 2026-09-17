import { classificarRelacionamento } from '../ClassificacaoAtendimentoService.js';

const vinculoNumero = { id:'v1',interlocutorId:'p1',encerrouEm:null };
const interlocutor = { id:'p1',tipo:'NAO_VERIFICADO',estado:'ATIVO',versao:3 };
const contato = { id:'ct1',nome:'Contato',ativo:true,portalClientId:'empresa1',vinculoNumeroId:'v1',userId:null };
const caso = { id:'caso1',onboardingId:'onb1',encerradoEm:null,onboarding:{origem:'ABERTURA',status:'COLETA'} };
const decidir = extra => classificarRelacionamento({vinculoNumero,interlocutor,...extra});

describe('relacionamento é evidência, não permissão', () => {
  test('contato cadastrado sem portal é cliente, sem inventar autorização', () => {
    const r=decidir({contatos:[contato]});
    expect(r.relacionamento.tipo).toBe('CLIENTE');
    expect(r.identidade.estado).toBe('RECONHECIDA_NO_CADASTRO');
    expect(r).not.toHaveProperty('papel');
    expect(r).not.toHaveProperty('podeEmitir');
  });
  test('número desconhecido não é lead', () => expect(decidir({}).relacionamento.tipo).toBe('A_IDENTIFICAR'));
  test('intenção comercial confirmada cria lead sem validar identidade civil', () => {
    const r=decidir({caso});expect(r.relacionamento.tipo).toBe('LEAD');expect(r.identidade.estado).toBe('NAO_VERIFICADA');
  });
  test('cliente pode abrir outra empresa sem virar lead', () => {
    const r=decidir({contatos:[contato],caso});expect(r.relacionamento.tipo).toBe('CLIENTE');expect(r.solicitacaoComercial.origem).toBe('ABERTURA');
  });
  test('três empresas continuam um cliente, empresa selecionada não é requisito', () => expect(decidir({contatos:[contato,{...contato,id:'ct2',portalClientId:'empresa2'}]}).relacionamento.tipo).toBe('CLIENTE'));
  test('cadastro antigo não vira novo lead', () => {
    const r=decidir({contatos:[{...contato,ativo:false}]});expect(r.relacionamento.tipo).toBe('A_IDENTIFICAR');expect(r.relacionamento.motivo).toBe('CADASTRO_ANTERIOR');
  });
  test('nova vigência não herda contatos antigos', () => expect(decidir({vinculoNumero:{...vinculoNumero,id:'v2'},contatos:[contato]}).relacionamento.tipo).toBe('A_IDENTIFICAR'));
  test('usuários divergentes exigem revisão sem perder rótulo comunicação', () => {
    const r=decidir({contatos:[{...contato,userId:'u1'},{...contato,id:'ct2',portalClientId:'empresa2',userId:'u2'}]});expect(r.relacionamento.tipo).toBe('CLIENTE');expect(r.identidade.estado).toBe('EM_REVISAO');
  });
  test('compartilhado não afirma pessoa individual', () => expect(decidir({interlocutor:{...interlocutor,tipo:'COMPARTILHADO'},contatos:[contato]}).identidade.estado).toBe('COMPARTILHADA'));
  test('caso encerrado não declara interesse atual', () => expect(decidir({caso:{...caso,encerradoEm:new Date()}}).relacionamento.tipo).toBe('A_IDENTIFICAR'));
  test('suspensão operacional não reclassifica cadastro como lead', () => expect(decidir({contatos:[{...contato,portalClient:{status:'SUSPENSA'}}]}).relacionamento.tipo).toBe('CLIENTE'));
});
