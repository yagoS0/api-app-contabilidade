
import { prepararRetomadaAtendimento, solicitarModeloRetomada, MODELO_RETOMADA } from '../RetomadaAtendimentoService.js';
const conversa={id:'cv',telefoneE164:'5521999990000',canalId:'principal',vinculoNumeroId:'v1'};
const modelo={...MODELO_RETOMADA,id:'m1',status:'APPROVED'};
const args=(extra={})=>({conversa,client:{templateWhatsapp:{findUnique:jest.fn(async()=>({nomeMeta:null,statusAprovacao:'EM_ANALISE',idioma:'pt_BR'}))}},consultarModelo:jest.fn(async()=>modelo),...extra});
test('modelo real com assunto e botão produz prévia completa e campos da Meta',async()=>{
 const a=args({assunto:'o envio das guias'}),r=await prepararRetomadaAtendimento(a);
 expect(a.consultarModelo).toHaveBeenCalledWith('reabrir_conversa',conversa,'pt_BR');
 expect(r).toMatchObject({disponivel:true,categoria:'MARKETING',variaveis:['o envio das guias'],botoes:['Falar com a equipe'],botoesResposta:['altan.client.human.v1']});
 expect(r.texto).toContain('sobre o envio das guias.');expect(r.texto).not.toContain('{{');expect(JSON.stringify(r)).not.toContain('body_text');
});
test('assunto, telefone, vínculo, canal e conteúdo aprovados fazem parte do hash',async()=>{
 const a=args({assunto:'documentos'}),base=await prepararRetomadaAtendimento(a);
 for(const extra of [{assunto:'guias'},{conversa:{...conversa,telefoneE164:'5521999990001'}},{conversa:{...conversa,vinculoNumeroId:'v2'}},{conversa:{...conversa,canalId:'comercial'}},{consultarModelo:async()=>({...modelo,category:'UTILITY'})}]) {
  const r=await prepararRetomadaAtendimento({...a,...extra});expect(r.disponivel).toBe(true);expect(r.previaHash).not.toBe(base.previaHash);
 }
});
test.each(['', '   ', 'a'.repeat(121), 'guias\nproposta', '{{2}}', {assunto:'x'}])('assunto inválido não autoriza envio: %j',async assunto=>{
 expect(await prepararRetomadaAtendimento(args({assunto}))).toMatchObject({disponivel:false,requerAssunto:true,motivo:'ASSUNTO_OBRIGATORIO'});
});
test.each([
 [{type:'BODY',text:'Assunto {{2}}'}], [{type:'BODY',text:'Assunto {{nome}}'}],
 [{type:'HEADER',format:'IMAGE'},{type:'BODY',text:'Oi'}],
 [{type:'BODY',text:'Oi'},{type:'BUTTONS',buttons:[{type:'URL',text:'Site',url:'https://example.com'}]}],
 [{type:'BODY',text:'Oi'},{type:'BODY',text:'Outro'}]
])('recusa formatos que não consegue representar na prévia',async (...components)=>{
 expect(await prepararRetomadaAtendimento(args({consultarModelo:async()=>({...modelo,components})}))).toMatchObject({disponivel:false,motivo:'MODELO_REQUER_PARAMETROS'});
});
test.each(['PENDING','REJECTED','PAUSED','DISABLED'])('Meta %s não permite envio',async status=>{
 expect(await prepararRetomadaAtendimento(args({consultarModelo:async()=>({...modelo,status})}))).toMatchObject({disponivel:false,statusMeta:status});
});
test('modelo ausente no comercial não herda aprovação do escritório',async()=>{
 expect(await prepararRetomadaAtendimento(args({conversa:{...conversa,canalId:'comercial'},consultarModelo:async()=>null}))).toMatchObject({disponivel:false,podeSolicitarAprovacao:true,statusMeta:'AUSENTE'});
});
test('erro de rede nunca vira modelo ausente nem libera criação',async()=>{
 const r=await prepararRetomadaAtendimento(args({consultarModelo:async()=>{throw Error('token-secreto');}}));expect(r.disponivel).toBe(false);expect(r.podeSolicitarAprovacao).toBeUndefined();expect(JSON.stringify(r)).not.toContain('token-secreto');
});
test('solicitação reutiliza modelo já criado e não reenvia após resposta incerta',async()=>{
 let salvo=null;const criarModelo=jest.fn(async m=>{salvo={...m,id:'novo',status:'PENDING'};throw Error('resposta incerta');});
 const a=args({consultarModelo:async()=>salvo,criarModelo});
 await expect(solicitarModeloRetomada(a)).rejects.toThrow('resposta incerta');
 expect(await solicitarModeloRetomada(a)).toMatchObject({disponivel:false,statusMeta:'PENDING'});expect(criarModelo).toHaveBeenCalledTimes(1);expect(criarModelo).toHaveBeenCalledWith(MODELO_RETOMADA);
});
test('submissão fixa não declara aprovação com base no retorno do POST',async()=>{
 const a=args({consultarModelo:async()=>null,criarModelo:jest.fn(async()=>({status:'APPROVED'}))});
 expect(await solicitarModeloRetomada(a)).toMatchObject({disponivel:false,statusMeta:'PENDING'});
});
