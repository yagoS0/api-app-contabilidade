import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AgendaEventosEditor} from '../AgendaEventosEditor';
const policy=()=>({schemaVersion:1,revision:'global-r0',version:0,configured:false,defaults:{},tributos:{},executionMode:'LEGADO',relativeConsumerReady:false});
function fixture(){let current=policy();return {getRotinas:jest.fn(async()=>({ok:true,agendaEventos:current,agenda:{conferencia:{enabled:false,day:1,hour:8}}})),saveRotinas:jest.fn(async input=>{current={...current,revision:'global-r1',version:1,tributos:input.agendaEventos.patch.tributos};return {ok:true,agendaEventos:current};}),send:jest.fn(),queryFiscal:jest.fn()};}
test('ausência não vira participação ativa e salvar horário OFF é request exclusivo',async()=>{
 const api=fixture();render(<AgendaEventosEditor canEdit={true} api={api}/>);fireEvent.change(await screen.findByLabelText('Imposto a configurar'),{target:{value:'IRPJ'}});
 const time=await screen.findByLabelText('IRPJ Buscar guia horário');expect(screen.getByLabelText('IRPJ Buscar guia participação')).toHaveValue('inherit');
 fireEvent.change(time,{target:{value:'9'}});fireEvent.click(screen.getByText('Conferir parâmetros'));expect(screen.getByRole('heading',{name:'Conferir parâmetros por imposto'})).toHaveFocus();
 expect(api.saveRotinas).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Salvar parâmetros'));
 await waitFor(()=>expect(api.saveRotinas).toHaveBeenCalledTimes(1));expect(api.saveRotinas.mock.calls[0][0]).toEqual({requestId:expect.any(String),agendaEventos:{expectedRevision:'global-r0',patch:{tributos:{IRPJ:{captura:{hour:9}}}}}});
 await screen.findByText(/Parâmetros salvos/);expect(api.send).not.toHaveBeenCalled();expect(api.queryFiscal).not.toHaveBeenCalled();expect(screen.getByText(/calendário por imposto indisponível/)).toBeInTheDocument();
});
test('false explícito e null restaurando herança são preservados no envelope empresarial',async()=>{
 const initial={companyId:'a',revision:'company-composed',agendaEventos:{...policy(),overrides:{schemaVersion:1,tributos:{IRPJ:{captura:{enabled:false}}}},effective:{IRPJ:{captura:{enabled:false,hour:9}}},origins:{IRPJ:{'captura.enabled':'EMPRESA_TRIBUTO'}}}};
 const api={getCompanyAutomation:jest.fn(async()=>initial),saveCompanyAutomation:jest.fn(async()=>({...initial,revision:'next',agendaEventos:{...initial.agendaEventos,revision:'company-policy-next',version:1,overrides:{schemaVersion:1,tributos:{}}}}))};
 render(<AgendaEventosEditor canEdit={true} api={api} companyId="a"/>);fireEvent.change(await screen.findByLabelText('Imposto a configurar'),{target:{value:'IRPJ'}});expect(await screen.findByLabelText('IRPJ Buscar guia participação')).toHaveValue('false');fireEvent.change(screen.getByLabelText('IRPJ Buscar guia participação'),{target:{value:'inherit'}});fireEvent.click(screen.getByText('Conferir parâmetros'));fireEvent.click(screen.getByText('Salvar parâmetros'));
 await waitFor(()=>expect(api.saveCompanyAutomation).toHaveBeenCalledWith('a',{requestId:expect.any(String),expectedRevision:'company-composed',agendaEventos:{patch:{tributos:{IRPJ:{captura:{enabled:null}}}}}}));
});
test('resultado incerto preserva requestId e bloqueia edição até conferir o replay',async()=>{
 const api=fixture();api.saveRotinas.mockRejectedValueOnce(Error('Resultado incerto'));
 render(<AgendaEventosEditor canEdit={true} api={api}/>);fireEvent.change(await screen.findByLabelText('Imposto a configurar'),{target:{value:'IRPJ'}});fireEvent.change(await screen.findByLabelText('IRPJ Buscar guia horário'),{target:{value:'9'}});fireEvent.click(screen.getByText('Conferir parâmetros'));fireEvent.click(screen.getByText('Salvar parâmetros'));await screen.findByText('Resultado incerto');
 expect(screen.getByText('Voltar à edição')).toBeDisabled();fireEvent.click(screen.getByText('Conferir salvamento com a mesma solicitação'));await waitFor(()=>expect(api.saveRotinas).toHaveBeenCalledTimes(2));expect(api.saveRotinas.mock.calls[0]).toEqual(api.saveRotinas.mock.calls[1]);
});
test('troca de empresa ignora resposta antiga e ausência do DTO não simula recurso pronto',async()=>{
 let finish;const api={getCompanyAutomation:jest.fn(id=>id==='a'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({companyId:'b',revision:'b'}))};
 const view=render(<AgendaEventosEditor canEdit={true} api={api} companyId="a"/>);view.rerender(<AgendaEventosEditor canEdit={true} api={api} companyId="b"/>);await screen.findByText(/Configuração por imposto indisponível/);await act(async()=>finish({companyId:'a',revision:'a',agendaEventos:{...policy(),overrides:{},effective:{},origins:{}}}));expect(screen.queryByLabelText('IRPJ Buscar guia horário')).not.toBeInTheDocument();
});
test('voltar da prévia preserva rascunho e foco sem salvar',async()=>{
 const api=fixture();render(<AgendaEventosEditor canEdit={true} api={api}/>);fireEvent.change(await screen.findByLabelText('Imposto a configurar'),{target:{value:'IRPJ'}});fireEvent.change(await screen.findByLabelText('IRPJ Buscar guia horário'),{target:{value:'9'}});fireEvent.click(screen.getByText('Conferir parâmetros'));fireEvent.click(screen.getByText('Voltar à edição'));await waitFor(()=>expect(screen.getByText('Conferir parâmetros')).toHaveFocus());expect(screen.getByLabelText('IRPJ Buscar guia horário')).toHaveValue('9');expect(api.saveRotinas).not.toHaveBeenCalled();
});

test('trocar imposto mantém o rascunho e a prévia inclui alterações de impostos distintos',async()=>{
 const api=fixture();render(<AgendaEventosEditor canEdit={true} api={api}/>);
 fireEvent.change(await screen.findByLabelText('SIMPLES Buscar guia horário'),{target:{value:'8'}});
 fireEvent.change(screen.getByLabelText('Imposto a configurar'),{target:{value:'IRPJ'}});
 expect(screen.queryByLabelText('SIMPLES Buscar guia horário')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('IRPJ Buscar guia horário'),{target:{value:'9'}});
 fireEvent.change(screen.getByLabelText('Imposto a configurar'),{target:{value:'SIMPLES'}});
 expect(screen.getByLabelText('SIMPLES Buscar guia horário')).toHaveValue('8');
 fireEvent.click(screen.getByText('Conferir parâmetros'));
 expect(screen.getByText('DAS Simples · Buscar guia · horário')).toBeInTheDocument();
 expect(screen.getByText('IRPJ · Buscar guia · horário')).toBeInTheDocument();
 expect(api.saveRotinas).not.toHaveBeenCalled();
});

test.each([{version:0,revision:'global-r0'},{version:0,revision:'new-with-old-version'},{version:1,revision:'global-r0'}])('não considera gravação confirmada sem avanço de versão e revisão %j',returned=>{
 return (async()=>{const api=fixture();api.saveRotinas.mockImplementation(async input=>({ok:true,agendaEventos:{...policy(),...returned,tributos:input.agendaEventos.patch.tributos}}));render(<AgendaEventosEditor canEdit={true} api={api}/>);
 fireEvent.change(await screen.findByLabelText('SIMPLES Buscar guia horário'),{target:{value:'9'}});fireEvent.click(screen.getByText('Conferir parâmetros'));fireEvent.click(screen.getByText('Salvar parâmetros'));
 await screen.findByText(/Retorno não confirma/);expect(screen.queryByText(/Parâmetros salvos/)).not.toBeInTheDocument();expect(screen.getByText('Voltar à edição')).toBeDisabled();expect(screen.getByText('Conferir salvamento com a mesma solicitação')).toBeEnabled();})();
});
test('lê estratégia relativa adotada sem confundir com habilitação e sem enviar campo de adoção',async()=>{
 const api=fixture();api.getRotinas.mockResolvedValue({ok:true,agendaEventos:{...policy(),executionMode:'RELATIVO_V1',relativeConsumerReady:true,capabilities:{reminders:true,paymentD2:true,capture:false}}});render(<AgendaEventosEditor canEdit={true} api={api}/>);
 await screen.findByText('Lembretes por imposto: calendário por vencimento salvo');expect(screen.getByLabelText('SIMPLES Buscar guia participação')).toHaveValue('inherit');expect(api.saveRotinas).not.toHaveBeenCalled();expect(api.send).not.toHaveBeenCalled();expect(api.queryFiscal).not.toHaveBeenCalled();
});

test('descarte normal libera rascunho sem salvar e devolve foco ao retorno',async()=>{
 const api=fixture(),dirty=jest.fn();render(<AgendaEventosEditor canEdit={true} api={api} onDirty={dirty}/>);
 fireEvent.change(await screen.findByLabelText('SIMPLES Buscar guia horário'),{target:{value:'9'}});fireEvent.click(screen.getByText('Descartar rascunho'));
 expect(screen.getByLabelText('SIMPLES Buscar guia horário')).toHaveValue('');expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();await waitFor(()=>expect(screen.getByText('Rascunho descartado. Configuração salva preservada.')).toHaveFocus());expect(dirty).toHaveBeenLastCalledWith(false);expect(api.saveRotinas).not.toHaveBeenCalled();
});
test.each([undefined,false])('permissão ausente ou falsa impede edição e gravação (%s)',async canEdit=>{
 const api=fixture();render(<AgendaEventosEditor api={api} canEdit={canEdit}/>);expect(await screen.findByLabelText('SIMPLES Buscar guia horário')).toBeDisabled();expect(screen.getByLabelText('SIMPLES Buscar guia participação')).toBeDisabled();expect(screen.getByText('Conferir parâmetros')).toBeDisabled();expect(api.saveRotinas).not.toHaveBeenCalled();
});
test('herança usa camada inferior por folha, sem prometer o override salvo',async()=>{
 const p={...policy(),overrides:{schemaVersion:1,tributos:{IRPJ:{captura:{hour:9,businessDaysBefore:4}}}},effective:{IRPJ:{captura:{hour:9,businessDaysBefore:4,enabled:false}}},inherited:{IRPJ:{captura:{hour:8,businessDaysBefore:2,enabled:false}}},origins:{IRPJ:{'captura.hour':'EMPRESA_TRIBUTO','captura.businessDaysBefore':'EMPRESA_TRIBUTO','captura.enabled':'GLOBAL_DEFAULT'}},inheritedOrigins:{IRPJ:{'captura.hour':'GLOBAL_DEFAULT','captura.businessDaysBefore':'EMPRESA_DEFAULT','captura.enabled':'GLOBAL_DEFAULT'}}};const api={getCompanyAutomation:jest.fn(async()=>({companyId:'a',revision:'outer0',agendaEventos:p})),saveCompanyAutomation:jest.fn()};render(<AgendaEventosEditor canEdit={true} api={api} companyId="a"/>);
 fireEvent.change(await screen.findByLabelText('Imposto a configurar'),{target:{value:'IRPJ'}});const hour=screen.getByLabelText('IRPJ Buscar guia horário');expect(hour).toHaveValue('9');expect(hour.querySelector('option[value=""]')).toHaveTextContent('Herdar · 08:00');expect(screen.getByLabelText('IRPJ Buscar guia antecedência')).toHaveAttribute('placeholder','2');
 fireEvent.change(hour,{target:{value:''}});expect(hour).toHaveValue('');expect(hour.querySelector('option[value=""]')).not.toHaveTextContent('09:00');fireEvent.click(screen.getByText('Conferir parâmetros'));expect(screen.getByText('Restaurar herança')).toBeInTheDocument();expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
});

test('resultado incerto não permite recarregar ou perder intenção por GET antigo',async()=>{
 const api=fixture();api.saveRotinas.mockRejectedValueOnce(Error('Tempo esgotado'));render(<AgendaEventosEditor canEdit={true} api={api}/>);
 fireEvent.change(await screen.findByLabelText('SIMPLES Buscar guia horário'),{target:{value:'9'}});const reads=api.getRotinas.mock.calls.length;
 fireEvent.click(screen.getByText('Conferir parâmetros'));fireEvent.click(screen.getByText('Salvar parâmetros'));await screen.findByText('Tempo esgotado');
 const reload=screen.getByText('Descartar rascunho e recarregar configuração');expect(reload).toBeDisabled();fireEvent.click(reload);expect(api.getRotinas).toHaveBeenCalledTimes(reads);expect(screen.getByText('Voltar à edição')).toBeDisabled();
 fireEvent.click(screen.getByText('Conferir salvamento com a mesma solicitação'));await screen.findByText(/Parâmetros salvos/);expect(api.saveRotinas).toHaveBeenCalledTimes(2);expect(api.saveRotinas.mock.calls[1][0]).toEqual(api.saveRotinas.mock.calls[0][0]);
});
test('rejeição definitiva permite conferir configuração atual sem anunciar salvamento',async()=>{
 const api=fixture();api.saveRotinas.mockRejectedValue(Object.assign(Error('Configuração mudou'),{status:409}));render(<AgendaEventosEditor canEdit={true} api={api}/>);fireEvent.change(await screen.findByLabelText('SIMPLES Buscar guia horário'),{target:{value:'9'}});fireEvent.click(screen.getByText('Conferir parâmetros'));fireEvent.click(screen.getByText('Salvar parâmetros'));await screen.findByText('Configuração mudou');expect(screen.getByText('Conferir salvamento com a mesma solicitação')).toBeDisabled();fireEvent.click(screen.getByText('Descartar rascunho e recarregar configuração'));await screen.findByLabelText('SIMPLES Buscar guia horário');expect(api.saveRotinas).toHaveBeenCalledTimes(1);expect(screen.queryByText(/Parâmetros salvos/)).not.toBeInTheDocument();
});

// Keep the parent snapshot A mounted: an explicit conflict reload must obtain B.
test.each([false,true])('reload pós409 lê revisão nova sem reutilizar snapshot do pai (empresa=%s)',async company=>{
 const wrap=(version,hour)=>({ok:true,...(company?{companyId:'a',companyName:'Empresa fictícia',revision:`company-${version}`} : {}),agendaEventos:{...policy(),version,revision:`policy-${version}`,tributos:{SIMPLES:{captura:{hour}}},...(company?{overrides:{schemaVersion:1,tributos:{SIMPLES:{captura:{hour}}}},effective:{SIMPLES:{captura:{hour}}},inherited:{},origins:{}}:{})}});
 const initial=wrap(0,8),fresh=wrap(1,10),saved=wrap(2,12);
 const read=jest.fn(async()=>fresh),write=jest.fn().mockRejectedValueOnce(Object.assign(Error('Revisão mudou'),{status:409})).mockResolvedValueOnce(saved);
 const api=company?{getCompanyAutomation:read,saveCompanyAutomation:write}:{getRotinas:read,saveRotinas:write};
 const props={api,canEdit:true,snapshot:initial,...(company?{companyId:'a'}:{})};
 const view=render(<AgendaEventosEditor {...props}/>);
 fireEvent.change(await screen.findByLabelText('SIMPLES Buscar guia horário'),{target:{value:'9'}});expect(read).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('Conferir parâmetros'));fireEvent.click(screen.getByText('Salvar parâmetros'));await screen.findByText('Revisão mudou');
 expect(screen.getByText('Conferir salvamento com a mesma solicitação')).toBeDisabled();
 fireEvent.click(screen.getByText('Descartar rascunho e recarregar configuração'));
 await waitFor(()=>expect(screen.getByLabelText('SIMPLES Buscar guia horário')).toHaveValue('10'));
 expect(read).toHaveBeenCalledTimes(1);if(company)expect(read).toHaveBeenCalledWith('a');
 // A later local discard/parent render cannot silently restore stale snapshot A.
 fireEvent.change(screen.getByLabelText('SIMPLES Buscar guia horário'),{target:{value:'11'}});fireEvent.click(screen.getByText('Descartar rascunho'));
 view.rerender(<AgendaEventosEditor {...props} snapshot={JSON.parse(JSON.stringify(initial))}/>);
 await waitFor(()=>expect(screen.getByLabelText('SIMPLES Buscar guia horário')).toHaveValue('10'));
 fireEvent.change(screen.getByLabelText('SIMPLES Buscar guia horário'),{target:{value:'12'}});fireEvent.click(screen.getByText('Conferir parâmetros'));fireEvent.click(screen.getByText('Salvar parâmetros'));
 await screen.findByText(/Parâmetros salvos/);expect(write).toHaveBeenCalledTimes(2);
 const first=write.mock.calls[0][company?1:0],second=write.mock.calls[1][company?1:0];
 expect(company?first.expectedRevision:first.agendaEventos.expectedRevision).toBe(company?'company-0':'policy-0');
 expect(company?second.expectedRevision:second.agendaEventos.expectedRevision).toBe(company?'company-1':'policy-1');
 expect(second.requestId).not.toBe(first.requestId);expect(second.agendaEventos.patch).toEqual({tributos:{SIMPLES:{captura:{hour:12}}}});expect(read).toHaveBeenCalledTimes(1);
});

test('prévia comunica apresentação ao pai sem salvar e restaura edição',async()=>{const api=fixture(),onReview=jest.fn();render(<AgendaEventosEditor canEdit api={api} onReview={onReview}/>);const input=await screen.findByLabelText('SIMPLES Buscar guia horário');fireEvent.change(input,{target:{value:'9'}});fireEvent.click(screen.getByText('Conferir parâmetros'));expect(onReview).toHaveBeenLastCalledWith(true);fireEvent.click(screen.getByText('Voltar à edição'));expect(onReview).toHaveBeenLastCalledWith(false);expect(screen.getByLabelText('SIMPLES Buscar guia horário')).toHaveValue('9');expect(api.saveRotinas).not.toHaveBeenCalled();});
