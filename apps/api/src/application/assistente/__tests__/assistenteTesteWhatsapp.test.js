import { responderTesteWhatsapp } from '../AssistenteTesteWhatsappService.js';
import { CAMPOS_INTERNOS } from '@contabilidade/shared/onboarding';

test('sessão simulada não oferece nem altera decisões internas retiradas da coleta', async () => {
  const assistente = { responder: async op => {
    const contexto = JSON.parse(op.system[0].text.split('Contexto: ')[1]);
    expect(contexto.campos.some(c => CAMPOS_INTERNOS.includes(c.campo))).toBe(false);
    expect(await op.executar('registrar_atendimento', { campos: [{ campo: 'consultoriaMensal', acao: 'set', valor: false }] })).toMatchObject({ ok: false });
    expect(await op.executar('registrar_atendimento', { campos: [{ campo: 'responsavelNome', acao: 'set', valor: 'Ana Teste' }] })).toMatchObject({ ok: true });
    return { texto: 'A equipe vai conferir as informações.', stopReason: 'end_turn' };
  } };
  const r = await responderTesteWhatsapp({ historico: [], texto: 'Meu nome é Ana Teste', contexto: { dados: { consultoriaMensal: true } }, assistente });
  expect(r.contexto.dados.consultoriaMensal).toBe(true);
  expect(r.contexto.dados.responsavelNome).toBe('Ana Teste');
});
test('menu e abertura usam comportamento automático; dúvida usa prompt comercial e ferramenta sandbox',async()=>{
 const assistente={responder:jest.fn(async op=>{
   expect(op.system[0].text).toContain('registrar_atendimento');
   expect(await op.executar('emitir_nota',{companyId:'real'})).toMatchObject({ok:false});
   expect(await op.executar('registrar_atendimento',{})).toMatchObject({teste:true});
   return {texto:'O contador pode explicar as modalidades.',stopReason:'end_turn'};
 })};
 const menu=await responderTesteWhatsapp({historico:[],texto:'Olá',assistente});expect(menu.origem).toBe('automatica');
 const abertura=await responderTesteWhatsapp({historico:[],texto:'Quero abrir uma empresa de consultoria',assistente});expect(abertura.origem).toBe('automatica');
 const ia=await responderTesteWhatsapp({historico:[],texto:'Vocês atendem online?',contexto:abertura.contexto,assistente});expect(ia.origem).toBe('ia');
 const handoff=await responderTesteWhatsapp({historico:[],texto:'Quero falar com o contador',contexto:ia.contexto,assistente});expect(handoff.contexto.humano).toBe(true);expect(assistente.responder).toHaveBeenCalledTimes(1);
});
test('modelo sem ferramenta, valores inventados e recusa não confirmam atos',async()=>{
 const r=await responderTesteWhatsapp({historico:[],texto:'Quanto custa?',assistente:{responder:async()=>({texto:'Custa R$ 50',stopReason:'end_turn'})}});
 expect(r.contexto.humano).toBe(true);expect(r.texto).toContain('fictício');
});
