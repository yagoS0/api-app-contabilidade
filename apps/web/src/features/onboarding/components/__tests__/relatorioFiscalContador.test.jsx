import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {RelatorioFiscalDoLead} from '../RelatorioFiscalDoLead';
import {AutorizacaoDoLead} from '../AutorizacaoDoLead';
const ficha={id:'o1',cnpj:'11222333000181',versao:3};
const fiscal=()=>({id:'a1',cnpj:ficha.cnpj,status:'CONCLUIDA',createdAt:'2026-10-10T12:00:00Z',tabelaDisponivel:true,conteudoHash:"h1",envio:{estado:'NAO_ENVIADO'}});
function ambiente({revisado=false}={}) {
 const r=fiscal();if(revisado)r.revisadoEm='2026-10-10T13:00:00Z';
 const api={baixarTabelaFiscalLead:jest.fn(async()=>new Blob(['%PDF'])),comercial:jest.fn(async(path,body)=>{
  if(path.endsWith('/revisao')){r.revisadoEm='2026-10-10T13:00:00Z';return {revisadoEm:r.revisadoEm};}
  if(path.endsWith('/enviar')){r.envio={estado:'ENVIADO',conversaId:body.conversaId};return {envio:r.envio};}
  return {relatorios:[{...r}],consumo:{gpt:{disponivel:true,custoUsd:0.00000123,reservaUsd:0.004},serpro:{concluidas:1,pendentes:0,erros:0}}};
 })};return{api,r};
}
beforeEach(()=>{URL.createObjectURL=jest.fn(()=> 'blob:test');URL.revokeObjectURL=jest.fn();jest.spyOn(window,'open').mockImplementation(()=>null);});
afterEach(()=>{jest.restoreAllMocks();});
test('abrir PDF, revisar e enviar exigem atos separados, sem repetir envio',async()=>{
 const{api}=ambiente();const onAtualizar=jest.fn();render(<RelatorioFiscalDoLead api={api} onboarding={ficha} conversaId="c1" onAtualizar={onAtualizar}/>);
 const revisar=await screen.findByRole('button',{name:'Confirmar revisão do relatório'});expect(revisar).toBeDisabled();expect(screen.getByRole('button',{name:'Enviar relatório revisado'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Abrir PDF em tabela'}));await waitFor(()=>expect(revisar).toBeEnabled());
 fireEvent.click(revisar);fireEvent.click(revisar);await screen.findByText('Relatório revisado.');
 expect(api.comercial.mock.calls.filter(([p])=>p.endsWith('/revisao'))).toHaveLength(1);expect(onAtualizar).toHaveBeenCalledWith({manterFiscal:true});
 const enviar=screen.getByRole('button',{name:'Enviar relatório revisado'});fireEvent.click(enviar);fireEvent.click(enviar);
 await screen.findByText(/Relatório enviado/);expect(enviar).toBeDisabled();expect(api.comercial.mock.calls.filter(([p])=>p.endsWith('/enviar'))).toHaveLength(1);
 expect(api.comercial).toHaveBeenCalledWith('/onboardings/o1/fiscal/a1/enviar',{conversaId:'c1'});
 fireEvent.click(screen.getByText('Consumo deste atendimento'));expect(screen.getByText(/US\$0.00000123/)).toBeVisible();expect(screen.getByText(/Reserva.*US\$0.004/)).toBeVisible();expect(screen.getByText('Valor SERPRO a conciliar.')).toBeVisible();
});
test('resultado incerto bloqueia nova tentativa local',async()=>{
 const{api}=ambiente({revisado:true});const original=api.comercial.getMockImplementation();api.comercial.mockImplementation((p,b)=>p.endsWith('/enviar')?Promise.reject(new Error('Resultado incerto')):original(p,b));
 render(<RelatorioFiscalDoLead api={api} onboarding={ficha} conversaId="c1"/>);const enviar=await screen.findByRole('button',{name:'Enviar relatório revisado'});fireEvent.click(enviar);
 await screen.findByRole('alert');expect(enviar).toBeDisabled();fireEvent.click(enviar);expect(api.comercial.mock.calls.filter(([p])=>p.endsWith('/enviar'))).toHaveLength(1);
});
test('trocar pessoa durante download descarta resultado e exige nova conferência',async()=>{
 const{api}=ambiente();let resolver;api.baixarTabelaFiscalLead.mockImplementation(()=>new Promise(r=>{resolver=r;}));
 const tela=render(<RelatorioFiscalDoLead api={api} onboarding={ficha} conversaId="c1"/>);fireEvent.click(await screen.findByRole('button',{name:'Abrir PDF em tabela'}));
 tela.rerender(<RelatorioFiscalDoLead api={api} onboarding={{...ficha,id:'o2',cnpj:'04252011000110'}} conversaId="c2"/>);
 await act(async()=>resolver(new Blob(['pdf'])));expect(window.open).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Enviar relatório revisado'})).not.toBeInTheDocument();
});
test('consulta mais nova impede preparar tabela antiga',async()=>{
 const{api}=ambiente();api.comercial.mockResolvedValue({relatorios:[fiscal(),{...fiscal(),id:'a2',status:'PROCESSANDO',createdAt:'2026-10-11T12:00:00Z',tabelaDisponivel:false}]});
 render(<RelatorioFiscalDoLead api={api} onboarding={ficha} conversaId="c1"/>);await waitFor(()=>expect(api.comercial).toHaveBeenCalled());expect(screen.queryByRole('button',{name:'Abrir PDF em tabela'})).not.toBeInTheDocument();
});
test('aceite no portal é manual e não dispara consulta ao abrir etapa',async()=>{
 const acao=jest.fn(async()=>true);const estado={onboarding:ficha,atendimento:{id:'lead',representanteVerificadoEm:'2026-10-10',triagem:{preatendimento:{autorizacaoFiscal:{estado:'AGUARDANDO_AUTORIZACAO',procuradorCnpj:'04252011000110'}}}},configuracao:{consultasFiscais:true}};
 render(<AutorizacaoDoLead api={{}} recursos={[]} estado={estado} conversaId="c1" acao={acao}/>);
 expect(screen.getByText('04.252.011/0001-10')).toBeVisible();expect(screen.getByText(/Autorização solicitada ao cliente/)).toBeVisible();expect(acao).not.toHaveBeenCalled();
 const verificar=screen.getByRole('button',{name:'Verificar procuração e avançar'});expect(verificar).toBeDisabled();fireEvent.click(screen.getByLabelText('Aceite conferido no portal da Receita'));fireEvent.click(verificar);fireEvent.click(verificar);
 await waitFor(()=>expect(acao).toHaveBeenCalledTimes(1));expect(acao).toHaveBeenCalledWith('/consultas',{tipo:'PROCURACAO'});
});

test('alteração do mesmo relatório exige abrir e revisar o conteúdo novo',async()=>{
 const{api,r}=ambiente();const tela=render(<RelatorioFiscalDoLead api={api} onboarding={ficha} conversaId="c1"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Abrir PDF em tabela'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Confirmar revisão do relatório'})).toBeEnabled());
 expect(api.baixarTabelaFiscalLead).toHaveBeenCalledWith('o1','a1','h1');
 r.conteudoHash='h2';tela.rerender(<RelatorioFiscalDoLead api={api} onboarding={{...ficha}} conversaId="c1"/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Confirmar revisão do relatório'})).toBeDisabled());
 fireEvent.click(screen.getByRole('button',{name:'Abrir PDF em tabela'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Confirmar revisão do relatório'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Confirmar revisão do relatório'}));await screen.findByText('Relatório revisado.');expect(api.comercial).toHaveBeenCalledWith('/onboardings/o1/fiscal/a1/revisao',{versao:3,conteudoHash:'h2'});
});
