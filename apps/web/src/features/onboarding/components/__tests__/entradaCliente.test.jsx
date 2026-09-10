import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
