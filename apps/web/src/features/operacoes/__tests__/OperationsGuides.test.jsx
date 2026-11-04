import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationsGuides } from '../OperationsGuides';
import { reconcileOperationGuides } from '../operationsDetails';
const row={company:{companyId:'a',razao:'Alfa'},guideSummary:{items:[{key:'das',guideId:'g1',label:'DAS'}]}};
const guide={companyId:'a',guideId:'g1',competencia:'2026-10',tipo:'DAS',status:'PROCESSED',valor:100,vencimento:'2026-11-20T00:00:00Z',versaoPagamento:'v1',paymentStatus:'PAID',paymentStatusSource:'CLIENTE',paymentConfirmedAt:'2026-10-30T02:00:00Z',envio:{canais:[{canal:'WHATSAPP',destino:'destino sintético',status:'indeterminado',podeTentarDeNovo:false}]}};
test('documentos conciliam só por identidade e período; duplicata é erro',()=>{
 const result=reconcileOperationGuides([guide,{...guide,guideId:'outro',companyId:'b'},{...guide,guideId:'mes-anterior',competencia:'2026-09'}],row,'2026-10');expect(result.guides).toEqual([guide]);expect(result.missing).toEqual([]);expect(reconcileOperationGuides([{...guide,guideId:'igual-valor'}],row,'2026-10').missing).toHaveLength(1);expect(()=>reconcileOperationGuides([guide,guide],row,'2026-10')).toThrow(/repetido/);
});
test('Pago identifica guias pagas, origem cliente, data Brasília e envio incerto independente',async()=>{
 const api={getCompanyGuides:jest.fn(async()=>[guide,{...guide,guideId:'aberta',tipo:'INSS',paymentStatus:'OPEN'}]),send:jest.fn()};render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="pago"/>);await screen.findByText('DAS');fireEvent.click(screen.getByRole('button',{name:/Detalhes do pagamento de DAS/}));expect(screen.queryByText('INSS')).not.toBeInTheDocument();expect(screen.getByText(/Confirmada pelo cliente/)).toBeInTheDocument();expect(screen.getByText('Confirmação: A verificar')).toBeInTheDocument();expect(screen.getByText(/Entrega registrada:.*indeterminado/i)).toBeInTheDocument();expect(screen.getByText(/Vencimento: 20\/11\/2026/)).toBeInTheDocument();expect(api.send).not.toHaveBeenCalled();
});
test('retorno de outra competência não contamina a tabela',async()=>{
 let finish;const api={getCompanyGuides:jest.fn().mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValue([])};const view=render(<OperationsGuides api={api} rows={[row]} competencia="2026-10"/>);view.rerender(<OperationsGuides api={api} rows={[row]} competencia="2026-09"/>);await screen.findByText('Indisponível');await act(async()=>finish([guide]));expect(screen.queryByText('Detalhes do documento')).not.toBeInTheDocument();
});
test.each([
 ['OPEN','SERPRO','Origem: consulta SERPRO'],
 ['OVERDUE','SERPRO','Origem: consulta SERPRO'],
 ['UNPAID','SERPRO','Origem: consulta SERPRO'],
 [null,'SERPRO','Origem: consulta SERPRO'],
 ['OPEN','CLIENTE','Origem: informação do cliente'],
 ['OPEN','MANUAL','Origem: registro manual'],
])('estado %s com origem %s não afirma confirmação',async(paymentStatus,paymentStatusSource,origin)=>{
 const api={getCompanyGuides:jest.fn(async()=>[{...guide,paymentStatus,paymentStatusSource}]),send:jest.fn()};render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="enviado"/>);await screen.findByText('DAS');expect(screen.getByText(/Pagamento não confirmado/)).toBeInTheDocument();expect(screen.getByText(new RegExp(origin))).toBeInTheDocument();expect(screen.queryByText(/Confirmada na Receita|Confirmada pelo cliente|Confirmada pelo contador/)).not.toBeInTheDocument();expect(screen.getByText(/Resultado incerto/)).toBeInTheDocument();expect(api.send).not.toHaveBeenCalled();
});
test.each([
 ['SERPRO','Confirmada na Receita'],
 ['CLIENTE','Confirmada pelo cliente — declaração, não comprovante bancário'],
 ['MANUAL','Confirmada pelo contador'],
 [null,'Origem não informada'],
])('PAID mantém origem %s sem inventar outra evidência',async(paymentStatusSource,origin)=>{
 const api={getCompanyGuides:jest.fn(async()=>[{...guide,paymentStatus:'PAID',paymentStatusSource}]),send:jest.fn()};render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="pago"/>);await screen.findByText('DAS');fireEvent.click(screen.getByRole('button',{name:/Detalhes do pagamento de DAS/}));expect(screen.getByText(new RegExp(origin))).toBeInTheDocument();expect(screen.queryByText(/Pagamento não confirmado/)).not.toBeInTheDocument();expect(api.send).not.toHaveBeenCalled();
});


test('data legada de pagamento não substitui instante de confirmação ausente no DTO',async()=>{
 const api={getCompanyGuides:jest.fn(async()=>[guide]),getOperationsGuideEvidence:jest.fn(async()=>({companyId:'a',competencia:'2026-10',items:[{guideId:'g1',pagamento:{status:'PAID',origem:'CLIENTE',dataCivil:'2026-10-30',registradoEm:null,valorPago:null},envios:[],tentativas:[]}],nextOffset:null}))};
 render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="pago"/>);await screen.findByText('DAS');fireEvent.click(screen.getByRole('button',{name:/Detalhes do pagamento de DAS/}));expect(screen.getByText('Confirmação: A verificar')).toBeInTheDocument();expect(screen.getByText('Data do pagamento: 30/10/2026')).toBeInTheDocument();expect(screen.getByText('Não disponível')).toBeInTheDocument();expect(screen.queryByText(/29\/10\/2026/)).not.toBeInTheDocument();
});

test.each([['ERROR','Erro de processamento'],['NEEDS_REVIEW','Em conferência']])('estado documental %s prevalece sobre projeção Disponível antiga',async(status,label)=>{
 const stale={...row,guideSummary:{items:[{key:'das',guideId:'g1',label:'DAS',documento:'Disponível',comunicacao:'Enviada',pagamento:'Não confirmado'}]}};
 const api={getCompanyGuides:jest.fn(async()=>[{...guide,status,paymentStatus:'OPEN'}])};render(<OperationsGuides api={api} rows={[stale]} competencia="2026-10" stage="disponivel"/>);await screen.findByText('DAS');expect(screen.getByText(label)).toBeInTheDocument();expect(screen.getByText('Expectativa: Disponível')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Enviar guia'})).toBeDisabled();expect(screen.getByRole('columnheader',{name:'Disponibilidade'})).toBeInTheDocument();expect(screen.queryByText('Disponível',{exact:true})).not.toBeInTheDocument();
});

test('carga paralela limitada não inicia evidências ou outras empresas após fechar', async () => {
 const pending=[];const api={getCompanyGuides:jest.fn(()=>new Promise(resolve=>pending.push(resolve))),getOperationsGuideEvidence:jest.fn(),send:jest.fn()};
 const many=Array.from({length:8},(_,i)=>({company:{companyId:String(i),razao:`Empresa ${i}`}}));
 const view=render(<OperationsGuides api={api} rows={many} competencia="2026-10" stage="disponivel"/>);
 expect(api.getCompanyGuides.mock.calls.map(([id])=>id)).toEqual(['0','1','2']);view.unmount();
 await act(async()=>pending.forEach(resolve=>resolve([])));
 expect(api.getCompanyGuides).toHaveBeenCalledTimes(3);expect(api.getOperationsGuideEvidence).not.toHaveBeenCalled();expect(api.send).not.toHaveBeenCalled();
});
test.each([null, {}, [{...guide,companyId:undefined}], [{...guide,companyId:'outra'}]])('leitura inválida não vira ausência nem libera evidências',async value=>{
 const api={getCompanyGuides:jest.fn(async()=>value),getOperationsGuideEvidence:jest.fn(),send:jest.fn()};render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="disponivel"/>);
 await screen.findByText(/Resposta de documentos inválida/);expect(screen.queryByText(/Nenhum documento identificado/)).not.toBeInTheDocument();expect(api.getOperationsGuideEvidence).not.toHaveBeenCalled();expect(api.send).not.toHaveBeenCalled();
});

test('Disponível não expõe comunicação nem consulta automação da empresa', async () => {
 const api={getCompanyGuides:jest.fn(async()=>[]),getCompanyGuideDelivery:jest.fn(async()=>null)};
 render(<OperationsGuides api={api} rows={[row,{company:{companyId:'b',razao:'Beta'}}]} competencia="2026-10" stage="disponivel"/>);
 await waitFor(()=>expect(api.getCompanyGuides).toHaveBeenCalledTimes(2));expect(api.getCompanyGuideDelivery).not.toHaveBeenCalled();
 expect(screen.queryByText('Comunicação da empresa')).not.toBeInTheDocument();
 expect(screen.queryByText('Registrar envio externo')).not.toBeInTheDocument();
});

test('guia sem competência não invalida documento do mês nem entra na seleção de envio', async () => {
 const valid={...guide,paymentStatus:'OPEN',envio:{canais:[]}};
 const unscoped={...valid,guideId:'sem-periodo',competencia:null};
 const writable={...row,company:{...row.company,myRole:'ACCOUNTANT'}};
 expect(reconcileOperationGuides([valid,unscoped],writable,'2026-10').guides).toEqual([valid]);
 const api={getCompanyGuides:jest.fn(async()=>[valid,unscoped]),
  listarContatosWhatsapp:jest.fn(async()=>({canalPadraoEnvio:'EMAIL'})),
  previewOperationsGuideSend:jest.fn(async()=>({preview:{companyId:'a',competencia:'2026-10',items:[]}})),
  sendGuidesTask:jest.fn()};
 render(<OperationsGuides api={api} rows={[writable]} competencia="2026-10" stage="enviado"/>);
 await screen.findByText('DAS');
 expect(screen.queryByText(/Resposta de documentos inválida/)).not.toBeInTheDocument();
 expect(screen.queryByText('sem-periodo')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar Alfa'}));
 fireEvent.click(screen.getByRole('button',{name:'Conferir envio / reenvio'}));
 await waitFor(()=>expect(api.previewOperationsGuideSend).toHaveBeenCalledTimes(1));
 expect(api.previewOperationsGuideSend).toHaveBeenCalledWith('a','2026-10',{items:[{guideId:'g1',reenviarConfirmado:false}],whatsappRequested:false});
 expect(api.sendGuidesTask).not.toHaveBeenCalled();
});

test('seleciona todas as 31 elegíveis no filtro e exclui empresa fora do filtro', async () => {
 const many=Array.from({length:32},(_,i)=>({company:{companyId:String(i),razao:'Empresa '+i,myRole:'ACCOUNTANT',regime:'SIMPLES'}}));
 const api={getCompanyGuides:jest.fn(async()=>[]),captureSerproPgdasd:jest.fn(),previewOperationsGuideSend:jest.fn(),sendGuidesTask:jest.fn(),listarContatosWhatsapp:jest.fn()};
 render(<OperationsGuides api={api} rows={many} filteredRows={many.slice(0,31)} visibleRows={many.slice(0,30)} competencia="2026-10" stage="disponivel"/>);
 fireEvent.change(screen.getByRole('combobox',{name:'Selecionar para'}),{target:{value:'capture'}});
 await screen.findByRole('button',{name:'Selecionar todas as elegíveis do filtro · 31'});
 fireEvent.click(screen.getByRole('button',{name:'Selecionar todas as elegíveis do filtro · 31'}));
 expect(screen.getByText('1 selecionadas em outras páginas')).toBeInTheDocument();expect(screen.getByText('31 empresas selecionadas')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Enviar selecionadas'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Consultar guias · SERPRO'}));
 expect(screen.getByRole('heading',{name:'Conferir ação · 2026-10'}).nextSibling).toHaveTextContent('custo');
 expect(screen.queryByRole('rowheader',{name:'Empresa 31'})).not.toBeInTheDocument();
 expect(screen.getByRole('rowheader',{name:'Empresa 30'})).toBeInTheDocument();
 expect(api.captureSerproPgdasd).not.toHaveBeenCalled();expect(api.sendGuidesTask).not.toHaveBeenCalled();
});

test('envio individual prepara só o documento acionado, com colunas separadas',async()=>{
 const writable={...row,company:{...row.company,myRole:'ACCOUNTANT'}};
 const api={getCompanyGuides:jest.fn(async()=>[{...guide,paymentStatus:'OPEN',envio:{canais:[]}},{...guide,guideId:'g2',tipo:'ISS',paymentStatus:'OPEN',envio:{canais:[]}}]),listarContatosWhatsapp:jest.fn(async()=>({canalPadraoEnvio:'EMAIL'})),previewOperationsGuideSend:jest.fn(async()=>({preview:{companyId:'a',competencia:'2026-10',items:[]}})),sendGuidesTask:jest.fn()};
 render(<OperationsGuides api={api} rows={[writable]} competencia="2026-10" stage="disponivel"/>);
 await screen.findByText('ISS');
 for(const label of ['Empresa','Guia','Disponibilidade','Valor','Ações']) expect(screen.getByRole('columnheader',{name:label})).toBeInTheDocument();
 fireEvent.click(screen.getAllByRole('button',{name:'Enviar guia'})[1]);
 await waitFor(()=>expect(api.previewOperationsGuideSend).toHaveBeenCalledWith('a','2026-10',{items:[{guideId:'g2',reenviarConfirmado:false}],whatsappRequested:false}));
 expect(api.sendGuidesTask).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));
 expect(screen.getAllByRole('link',{name:'Abrir Guias'})[1]).toHaveAttribute('href',expect.stringContaining('competencia=2026-10'));
});


test('empresa sem documento não é selecionável para envio, mas permanece consultável', async () => {
 const writable={company:{companyId:'a',razao:'Alfa',myRole:'ACCOUNTANT',regime:'SIMPLES'}};
 const api={getCompanyGuides:jest.fn(async()=>[]),captureSerproPgdasd:jest.fn(),previewOperationsGuideSend:jest.fn(),sendGuidesTask:jest.fn(),listarContatosWhatsapp:jest.fn()};
 render(<OperationsGuides api={api} rows={[writable]} competencia="2026-10" stage="disponivel"/>);
 await screen.findByText(/Nenhum documento identificado/);
 expect(screen.getByRole('checkbox',{name:'Selecionar Alfa'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Enviar selecionadas'})).toBeDisabled();
 expect(screen.queryByRole('button',{name:'Enviar guia'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByRole('combobox',{name:'Selecionar para'}),{target:{value:'capture'}});
 expect(screen.getByRole('checkbox',{name:'Selecionar Alfa'})).toBeEnabled();
 expect(api.listarContatosWhatsapp).not.toHaveBeenCalled();expect(api.sendGuidesTask).not.toHaveBeenCalled();
});

test.each([[{},'Ausência registrada'],[{vazioPor:'contador',vazioEm:'2026-10-20T12:00:00Z'},'Dispensado']])('dispensa exige registro manual identificado %j',async(metadata,label)=>{
 const api={getCompanyGuides:jest.fn(async()=>[{...guide,status:'VAZIO',paymentStatus:'OPEN',envio:{canais:[]},...metadata}])};
 render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="disponivel"/>);
 await screen.findByText(label);expect(screen.getByRole('button',{name:'Enviar guia'})).toBeDisabled();
 if(!metadata.vazioPor)expect(screen.queryByText('Dispensado')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/INSS manual/})).not.toBeInTheDocument();
});


test('selecionar todas aguarda leitura completa do filtro',async()=>{
 let finish;
 const rows=[{company:{companyId:'a',razao:'Alfa',myRole:'ACCOUNTANT'}},{company:{companyId:'b',razao:'Beta',myRole:'ACCOUNTANT'}}];
 const api={getCompanyGuides:jest.fn(id=>id==='a'?Promise.resolve([{...guide,paymentStatus:'OPEN',envio:{canais:[]}}]):new Promise(r=>{finish=r;}))};
 render(<OperationsGuides api={api} rows={rows} competencia="2026-10" stage="disponivel"/>);
 await screen.findByText('DAS');
 expect(screen.getByRole('button',{name:/Selecionar todas as elegíveis/})).toBeDisabled();
 await act(async()=>finish([]));
 expect(screen.getByRole('button',{name:/Selecionar todas as elegíveis/})).toBeEnabled();
});

test('envio externo pode registrar entrega paga sem executar envio nem mudar pagamento',async()=>{
 const api={getCompanyGuides:jest.fn(async()=>[{...guide,envio:{canais:[]}}]),preverEnvioExternoGuia:jest.fn(async()=>({companyId:'a',guideId:'g1',revisaoDocumento:'r1'})),registrarEnvioExternoGuia:jest.fn(),sendGuidesTask:jest.fn()};
 render(<OperationsGuides api={api} rows={[{...row,company:{...row.company,myRole:'ACCOUNTANT'}}]} competencia="2026-10" stage="enviado"/>);
 await screen.findByText('DAS');
 expect(screen.getByRole('button',{name:'Reenviar guia'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Registrar envio externo'}));
 await waitFor(()=>expect(api.preverEnvioExternoGuia).toHaveBeenCalledWith('a','g1'));
 expect(guide.paymentStatus).toBe('PAID');expect(api.sendGuidesTask).not.toHaveBeenCalled();expect(api.registrarEnvioExternoGuia).not.toHaveBeenCalled();
});


test('Pago separa confirmados de OPEN visíveis e não oferece bloqueio de envio',async()=>{
 const writable={...row,company:{...row.company,myRole:'ACCOUNTANT'}};
 const api={getCompanyGuides:jest.fn(async()=>[{...guide,guideId:'open',paymentStatus:'OPEN',envio:{canais:[]}}]),buscarPagamentoGuia:jest.fn(),sendGuidesTask:jest.fn()};
 render(<OperationsGuides api={api} rows={[writable]} competencia="2026-10" stage="pago"/>);
 await screen.findByText('Nenhum pagamento confirmado nesta competência.');
 expect(screen.queryByText(/Nenhum documento identificado/)).not.toBeInTheDocument();
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Consultar pagamentos'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Visão de pagamentos'),{target:{value:'open'}});
 expect(screen.getByText('DAS')).toBeInTheDocument();expect(screen.getByText(/Pagamento não confirmado/)).toBeInTheDocument();
 expect(screen.getByRole('checkbox',{name:'Selecionar Alfa'}).closest('label')).toHaveClass('operacoes-selecao-alvo');fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar Alfa'}));fireEvent.click(screen.getByRole('button',{name:'Consultar pagamentos'}));
 expect(screen.getByRole('heading',{name:'Conferir ação · 2026-10'})).toBeInTheDocument();expect(screen.getByRole('rowheader',{name:'Alfa'})).toBeInTheDocument();
 expect(api.buscarPagamentoGuia).not.toHaveBeenCalled();expect(api.sendGuidesTask).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));fireEvent.change(screen.getByLabelText('Visão de pagamentos'),{target:{value:'confirmed'}});
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(api.buscarPagamentoGuia).not.toHaveBeenCalled();
});

 test('Pago abre detalhe nomeado e volta ao mesmo documento sem seleção ou comando',async()=>{
 const api={getCompanyGuides:jest.fn(async()=>[guide]),send:jest.fn()};render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="pago"/>);
 const trigger=await screen.findByRole('button',{name:'Detalhes do pagamento de DAS · Alfa'});trigger.focus();fireEvent.click(trigger);
 expect(screen.getByRole('heading',{name:'Alfa · 2026-10'})).toHaveFocus();expect(screen.getByText('Confirmada pelo cliente — declaração, não comprovante bancário')).toBeVisible();expect(screen.getByRole('link',{name:'Abrir Guias'})).toHaveAttribute('href','/companies/a/guides?competencia=2026-10');expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Voltar'}));await waitFor(()=>expect(trigger).toHaveFocus());expect(screen.queryByRole('region',{name:'Detalhes do pagamento'})).not.toBeInTheDocument();expect(api.send).not.toHaveBeenCalled();
 });
