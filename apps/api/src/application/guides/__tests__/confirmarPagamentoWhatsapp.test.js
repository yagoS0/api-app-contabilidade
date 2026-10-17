import { versaoPagamentoGuia } from '../ConfirmacaoPagamentoClienteService.js';
import { confirmarPagamentoWhatsapp,lerDataWhatsapp,chaveFluxoPagamento } from '../ConfirmarPagamentoWhatsappService.js';
const id='altan.payment.confirm.11111111-1111-4111-8111-111111111111';
function preparar(){const value={companyId:'c',guideId:'g',contatoId:'ct',telefone:'5511999999999',expiraEm:'2026-10-01T00:00:00Z'};const rows=new Map([[id,value]]);const guia={id:'g',portalClientId:'c',status:'PROCESSED',liberadaCliente:true,tipo:'FGTS',competencia:null,paymentStatus:'OPEN',updatedAt:new Date(),baixada:false};
 value.versaoPagamento=versaoPagamentoGuia(guia);
 const tx={estornoBaixa:{findFirst:jest.fn(async()=>null)},appSetting:{findMany:jest.fn(async({where})=>[...rows].filter(([key])=>key.startsWith(where.key.startsWith)).map(([key,value])=>({key,value:structuredClone(value)}))),updateMany:jest.fn(async({where,data})=>{if(JSON.stringify(rows.get(where.key))!==JSON.stringify(where.value.equals))return{count:0};rows.set(where.key,data.value);return{count:1};}),findUnique:jest.fn(async({where})=>rows.has(where.key)?{value:rows.get(where.key)}:null),create:jest.fn(async({data})=>rows.set(data.key,data.value)),update:jest.fn(async({where,data})=>rows.set(where.key,data.value)),upsert:jest.fn(async({where,create,update})=>rows.set(where.key,rows.has(where.key)?update.value:create.value))},contatoWhatsapp:{findFirst:jest.fn(async()=>({id:'ct',userId:null}))},accountingEntry:{findMany:jest.fn(async()=>[])},companyMonthlyCircular:{findUnique:jest.fn(async()=>null)},guide:{findFirst:jest.fn(async()=>guia),updateMany:jest.fn(async({data})=>{Object.assign(guia,data);return{count:1};})},arquivoWhatsapp:{findUnique:jest.fn(async()=>({id:'ar',portalClientId:'c'})),updateMany:jest.fn(async()=>({count:1}))}};
 const client={...tx,$transaction:jest.fn(fn=>fn(tx))};const args={id,conversa:{id:'cv',portalClientId:'c',telefoneE164:value.telefone},mensagem:{id:'m',tipo:'interactive',direcao:'in',conversaId:'cv'},client,conferirAcesso:jest.fn(async()=>{}),agora:new Date('2026-09-25T12:00:00Z')};let seq=0;
 return{value,rows,guia,tx,args,run:()=>confirmarPagamentoWhatsapp(args),responder:async(corpo,extra={})=>{args.id=null;args.mensagem={...args.mensagem,id:'r'+(++seq),tipo:'text',corpo,...extra};return confirmarPagamentoWhatsapp(args);}};
}
test('clique pede data; resposta válida registra declaração e pendência se faltar composição',async()=>{const f=preparar();expect((await f.run()).texto).toContain('Em que data');expect(f.tx.guide.updateMany).not.toHaveBeenCalled();expect((await f.responder('20/09/2026')).texto).toContain('20/09/2026');expect(f.guia).toMatchObject({paymentStatus:'PAID',paymentStatusSource:'CLIENTE',paymentConfirmedAt:new Date('2026-09-20'),baixada:false});await f.run();expect(f.tx.guide.updateMany).toHaveBeenCalledTimes(1);await f.responder('sem comprovante');expect(f.rows.get(chaveFluxoPagamento(f.args.conversa)).etapa).toBeNull();});
test.each(['31/02/2026','26/09/2026','ontem','15'])('data %s não inventa pagamento',async data=>{const f=preparar();await f.run();await f.responder(data);expect(f.tx.guide.updateMany).not.toHaveBeenCalled();});
test.each(['empresa','telefone','expirado','contato','guia','saida'])('recusa %s',async tipo=>{const f=preparar();if(tipo==='empresa')f.args.conversa.portalClientId='outra';if(tipo==='telefone')f.args.conversa.telefoneE164='outro';if(tipo==='expirado')f.value.expiraEm='2026-09-20';if(tipo==='contato')f.tx.contatoWhatsapp.findFirst.mockResolvedValue(null);if(tipo==='guia')f.tx.guide.findFirst.mockResolvedValue(null);if(tipo==='saida')f.args.mensagem.direcao='out';expect((await f.run()).texto).toContain('Não foi possível');expect(f.tx.guide.updateMany).not.toHaveBeenCalled();});
test('comprovante fica vinculado sem substituir declaração por prova automática',async()=>{const f=preparar();await f.run();await f.responder('20/09/2026');await f.responder('',{tipo:'image',midiaProvedorId:'123'});expect(f.tx.arquivoWhatsapp.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({comprovanteGuiaId:'g',dataPagamentoDeclarada:new Date('2026-09-20')})}));expect(f.guia.paymentStatusSource).toBe('CLIENTE');});
test('não vincula arquivo de outra empresa',async()=>{const f=preparar();await f.run();await f.responder('20/09/2026');f.tx.arquivoWhatsapp.findUnique.mockResolvedValue({id:'ar',portalClientId:'outro'});await f.responder('',{tipo:'document',midiaProvedorId:'123'});expect(f.tx.arquivoWhatsapp.updateMany).not.toHaveBeenCalled();});
test('hoje respeita o calendário de São Paulo na virada UTC',()=>{expect(lerDataWhatsapp('hoje',new Date('2026-09-26T01:00Z')).data).toEqual(new Date('2026-09-25'));});
test('pagamento oficial concorrente é preservado',async()=>{const f=preparar();await f.run();Object.assign(f.guia,{paymentStatus:'PAID',paymentStatusSource:'SERPRO'});await f.responder('20/09/2026');expect(f.tx.guide.updateMany).not.toHaveBeenCalled();});
test('cancelamento não marca como paga',async()=>{const f=preparar();await f.run();await f.responder('cancelar pagamento');expect(f.tx.guide.updateMany).not.toHaveBeenCalled();});
test('revogação antes da gravação impede a declaração',async()=>{const f=preparar();await f.run();f.args.conferirAcesso.mockRejectedValueOnce(Error('revogado'));await expect(f.responder('20/09/2026')).rejects.toThrow('revogado');expect(f.tx.guide.updateMany).not.toHaveBeenCalled();});

test('arquivo sem empresa só é atribuído com origem no mesmo telefone e canal',async()=>{const f=preparar();await f.run();await f.responder('20/09/2026');f.tx.arquivoWhatsapp.findUnique.mockResolvedValue({id:'ar',portalClientId:null,mensagem:{conversa:{telefoneE164:f.args.conversa.telefoneE164,canalId:'principal'}}});await f.responder('',{tipo:'image',midiaProvedorId:'123'});expect(f.tx.arquivoWhatsapp.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({portalClientId:null}),data:expect.objectContaining({portalClientId:'c',comprovanteGuiaId:'g'})}));});

async function apertar(f, botao) {
 f.args.id=botao.id;
 f.args.mensagem={...f.args.mensagem,id:f.args.mensagem.id+'-clique',tipo:'interactive',corpo:botao.titulo};
 return f.run();
}
test('oferece três datas e conclui Hoje e Sem comprovante por botões',async()=>{
 const f=preparar(),r=await f.run();
 expect(r.botoes.map(b=>b.titulo)).toEqual(['Hoje','Data de vencimento','Digitar uma data']);
 const proxima=await apertar(f,r.botoes[0]);
 expect(f.guia.paymentConfirmedAt).toEqual(new Date('2026-09-25'));
 expect(proxima.botoes.map(b=>b.titulo)).toEqual(['Sem comprovante']);
 await apertar(f,proxima.botoes[0]);
 expect(f.rows.get(chaveFluxoPagamento(f.args.conversa)).etapa).toBeNull();
 expect(f.guia.baixada).toBe(false);
});
test('vencimento de sábado usa sexta e ignora o título do botão',async()=>{
 const f=preparar();f.guia.vencimento=new Date('2026-09-26');
 f.tx.portalClient={findUnique:jest.fn(async()=>({municipio:null}))};f.tx.feriado={findMany:jest.fn(async()=>[])};
 const r=await f.run();await apertar(f,{...r.botoes[1],titulo:'01/01/2000'});
 expect(f.guia.paymentConfirmedAt).toEqual(new Date('2026-09-25'));
});
test('vencimento futuro recusa confirmação e conserva botões',async()=>{
 const f=preparar();f.guia.vencimento=new Date('2026-09-28');
 f.tx.portalClient={findUnique:jest.fn(async()=>({municipio:null}))};f.tx.feriado={findMany:jest.fn(async()=>[])};
 const r=await f.run(),resposta=await apertar(f,r.botoes[1]);
 expect(resposta.botoes).toHaveLength(3);expect(f.tx.guide.updateMany).not.toHaveBeenCalled();
});
test('digitar data não confirma até receber a data válida',async()=>{
 const f=preparar(),r=await f.run();
 expect((await apertar(f,r.botoes[2])).texto).toMatch(/DD\/MM\/AAAA/);
 expect(f.tx.guide.updateMany).not.toHaveBeenCalled();
 expect((await f.responder('20/09/2026')).botoes[0].titulo).toBe('Sem comprovante');
});
test('botão de etapa anterior não altera a data já registrada',async()=>{
 const f=preparar(),r=await f.run();await apertar(f,r.botoes[0]);
 expect((await apertar(f,r.botoes[1])).texto).toMatch(/etapa anterior/);
 expect(f.tx.guide.updateMany).toHaveBeenCalledTimes(1);
});
test('botão de confirmação reiniciada não pode usar o fluxo atual',async()=>{
 const f=preparar(),r=await f.run();f.args.id=id;f.args.mensagem.id='reinicio';await f.run();
 expect((await apertar(f,r.botoes[0])).texto).toMatch(/etapa anterior/);
 expect(f.tx.guide.updateMany).not.toHaveBeenCalled();
});
test('Sem comprovante não pode anteceder a data nem iniciar confirmação sem fluxo',async()=>{
 const f=preparar(),r=await f.run();const falso={...r.botoes[0],id:r.botoes[0].id.replace('.today.','.no_proof.')};
 expect((await apertar(f,falso)).texto).toMatch(/etapa anterior/);
 f.rows.delete(chaveFluxoPagamento(f.args.conversa));
 expect((await apertar(f,r.botoes[0])).texto).toMatch(/Não foi possível/);
 expect(f.tx.guide.updateMany).not.toHaveBeenCalled();
});

test('botão legado sem versão persistida não inicia confirmação',async()=>{const f=preparar();delete f.value.versaoPagamento;expect((await f.run()).texto).toContain('Solicite uma nova confirmação');expect(f.tx.guide.updateMany).not.toHaveBeenCalled();expect(f.tx.appSetting.upsert).not.toHaveBeenCalled();});
test.each(['antes','durante'])('alteração de composição com mesmo PDF %s da conversa invalida botão',async momento=>{const f=preparar();if(momento==='durante')await f.run();f.guia.extracted={fields:{principal:100,juros:10,multa:5,total:115}};const r=momento==='durante'?await f.responder('20/09/2026'):await f.run();expect(r.texto).toContain('Solicite uma nova confirmação');expect(f.tx.guide.updateMany).not.toHaveBeenCalled();});

test('guia corrigida exige novo botão e nova data; token anterior não duplica nem reabre',async()=>{
 const f=preparar();await f.run();await f.responder('20/09/2026');const anterior=[...f.rows.values()].find(v=>v.politica);
 f.guia.extracted={fields:{principal:100,juros:10,multa:5,total:115}};f.guia.valor=115;
 f.args.id=id;f.args.mensagem.id='velho-apos-correcao';const oferta=await f.run();expect(oferta.texto).toContain('não pague novamente');expect(oferta.botoes).toHaveLength(1);expect(f.tx.guide.updateMany).toHaveBeenCalledTimes(1);
 const tokenNovo=f.rows.get(oferta.botoes[0].id);expect(tokenNovo).toMatchObject({reconfirmaConfirmacaoId:anterior.id,versaoPagamento:versaoPagamentoGuia(f.guia),companyId:'c',guideId:'g',contatoId:'ct'});
 const pergunta=await apertar(f,oferta.botoes[0]);expect(pergunta.texto).toContain('Em que data');expect(f.tx.guide.updateMany).toHaveBeenCalledTimes(1);
 await f.responder('20/09/2026');expect(f.tx.guide.updateMany).toHaveBeenCalledTimes(2);expect(f.rows.get(`contabil:cliente:estado:c:${anterior.id}`).estadoBaixa).toBe('SUBSTITUIDA');
 f.args.id=id;f.args.mensagem.id='velho-apos-reconfirmacao';expect((await f.run()).texto).toContain('Não foi possível');expect(f.tx.guide.updateMany).toHaveBeenCalledTimes(2);
});
test('token legado sem versão nunca oferece reconfirmação de pendência R25',async()=>{const f=preparar();await f.run();await f.responder('20/09/2026');f.guia.hash='nova';delete f.value.versaoPagamento;const t=f.rows.get(id);delete t.versaoPagamento;f.args.id=id;f.args.mensagem.id='legado';const r=await f.run();expect(r.texto).toContain('Não foi possível');expect(r.botoes).toBeUndefined();expect(f.tx.guide.updateMany).toHaveBeenCalledTimes(1);});
