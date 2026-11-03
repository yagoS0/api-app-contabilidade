import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {OperationsGuideActions} from '../OperationsGuideActions';
const row={company:{companyId:'a',razao:'Alfa',myRole:'ACCOUNTANT'}};
test('consulta explicitamente somente OPEN da competência e empresa selecionadas',async()=>{
 const api={buscarPagamentoGuia:jest.fn(async()=>({ok:true}))};
 const guides=[['open','OPEN','2026-10'],['paid','PAID','2026-10'],['old','OPEN','2026-09']].map(([guideId,paymentStatus,competencia])=>({companyId:'a',guideId,paymentStatus,competencia}));
 render(<OperationsGuideActions api={api} rows={[row]} selected={{a:true}} data={{a:{guides}}} competencia="2026-10" stage="pago"/>);
 expect(api.buscarPagamentoGuia).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Consultar pagamentos'));expect(api.buscarPagamentoGuia).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Confirmar ação nos itens listados'));
 await waitFor(()=>expect(api.buscarPagamentoGuia).toHaveBeenCalledTimes(1));expect(api.buscarPagamentoGuia).toHaveBeenCalledWith('open');
});
test('envio preserva token, ordem, revisão conferida e recusa sem chamada no mount',async()=>{
 const api={listarContatosWhatsapp:jest.fn(async()=>({canalPadraoEnvio:'EMAIL',contatos:[]})),previewOperationsGuideSend:jest.fn(async()=>({preview:{companyId:'a',competencia:'2026-10',token:'signed',items:[{guideId:'g',revisao:'v2',reenviarConfirmado:false,canais:['EMAIL'],destinatarios:{emails:['fixture@example.invalid'],telefones:[]}}],refused:[]}})),sendGuidesTask:jest.fn(async()=>[{guideId:'g',ok:false,texto:'WhatsApp: solicitação aceita',email:{sent:true,message:'Aceito'},whatsapp:{ok:true,parcial:true,aceitas:1,falhas:1,resultados:[{ok:false,destino:'fixture@example.invalid',message:'Falha local'}]}}])};
 render(<OperationsGuideActions api={api} rows={[row]} selected={{a:true}} data={{a:{guides:[{companyId:'a',competencia:'2026-10',guideId:'g',paymentStatus:'OPEN'}]}}} competencia="2026-10" stage="enviado"/>);
 expect(api.previewOperationsGuideSend).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Conferir envio / reenvio'));await screen.findByText(/fixture@example.invalid/);expect(api.sendGuidesTask).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Confirmar ação nos itens listados'));await waitFor(()=>expect(api.sendGuidesTask).toHaveBeenCalledWith('a',{items:[{guideId:'g',reenviarConfirmado:false}],competencia:'2026-10',operationsPreviewToken:'signed',whatsappRequested:false}));await screen.findByText(/WhatsApp parcialmente aceito/);
});

const guide={companyId:'a',competencia:'2026-10',guideId:'g',paymentStatus:'OPEN'};
function sendFixture(canalPadraoEnvio='EMAIL',contatos=[]) {
 return {listarContatosWhatsapp:jest.fn(async()=>({canalPadraoEnvio,contatos})),previewOperationsGuideSend:jest.fn(async(companyId,competencia,body)=>({preview:{companyId,competencia,token:'token-'+companyId,items:body.items.map(i=>({...i,revisao:'v2',canais:['EMAIL',...(body.whatsappRequested?['WHATSAPP']:[])],destinatarios:{emails:['fixture@example.invalid'],telefones:[]}})),refused:[]}})),sendGuidesTask:jest.fn(async()=>[{guideId:'g',ok:true,texto:'E-mail aceito, confira a entrega.'}])};
}
function mount(api,extra={}) {return render(<OperationsGuideActions api={api} rows={[row]} selected={{a:true}} data={{a:{guides:[guide]}}} competencia="2026-10" stage="enviado" {...extra}/>);}
test.each([['EMAIL',[],false],['WHATSAPP',[],true],['EMAIL',[{ativo:true,telefoneE164:'+5500000000000'}],true],['PERGUNTAR',[],false]])('preferência %s e contatos ativos determinam canais reais',async(canal,contatos,expected)=>{
 const api=sendFixture(canal,contatos);mount(api);fireEvent.click(screen.getByText('Conferir envio / reenvio'));await screen.findByText(/fixture@example.invalid/);expect(api.previewOperationsGuideSend.mock.calls[0][2].whatsappRequested).toBe(expected);expect(api.sendGuidesTask).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Confirmar ação nos itens listados'));await waitFor(()=>expect(api.sendGuidesTask).toHaveBeenCalledTimes(1));expect(api.sendGuidesTask.mock.calls[0][1].whatsappRequested).toBe(expected);
});
test('PERGUNTAR permite decisão explícita e conserva token por empresa',async()=>{
 const api=sendFixture('PERGUNTAR');mount(api);fireEvent.click(screen.getByLabelText('Para preferência PERGUNTAR: incluir WhatsApp'));fireEvent.click(screen.getByText('Conferir envio / reenvio'));await screen.findByText(/fixture@example.invalid/);expect(api.previewOperationsGuideSend.mock.calls[0][2].whatsappRequested).toBe(true);
});
test('destinatário alterado recusa a saída e resultado incerto não repete automaticamente',async()=>{
 const api=sendFixture();api.sendGuidesTask.mockRejectedValue(Error('Destinatário alterado; nova conferência necessária'));mount(api);fireEvent.click(screen.getByText('Conferir envio / reenvio'));await screen.findByText(/fixture@example.invalid/);fireEvent.click(screen.getByText('Confirmar ação nos itens listados'));await screen.findByText(/Destinatário alterado/);expect(api.sendGuidesTask).toHaveBeenCalledTimes(1);expect(screen.queryByText('Confirmar ação nos itens listados')).not.toBeInTheDocument();
});
test('prévia recusada por item só transmite a lista aceita, com resultado faltante incerto',async()=>{
 const api=sendFixture();api.previewOperationsGuideSend.mockResolvedValue({preview:{companyId:'a',competencia:'2026-10',token:'signed',items:[{guideId:'g',reenviarConfirmado:false,revisao:'v2',canais:['EMAIL'],destinatarios:{emails:['fixture@example.invalid'],telefones:[]}}],refused:[{guideId:'rejected',motivo:'Documento pago'}]}});api.sendGuidesTask.mockResolvedValue([]);mount(api,{data:{a:{guides:[guide,{...guide,guideId:'rejected'}]}}});fireEvent.click(screen.getByText('Conferir envio / reenvio'));await screen.findByText(/Documento pago/);fireEvent.click(screen.getByText('Confirmar ação nos itens listados'));await screen.findByText(/g: Resultado não confirmado/);expect(api.sendGuidesTask.mock.calls[0][1].items).toEqual([{guideId:'g',reenviarConfirmado:false}]);
});

test('prévia não pode acrescentar guia fora da seleção',async()=>{
 const api=sendFixture();api.previewOperationsGuideSend.mockResolvedValue({preview:{companyId:'a',competencia:'2026-10',token:'signed',items:[{guideId:'outra',reenviarConfirmado:false,revisao:'v2',canais:['EMAIL'],destinatarios:{emails:[],telefones:[]}}],refused:[]}});mount(api);fireEvent.click(screen.getByText('Conferir envio / reenvio'));await screen.findByText(/Itens ou destinatários da prévia incompatíveis/);expect(api.sendGuidesTask).not.toHaveBeenCalled();expect(screen.queryByText('Confirmar ação nos itens listados')).not.toBeInTheDocument();
});

import { Modal } from '../../../components/ui/Modal';
test('cancelar prévia de Guias devolve foco no Modal real sem enviar',async()=>{
 const api=sendFixture();render(<Modal titulo="Guias" aoFechar={()=>{}}><OperationsGuideActions api={api} rows={[row]} selected={{a:true}} data={{a:{guides:[guide]}}} competencia="2026-10" stage="enviado"/></Modal>);const trigger=screen.getByText('Conferir envio / reenvio');trigger.focus();fireEvent.click(trigger);await screen.findByText(/fixture@example.invalid/);expect(screen.getByRole('heading',{name:'Conferir ação · 2026-10'})).toHaveFocus();const cancel=screen.getByText('Cancelar');cancel.focus();fireEvent.click(cancel);expect(trigger).toHaveFocus();expect(api.sendGuidesTask).not.toHaveBeenCalled();
});
