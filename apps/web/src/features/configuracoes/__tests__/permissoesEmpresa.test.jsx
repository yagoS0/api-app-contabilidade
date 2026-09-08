
import { render,screen } from "@testing-library/react";
import { CompanyDetailPage } from "../../companies/detail/pages/renderCompanyDetailPage";
import { useContatosWhatsapp } from "../../companies/credentials/hooks/useContatosWhatsapp";
import { useAcessoPortalCliente } from "../../companies/credentials/hooks/useAcessoPortalCliente";
jest.mock("../../../api/client",()=>({createApiClient:()=>({})}));
jest.mock("../../companies/credentials/hooks/useContatosWhatsapp",()=>({useContatosWhatsapp:jest.fn(()=>({}))}));
jest.mock("../../companies/credentials/hooks/useAcessoPortalCliente",()=>({useAcessoPortalCliente:jest.fn(()=>({usuarios:[]}))}));
jest.mock("../../companies/credentials/components/ContatosWhatsapp",()=>({ContatosWhatsapp:()=> <p>Editor de contatos</p>}));
jest.mock("../../companies/credentials/components/AcessoPortalCliente",()=>({AcessoPortalCliente:()=> <p>Acesso do cliente ao portal</p>}));
jest.mock("../../companies/certificate/components/CompanyCertificatePanel",()=>({CompanyCertificatePanel:()=> <p>Editor de certificado</p>}));
const props=(tab,canEdit)=>({company:{selectedCompany:{companyId:"a",razao:"Empresa",cnpj:"123",legacyCompany:{regimeTributario:"SIMPLES"}},companyDetailTab:tab,canEditCompany:canEdit,onBack:jest.fn(),setCompanyDetailTab:jest.fn()},feedback:{},certPanel:{api:{}}});
beforeEach(()=>jest.clearAllMocks());
test("acesso direto a contatos sem permissão não monta hooks nem editor",()=>{render(<CompanyDetailPage {...props("comunicacao",false)}/>);expect(screen.getByText(/Apenas admin ou contador pode gerenciar contatos/)).toBeInTheDocument();expect(useContatosWhatsapp).not.toHaveBeenCalled();expect(useAcessoPortalCliente).not.toHaveBeenCalled();});
test("gestor recebe contato e acesso portal na mesma seção",()=>{render(<CompanyDetailPage {...props("comunicacao",true)}/>);expect(screen.getByText("Editor de contatos")).toBeInTheDocument();expect(screen.getByText("Acesso do cliente ao portal")).toBeInTheDocument();expect(useAcessoPortalCliente).toHaveBeenCalledWith(expect.objectContaining({companyId:"a"}));});
test("certificado protege deep link sem permissão",()=>{render(<CompanyDetailPage {...props("certificado",false)}/>);expect(screen.getByText(/Apenas admin ou contador pode gerenciar certificados/)).toBeInTheDocument();expect(screen.queryByText("Editor de certificado")).toBeNull();});
test("gestor carrega editor de certificado",async()=>{render(<CompanyDetailPage {...props("certificado",true)}/>);expect(await screen.findByText("Editor de certificado")).toBeInTheDocument();});
