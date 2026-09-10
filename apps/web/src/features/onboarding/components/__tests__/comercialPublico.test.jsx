
import { render,screen,fireEvent,waitFor } from "@testing-library/react";
import { PainelComercial } from "../PainelComercial";
import { FormularioPublico } from "../../pages/FormularioPublico";
const comercial={faseComercial:"LEAD",analises:[],links:[],eventos:[]};
test("salva proposta e gera link sem enviar mensagem ao cliente",async()=>{
 const api={getOnboardingComercial:jest.fn().mockResolvedValue(comercial),salvarOnboardingComercial:jest.fn().mockResolvedValue({ok:true}),criarLinkOnboarding:jest.fn().mockResolvedValue({token:"segredo",link:{id:"l",expiresAt:"2026-09-15"}})};
 render(<PainelComercial api={api} onboardingId="lead-1" />);
 await screen.findByText("Salvar atendimento");fireEvent.change(screen.getByLabelText("Honorários mensais (R$)"),{target:{value:"250,50"}});
 fireEvent.click(screen.getByText("Salvar atendimento"));await waitFor(()=>expect(api.salvarOnboardingComercial).toHaveBeenCalledWith("lead-1",{faseComercial:"LEAD",proposta:{texto:"",valorMensal:250.5}}));
 await screen.findByText("Gerar link de preenchimento");fireEvent.click(screen.getByText("Gerar link de preenchimento"));
 await waitFor(()=>expect(screen.getByLabelText("Link pessoal").value).toContain("/onboarding/publico#token=segredo"));
});
test("erro na consulta comercial é explícito e oferece recarga",async()=>{
 render(<PainelComercial api={{getOnboardingComercial:jest.fn().mockRejectedValue(new Error("Indisponível"))}} onboardingId="x" />);
 expect(await screen.findByRole("alert")).toHaveTextContent("Indisponível");expect(screen.getByText("Recarregar atendimento")).toBeInTheDocument();
});
test("formulário público salva progressivamente e consome somente no envio confirmado",async()=>{
 window.history.replaceState(null,"","/onboarding/publico#token=abc");
 const onboarding={origem:"ABERTURA",dados:{razaoSocial:"Empresa"},ultimoPasso:"identificacao",versao:0};
 const api={consultarFormularioOnboarding:jest.fn().mockResolvedValue({onboarding}),salvarFormularioOnboarding:jest.fn().mockImplementation(async(_t,p)=>({onboarding:{...onboarding,...p,versao:p.versao+1}}))};
 render(<FormularioPublico api={api}/>);await screen.findByText("Salvar e continuar");
 fireEvent.click(screen.getByText("Salvar e continuar"));await waitFor(()=>expect(api.salvarFormularioOnboarding).toHaveBeenCalledWith("abc",expect.objectContaining({finalizar:false,versao:0,ultimoPasso:"responsavel"})));
 expect(window.location.hash).toBe("#token=abc");
});
test("link ausente não consulta o servidor",async()=>{
 window.history.replaceState(null,"","/onboarding/publico");const api={consultarFormularioOnboarding:jest.fn()};render(<FormularioPublico api={api}/>);
 expect(await screen.findByRole("alert")).toHaveTextContent("Link incompleto");expect(api.consultarFormularioOnboarding).not.toHaveBeenCalled();
});

test("envio final exige conferência explícita e limpa token do endereço",async()=>{
 window.history.replaceState(null,"","/onboarding/publico#token=final");
 const onboarding={origem:"ABERTURA",dados:{razaoSocial:"Empresa"},ultimoPasso:"revisao",versao:3};
 const api={consultarFormularioOnboarding:jest.fn().mockResolvedValue({onboarding}),salvarFormularioOnboarding:jest.fn().mockResolvedValue({ok:true})};
 render(<FormularioPublico api={api}/>);
 const enviar=await screen.findByText("Enviar cadastro ao escritório");expect(enviar).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(enviar);
 await screen.findByText(/Cadastro enviado/);expect(api.salvarFormularioOnboarding).toHaveBeenCalledWith("final",expect.objectContaining({versao:3,finalizar:true}));expect(window.location.hash).toBe("");
});

test("aviso ao sair só aparece quando há mudanças ainda não salvas",async()=>{
 window.history.replaceState(null,"","/onboarding/publico#token=dirty");
 const onboarding={origem:"ABERTURA",dados:{razaoSocial:"Empresa"},ultimoPasso:"identificacao",versao:0};
 const api={consultarFormularioOnboarding:jest.fn().mockResolvedValue({onboarding}),salvarFormularioOnboarding:jest.fn().mockImplementation(async(_t,p)=>({onboarding:{...onboarding,...p,versao:p.versao+1}}))};
 const r=render(<FormularioPublico api={api}/>);const campo=await screen.findByLabelText(/Nome pretendido/);
 const sair=()=>{const e=new Event("beforeunload",{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;};
 expect(sair()).toBe(false);fireEvent.change(campo,{target:{value:"Nova empresa"}});expect(sair()).toBe(true);
 fireEvent.change(campo,{target:{value:"Empresa"}});expect(sair()).toBe(false);
 fireEvent.change(campo,{target:{value:"Nova empresa"}});fireEvent.click(screen.getByText("Salvar para continuar depois"));
 await screen.findByText(/Dados salvos/);expect(sair()).toBe(false);
 fireEvent.change(campo,{target:{value:"Não salvo"}});expect(sair()).toBe(true);r.unmount();expect(sair()).toBe(false);
});

test("consultar e revogar preservam a proposta ainda não salva",async()=>{
 const estado={...comercial,proposta:{texto:"Salvo",valorMensal:100},links:[{id:"l",expiresAt:"2099-01-01"}]};
 const api={getOnboardingComercial:jest.fn().mockResolvedValue(estado),criarAnaliseOnboarding:jest.fn().mockResolvedValue({ok:true}),revogarLinkOnboarding:jest.fn().mockResolvedValue({ok:true})};
 render(<PainelComercial api={api} onboardingId="a"/>);const campo=await screen.findByLabelText("Proposta e condições");fireEvent.change(campo,{target:{value:"Proposta em edição"}});
 fireEvent.click(screen.getByText("Consultar dados públicos"));await waitFor(()=>expect(api.getOnboardingComercial).toHaveBeenCalledTimes(2));expect(campo).toHaveValue("Proposta em edição");
 fireEvent.click(screen.getByText("Revogar link"));await waitFor(()=>expect(api.getOnboardingComercial).toHaveBeenCalledTimes(3));expect(campo).toHaveValue("Proposta em edição");
});
test("geração atualiza links sem perder token ou proposta; vencido aparece expirado",async()=>{
 const inicial={...comercial,links:[{id:"velho",expiresAt:"2000-01-01"}]};const novo={id:"novo",expiresAt:"2099-01-01"};
 const api={getOnboardingComercial:jest.fn().mockResolvedValueOnce(inicial).mockResolvedValue({...inicial,links:[{...inicial.links[0],revokedAt:"2026-09-08"},novo]}),criarLinkOnboarding:jest.fn().mockResolvedValue({token:"token-novo",link:novo})};
 render(<PainelComercial api={api} onboardingId="a"/>);const campo=await screen.findByLabelText("Proposta e condições");expect(screen.getByText(/Expirado/)).toBeInTheDocument();fireEvent.change(campo,{target:{value:"Preservar"}});fireEvent.click(screen.getByText("Gerar link de preenchimento"));
 await waitFor(()=>expect(api.getOnboardingComercial).toHaveBeenCalledTimes(2));expect(campo).toHaveValue("Preservar");expect(screen.getByLabelText("Link pessoal").value).toContain("token-novo");expect(screen.getByText(/Revogado/)).toBeInTheDocument();expect(screen.getAllByText("Revogar link")).toHaveLength(1);
});
