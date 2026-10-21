import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RotinasPage } from "../renderRotinasPage.jsx";

test('ativação fica dentro da empresa; salvar horários não sobrescreve escolhas de consultas', async () => {
  const api = { getRotinas: jest.fn(async () => ({ rotinas: [{ key: 'das', label: 'DAS' }], agenda: { das: { enabled: true, day: 5, hour: 7 } }, empresas: [{ companyId: 'empresa-a', razao: 'Empresa A', rotinas: { das: true } }] })), saveRotinas: jest.fn(async () => ({})) };
  render(<MemoryRouter><RotinasPage api={api}/></MemoryRouter>);
  fireEvent.click(screen.getByRole('tab', { name: 'Configuração' }));
  expect(await screen.findByRole('link', { name: 'Empresa A' })).toHaveAttribute('href', '/companies/empresa-a/automacao');
  expect(screen.queryByLabelText('DAS para Empresa A')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar horários' }));
  await waitFor(() => expect(api.saveRotinas).toHaveBeenCalled());
  expect(api.saveRotinas.mock.calls[0][0]).not.toHaveProperty('empresas');
});

test('histórico mostra empresa, competência e diagnóstico sem confundir erro com não pagamento', async () => {
  const api = { getRotinas: jest.fn(async () => ({ rotinas: [{ key: 'pagamento', label: 'Pagamento' }], agenda: {}, empresas: [],
    executions: [{ routine: 'pagamento', enabled: true, alive: true, lastRun: { status: 'FAILED', result: { results: [
      { razao: 'Empresa de teste', competencia: '2026-09', tipo: 'INSS', error: 'SERPRO_PAGTOWEB_SEM_AUTORIZACAO', diagnostico: { mensagem: 'Confira a procuração.', httpStatus: 403 } },
      { guideId: 'guia-antiga', error: 'SERPRO_PAGTOWEB_CONSULTA_NAO_CONCLUIDA' },
    ] } } }] })) };
  render(<MemoryRouter><RotinasPage api={api} /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'Ver resultado de Pagamento'}));
  expect(screen.getByText('Empresa de teste')).toBeVisible();
  expect(screen.getByText('INSS · 2026-09')).toBeVisible();
  expect(screen.getAllByText(/Confira a procuração/).some(el=>el.closest('details') === null)).toBe(true);expect(screen.getByText('HTTP 403')).toBeVisible();
  expect(screen.getByText(/registro antigo não guardou o motivo/)).toBeVisible();
});

test("horário meia-noite e frequência diária são conservados ao salvar", async () => {
  const api = {
    getRotinas: jest.fn(async () => ({
      rotinas: [{ key: "pagamento", label: "Pagamento" }],
      agenda: { pagamento: { enabled: true, day: 20, hour: 8, frequency: "MONTHLY" } }, empresas: [],
    })),
    saveRotinas: jest.fn(async (body) => ({ agenda: body.agenda })),
  };
  render(<MemoryRouter><RotinasPage api={api} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab",{name:"Configuração"}));
  fireEvent.change(await screen.findByLabelText("Horário de Pagamento"), { target: { value: "00:00" } });
  fireEvent.change(screen.getByLabelText("Frequência da consulta de pagamentos"), { target: { value: "DAILY" } });
  expect(screen.getByLabelText("Dia de Pagamento")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Salvar horários" }));
  await waitFor(() => expect(api.saveRotinas).toHaveBeenCalledWith(expect.objectContaining({
    agenda: { pagamento: { enabled: true, day: 20, hour: 0, frequency: "DAILY" } },
  })));
});

test("executor sem sinal não aparece como consulta bem-sucedida", async () => {
  const api = { getRotinas: jest.fn(async () => ({ rotinas: [{ key: "pagamento", label: "Pagamento" }],
    agenda: {}, empresas: [], executions: [{ routine: "pagamento", enabled: true, alive: false,
      lastRun: null, nextAt: "2026-09-25T11:00:00Z" }] })) };
  render(<MemoryRouter><RotinasPage api={api} /></MemoryRouter>);
  expect(await screen.findByText("Sem sinal do executor")).toBeVisible();
  expect(screen.queryByText("Concluída")).not.toBeInTheDocument();
});

test("falha mostra ação do contador e não promete retry antigo", async () => {
  const api = { getRotinas: jest.fn(async () => ({ rotinas: [{ key: "pagamento", label: "Pagamento" }], agenda: {}, empresas: [],
    executions: [{ routine: "pagamento", enabled: true, alive: true, retryExhausted: true,
      lastRun: { status: "FAILED", attempts: 3, retryAt: "2026-09-25T11:15:00Z" }, nextAt: "2026-10-20T11:00:00Z" }] })) };
  render(<MemoryRouter><RotinasPage api={api} /></MemoryRouter>);
  expect(await screen.findByText("Consultar falha")).toBeVisible();
  expect(screen.getByText("Sem nova tentativa automática. A próxima consulta seguirá a agenda salva.")).toBeInTheDocument();
  expect(screen.queryByText(/Nova tentativa a partir/)).not.toBeInTheDocument();
});

test('recusa de acesso não anuncia lista vazia e impede salvar sem carga',async()=>{const api={getRotinas:jest.fn(async()=>{throw new Error('forbidden_admin_or_contador_only')}),saveRotinas:jest.fn()};render(<MemoryRouter><RotinasPage api={api}/></MemoryRouter>);expect(await screen.findByRole('alert')).toHaveTextContent('administrador ou contador');expect(screen.queryByText('Nenhuma empresa.')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('tab',{name:'Configuração'}));expect(screen.getByRole('button',{name:'Salvar horários'})).toBeDisabled();expect(api.saveRotinas).not.toHaveBeenCalled();});
test('gravação mantém dados bloqueados e avisa dia inexistente sem promessa de antecipação',async()=>{let concluir;const api={getRotinas:async()=>({rotinas:[{key:'das',label:'DAS'}],agenda:{das:{enabled:true,day:31,hour:7}},empresas:[]}),saveRotinas:jest.fn(()=>new Promise(r=>{concluir=r}))};render(<MemoryRouter><RotinasPage api={api}/></MemoryRouter>);fireEvent.click(screen.getByRole('tab',{name:'Configuração'}));await screen.findByLabelText('Dia de DAS');expect(screen.getByText(/a rotina não será executada naquele mês/)).toBeVisible();expect(screen.queryByText(/usamos o último dia/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Salvar horários'}));expect(screen.getByLabelText('Dia de DAS')).toBeDisabled();expect(screen.getByRole('button',{name:'Descartar alterações de horário'})).toBeDisabled();await act(async()=>concluir({}));});

test('horário dos lembretes é independente da consulta fiscal mensal',async()=>{
 const api={getRotinas:async()=>({rotinas:[{key:'pagamento',label:'Pagamento'},{key:'avisos_guias_whatsapp',label:'Lembretes de guias no WhatsApp'}],agenda:{pagamento:{enabled:true,frequency:'MONTHLY',day:25,hour:8},avisos_guias_whatsapp:{enabled:false,frequency:'DAILY',day:1,hour:8}},empresas:[]}),saveRotinas:jest.fn(async b=>b)};
 render(<MemoryRouter><RotinasPage api={api}/></MemoryRouter>);
 fireEvent.click(screen.getByRole('tab',{name:'Configuração'}));
 fireEvent.click(await screen.findByLabelText('Ligar Lembretes de guias no WhatsApp'));
 expect(screen.getByText('Diariamente')).toBeVisible();
 expect(screen.queryByLabelText('Dia de Lembretes de guias no WhatsApp')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Horário de Lembretes de guias no WhatsApp'),{target:{value:'09:00'}});
 fireEvent.click(screen.getByRole('button',{name:'Salvar horários'}));
 await waitFor(()=>expect(api.saveRotinas).toHaveBeenCalledWith({agenda:{pagamento:{enabled:true,frequency:'MONTHLY',day:25,hour:8},avisos_guias_whatsapp:{enabled:true,frequency:'DAILY',day:1,hour:9}}}));
});

test('execução de lembretes sempre tem nome legível antes do cadastro de rotinas carregar',async()=>{
 const api={getRotinas:async()=>({rotinas:[],agenda:{},empresas:[],executions:[{routine:'avisos_guias_whatsapp',enabled:true,alive:true,lastRun:null}]})};
 render(<MemoryRouter><RotinasPage api={api}/></MemoryRouter>);
 expect(await screen.findByText('Lembretes de guias no WhatsApp')).toBeVisible();
 expect(screen.queryByText('avisos_guias_whatsapp')).not.toBeInTheDocument();
});
