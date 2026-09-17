import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NovoAtendimentoModal } from "../NovoAtendimentoModal";
import { OnboardingsPage } from "../../pages/renderOnboardingsPage";
import { PainelComercial } from "../PainelComercial";
import { OnboardingDetailPage } from "../../pages/renderOnboardingDetailPage";

test("nova abertura prepara formulário do cliente sem criar ficha ao abrir ou cancelar", async () => {
  const criar = jest.fn().mockResolvedValue(undefined), fechar = jest.fn();
  render(<NovoAtendimentoModal onCriar={criar} onFechar={fechar} />);
  expect(screen.getByRole("radio", {name: "Vai abrir a empresa"})).toBeChecked();
  expect(screen.getByRole("radio", {name: /Cliente, por um link pessoal/})).toBeChecked();
  expect(criar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"Criar ficha para o cliente"}));
  await waitFor(() => expect(criar).toHaveBeenCalledWith({origem:"ABERTURA",modo:"cliente"}));
});

test("preenchimento interno e serviço escolhido são preservados", async () => {
  const criar = jest.fn().mockResolvedValue(undefined);
  render(<NovoAtendimentoModal onCriar={criar} onFechar={jest.fn()} />);
  fireEvent.click(screen.getByRole("radio",{name:"Está trocando de contador"}));
  fireEvent.click(screen.getByRole("radio",{name:/Escritório, durante/}));
  fireEvent.click(screen.getByRole("button",{name:"Iniciar preenchimento interno"}));
  await waitFor(() => expect(criar).toHaveBeenCalledWith({origem:"TRANSFERENCIA",modo:"escritorio"}));
});

test("falha de criação não induz POST duplicado e cancelar não grava", async () => {
  const criar = jest.fn().mockRejectedValue(new Error("Resposta perdida"));
  const {unmount} = render(<NovoAtendimentoModal onCriar={criar} onFechar={jest.fn()} />);
  fireEvent.click(screen.getByRole("button",{name:"Criar ficha para o cliente"}));
  await screen.findByRole("alert");
  expect(screen.getByRole("button",{name:"Criar ficha para o cliente"})).toBeDisabled();
  expect(criar).toHaveBeenCalledTimes(1);
  unmount(); criar.mockClear();
  render(<NovoAtendimentoModal onCriar={criar} onFechar={jest.fn()} />);
  fireEvent.click(screen.getByRole("button",{name:"Cancelar"}));
  expect(criar).not.toHaveBeenCalled();
});

test("fichas ainda em preenchimento aparecem na entrada e podem ser abertas", async () => {
  const item={id:"abertura-1",origem:"ABERTURA",status:"RASCUNHO",responsavelNome:"Ana"};
  const api={listarOnboardings:jest.fn().mockResolvedValue({itens:[item]})}, abrir=jest.fn();
  render(<OnboardingsPage api={api} onAbrir={abrir} onNovo={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button",{name:"Ana"}));
  expect(abrir).toHaveBeenCalledWith(item);
  expect(api.listarOnboardings).toHaveBeenCalledWith(expect.objectContaining({incluirRascunhos:true}));
});

test("gerar outro link exige confirmar que o anterior deixará de funcionar", async () => {
  const api={getOnboardingComercial:jest.fn().mockResolvedValue({links:[{id:"antigo",expiresAt:"2099-01-01"}]}),criarLinkOnboarding:jest.fn().mockResolvedValue({token:"novo",link:{id:"novo",expiresAt:"2099-01-01"}})};
  render(<PainelComercial api={api} onboardingId="a" />);
  fireEvent.click(await screen.findByRole("button",{name:"Gerar link de preenchimento"}));
  expect(screen.getByRole("dialog")).toHaveTextContent("O link atual deixará de funcionar");
  expect(api.criarLinkOnboarding).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Cancelar"}));
  expect(api.criarLinkOnboarding).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Gerar link de preenchimento"}));
  fireEvent.click(screen.getByRole("button",{name:"Substituir link"}));
  await screen.findByLabelText("Link pessoal");
  expect(api.criarLinkOnboarding).toHaveBeenCalledTimes(1);
});

test("atualizar respostas mantém o link gerado e a proposta em edição", async () => {
  const registro={id:"a",origem:"ABERTURA",status:"RASCUNHO",dados:{},etapas:[]};
  const api={getOnboarding:jest.fn().mockResolvedValue({onboarding:registro}), getOnboardingComercial:jest.fn().mockResolvedValue({links:[]}),criarLinkOnboarding:jest.fn().mockResolvedValue({token:"manter",link:{id:"l",expiresAt:"2099-01-01"}})};
  render(<OnboardingDetailPage api={api} onboardingId="a" />);
  fireEvent.click(await screen.findByRole("button",{name:"Gerar link de preenchimento"}));
  await screen.findByLabelText("Link pessoal");
  fireEvent.click(screen.getByText("Anotações comerciais e análises"));
  fireEvent.change(screen.getByLabelText("Proposta e condições"),{target:{value:"Proposta em edição"}});
  api.getOnboarding.mockResolvedValue({onboarding:{...registro,status:"RECEBIDO",dados:{responsavelNome:"Ana"}}});
  fireEvent.click(screen.getByRole("button",{name:"Atualizar ficha"}));
  await screen.findByText("Ficha atualizada com os dados salvos pelo cliente.");
  expect(screen.getByLabelText("Link pessoal").value).toContain("#token=manter");
  expect(screen.getByLabelText("Proposta e condições")).toHaveValue("Proposta em edição");
  expect(api.criarLinkOnboarding).toHaveBeenCalledTimes(1);
});

test("alternar comercial, dados e implantação preserva link, proposta e observação sem gravar", async () => {
  const registro={id:"a",origem:"ABERTURA",status:"EM_TRILHA",dados:{},etapas:[{id:"e",titulo:"Conferir endereço",obrigatoria:true}]};
  const api={getOnboarding:jest.fn().mockResolvedValue({onboarding:registro}),getOnboardingComercial:jest.fn().mockResolvedValue({links:[]}),criarLinkOnboarding:jest.fn().mockResolvedValue({token:"manter",link:{id:"l",expiresAt:"2099-01-01"}}),salvarEtapaOnboarding:jest.fn(),salvarOnboardingComercial:jest.fn()};
  render(<OnboardingDetailPage api={api} onboardingId="a" />);
  fireEvent.click(await screen.findByRole("button",{name:"Gerar link de preenchimento"}));
  await screen.findByLabelText("Link pessoal");
  fireEvent.click(screen.getByText("Anotações comerciais e análises"));
  fireEvent.change(screen.getByLabelText("Proposta e condições"),{target:{value:"Condições ainda em revisão"}});
  fireEvent.click(screen.getByRole("button",{name:"Implantação"}));
  expect(screen.queryByRole("button",{name:"Gerar link de preenchimento"})).not.toBeInTheDocument();
  expect(screen.getByText("Próxima pendência da checklist")).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"+ observação"}));
  fireEvent.change(screen.getByLabelText("Observação de Conferir endereço"),{target:{value:"Aguardando revisão"}});
  fireEvent.click(screen.getByRole("button",{name:"Dados do cliente"}));
  expect(screen.getByRole("region",{name:"Dados do cliente"})).toBeVisible();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Atendimento comercial"}));
  expect(screen.getByLabelText("Proposta e condições")).toHaveValue("Condições ainda em revisão");
  expect(screen.getByLabelText("Link pessoal").value).toContain("#token=manter");
  fireEvent.click(screen.getByRole("button",{name:"Implantação"}));
  expect(screen.getByLabelText("Observação de Conferir endereço")).toHaveValue("Aguardando revisão");
  expect(api.salvarEtapaOnboarding).not.toHaveBeenCalled();
  expect(api.salvarOnboardingComercial).not.toHaveBeenCalled();
});

test("lista inicia nos atendimentos ativos e conserva avulsos, desistências e carteira no histórico", async () => {
  const itens=[{id:"a",origem:"ABERTURA",status:"EM_TRILHA",responsavelNome:"Atendimento ativo"},{id:"b",origem:"INATIVA",status:"CONCLUIDO_AVULSO",responsavelNome:"Avulso entregue"},{id:"c",origem:"TRANSFERENCIA",status:"CONVERTIDO",responsavelNome:"Cliente na carteira"},{id:"d",origem:"ABERTURA",status:"DESISTIU",responsavelNome:"Desistência registrada"}];
  const api={listarOnboardings:jest.fn().mockResolvedValue({itens})};
  render(<OnboardingsPage api={api} onAbrir={jest.fn()} />);
  await screen.findByRole("button",{name:"Atendimento ativo"});
  expect(screen.queryByRole("button",{name:"Avulso entregue"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:/^Encerrados/}));
  for (const name of ["Avulso entregue","Cliente na carteira","Desistência registrada"]) expect(screen.getByRole("button",{name})).toBeVisible();
  expect(screen.queryByRole("button",{name:"Atendimento ativo"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:/^Todos/}));
  expect(screen.getByRole("button",{name:"Atendimento ativo"})).toBeVisible();
  expect(api.listarOnboardings).toHaveBeenCalledTimes(1);
});

test("ficha na carteira abre implantação como histórico e oferece os documentos da empresa", async () => {
  const abrir=jest.fn(), api={getOnboarding:jest.fn().mockResolvedValue({onboarding:{id:"a",origem:"ABERTURA",status:"CONVERTIDO",portalClientId:"portal-a",dados:{},etapas:[{id:"e",titulo:"Documento arquivado",obrigatoria:true,concluidaEm:null}]}})};
  render(<OnboardingDetailPage api={api} onboardingId="a" onAbrirEmpresa={abrir} />);
  const implantacao=await screen.findByRole("region",{name:"Implantação"});
  expect(within(implantacao).getByRole("checkbox")).toBeDisabled();
  expect(within(implantacao).getByRole("button",{name:"+ observação"})).toBeDisabled();
  expect(screen.queryByText("Próxima pendência da checklist")).not.toBeInTheDocument();
  fireEvent.click(within(implantacao).getByRole("button",{name:"Documentos da empresa"}));
  expect(abrir).toHaveBeenCalledWith("portal-a","documentos");
});

test("nova coleta sem conversa expõe gerar link e preserva seções escolhidas ao atualizar a ficha", async () => {
  const registro={id:"coleta",origem:"ABERTURA",status:"RASCUNHO",dados:{},etapas:[]};
  const comercial={onboarding:registro,propostas:[],contratos:[],documentos:[],trabalhos:[]};
  const api={getOnboarding:jest.fn().mockResolvedValue({onboarding:registro}),getOnboardingComercial:jest.fn().mockResolvedValue({links:[]}),comercial:jest.fn(async path => path === "/recursos" ? {recursos:[]} : comercial),criarLinkOnboarding:jest.fn().mockResolvedValue({token:"coleta-token",link:{id:"link-coleta",expiresAt:"2099-01-01"}})};
  render(<OnboardingDetailPage api={api} onboardingId="coleta" />);
  const gerar=await screen.findByRole("button",{name:"Gerar link de preenchimento"});
  expect(gerar).toBeVisible();
  expect(gerar).toBeEnabled();
  const formulario=screen.getByText("Formulário do cliente").closest("details");
  const jornada=screen.getByText("Jornada comercial e contratação").closest("details");
  expect(formulario).toHaveAttribute("open");
  expect(jornada).not.toHaveAttribute("open");
  fireEvent.click(gerar);
  expect((await screen.findByLabelText("Link pessoal")).value).toContain("coleta-token");
  fireEvent.click(screen.getByText("Jornada comercial e contratação"));
  await waitFor(() => expect(jornada).toHaveAttribute("open"));
  expect(await screen.findByRole("heading",{name:"Entender a abertura"})).toBeVisible();
  fireEvent.click(screen.getByText("Jornada comercial e contratação"));
  fireEvent.click(screen.getByText("Formulário do cliente"));
  await waitFor(() => expect(formulario).not.toHaveAttribute("open"));
  api.getOnboarding.mockResolvedValue({onboarding:{...registro,status:"RECEBIDO"}});
  fireEvent.click(screen.getByRole("button",{name:"Atualizar ficha"}));
  await screen.findByText("Ficha atualizada com os dados salvos pelo cliente.");
  expect(jornada).not.toHaveAttribute("open");
  expect(formulario).not.toHaveAttribute("open");
  expect(api.criarLinkOnboarding).toHaveBeenCalledTimes(1);
});
