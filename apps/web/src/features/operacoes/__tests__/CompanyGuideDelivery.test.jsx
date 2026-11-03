import { render, screen, fireEvent, act } from '@testing-library/react';
import { CompanyGuideDelivery } from '../CompanyGuideDelivery';
const dto=(id='a',extra={})=>({ok:true,portalClientId:id,competencia:'2026-10',revision:1,status:'REVIEW',paused:false,cutoffDate:'2026-11-13',expectation:{state:'REVIEW',missing:[{obligationKey:'inss',label:'INSS',reason:'Documento faltante'}]},warnings:[{id:'warning',message:'Envio parcial: confira as guias faltantes.'}],items:[{guideId:'g',tipo:'DAS',competencia:'2026-10',vencimento:'2026-11-20',state:'REVIEW',channels:[{channel:'EMAIL',destinationLabel:'destino@example.test',state:'SENT'},{channel:'WHATSAPP',destinationLabel:'telefone autorizado',state:'UNCERTAIN',reason:'Confira a tentativa antes de repetir.'}]}],lastAttempt:{status:'REVIEW',finishedAt:'2026-11-13T11:00:00Z'},...extra});
test('mostra parcial, canais distintos e datas brasileiras sem transporte',async()=>{
 const api={getCompanyGuideDelivery:jest.fn(async()=>dto()),send:jest.fn()};
 render(<CompanyGuideDelivery api={api} companyId="a" competencia="2026-10"/>);
 expect(await screen.findByText('Envio parcial: confira as guias faltantes.')).toBeInTheDocument();
 expect(screen.getByText('destino@example.test',{exact:false})).toBeInTheDocument();
 expect(screen.getByText(/Resultado incerto/)).toBeInTheDocument();expect(screen.getByText('20/11/2026')).toBeInTheDocument();
 expect(api.send).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:/enviar/i})).not.toBeInTheDocument();
});
test('resposta atrasada da empresa anterior não substitui identidade atual',async()=>{
 let resolve;const api={getCompanyGuideDelivery:jest.fn(id=>id==='a'?new Promise(r=>{resolve=r;}):Promise.resolve(dto('b',{status:'DISABLED'})))};
 const view=render(<CompanyGuideDelivery api={api} companyId="a" competencia="2026-10"/>);
 view.rerender(<CompanyGuideDelivery api={api} companyId="b" competencia="2026-10"/>);
 await screen.findByText('Desligado');await act(async()=>resolve(dto('a')));expect(screen.getByText('Desligado')).toBeInTheDocument();expect(api.getCompanyGuideDelivery).toHaveBeenLastCalledWith('b','2026-10');
});
test('identidade divergente e conexão ausente exibem erro sem inventar cobertura',async()=>{
 const api={getCompanyGuideDelivery:jest.fn(async()=>dto('b'))};render(<CompanyGuideDelivery api={api} companyId="a" competencia="2026-10"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar');expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
test('atualização mantém foco no resultado e é somente leitura',async()=>{
 const api={getCompanyGuideDelivery:jest.fn(async()=>dto())};render(<CompanyGuideDelivery api={api} companyId="a" competencia="2026-10"/>);
 await screen.findByRole('table');const button=screen.getByRole('button',{name:'Atualizar envio automático'});button.focus();fireEvent.click(button);
 await screen.findByRole('table');expect(screen.getByRole('status')).toHaveFocus();expect(api.getCompanyGuideDelivery).toHaveBeenCalledTimes(2);
});

test('ausência confirmada fica separada de documentos disponíveis',async()=>{
 const api={getCompanyGuideDelivery:jest.fn(async()=>dto('a',{status:'COMPLETE',expectation:{state:'KNOWN',requiredCount:2,resolvedCount:2,availableCount:1,absenceConfirmedCount:1,missing:[]}}))};
 render(<CompanyGuideDelivery api={api} companyId="a" competencia="2026-10"/>);
 expect(await screen.findByText('1 de 2 obrigações com documento identificado.')).toBeInTheDocument();
 expect(screen.getByText(/1 ausência confirmada nesta competência/)).toBeInTheDocument();
 expect(screen.queryByText('2 de 2 obrigações com documento identificado.')).not.toBeInTheDocument();
});
