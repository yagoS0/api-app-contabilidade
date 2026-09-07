import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PainelArquivosWhatsapp, arquivoDoConteudo } from "../PainelArquivosWhatsapp";
const arquivo={id:"a1",nomeArquivo:"extrato.ofx",mimeType:"application/x-ofx",estado:"DISPONIVEL",podeAbrir:true,podeImportarOfx:true,recebidoEm:"2026-09-07",expiraEm:"2026-12-06"};
const contas=[{codigo:"111",nome:"Caixa",tipo:"ATIVO"},{codigo:"412",nome:"Tarifas",tipo:"DESPESA"}];
const criarApi=(over={})=>({
 listarArquivosWhatsappNaoVinculados:jest.fn(async()=>({arquivos:[{id:"sem1",nomeArquivo:"sem-empresa.ofx"}],temMais:true})),
 vincularArquivoWhatsapp:jest.fn(async()=>({ok:true})),
 listarArquivosWhatsapp:jest.fn(async()=>({arquivos:[arquivo],proximoCursor:null})),
 getConteudoArquivoWhatsapp:jest.fn(async()=>({nomeArquivo:"extrato.ofx",mimeType:"application/x-ofx",base64:btoa("OFXHEADER:100")})),
 previewOFX:jest.fn(async()=>({transactions:[{rowIndex:1,data:"2026-09-07",descricaoOfx:"TARIFA",valor:20,sinal:"DEBITO",match:{historicoSugerido:"TARIFA BANCÁRIA",contaDebito:"412",contaCredito:"111"}}]})),
 importOFX:jest.fn(async()=>({ok:true,created:1,failed:0,loteImportacao:"l1"})),
 marcarArquivoWhatsappImportado:jest.fn(async()=>({ok:true})),searchHistoricos:jest.fn(async()=>[]),getHistoricosByCode:jest.fn(async()=>[]),...over,
});
async function abrirImportacao(api){
 render(<PainelArquivosWhatsapp api={api} companyId="pc1" contas={contas} podeEscrever/>);
 fireEvent.click(await screen.findByRole("button",{name:"Conferir e importar OFX"}));
 await screen.findByRole("button",{name:"Pré-visualizar"});
}
test("receber arquivo não lê nem importa; revisão e confirmação precedem registro de importado",async()=>{
 const api=criarApi();await abrirImportacao(api);
 expect(api.previewOFX).not.toHaveBeenCalled();expect(api.importOFX).not.toHaveBeenCalled();expect(api.marcarArquivoWhatsappImportado).not.toHaveBeenCalled();
 expect(screen.getByText(/90 dias/)).toBeInTheDocument();expect(screen.queryByDisplayValue("extrato.ofx")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Pré-visualizar"}));
 fireEvent.click(await screen.findByRole("button",{name:"Importar 1 linha"}));
 await screen.findByText(/Importação registrada/);
 expect(api.importOFX).toHaveBeenCalledTimes(1);
 expect(api.importOFX).toHaveBeenCalledWith("pc1",expect.objectContaining({arquivoWhatsappId:"a1",transactions:expect.any(Array)}));
 expect(api.marcarArquivoWhatsappImportado).not.toHaveBeenCalled();
});
test("falha de importação não marca o arquivo, e transporte incerto não dispara novamente",async()=>{
 const api=criarApi({importOFX:jest.fn(async()=>{throw new Error("Conexão interrompida")})});await abrirImportacao(api);
 fireEvent.click(screen.getByRole("button",{name:"Pré-visualizar"}));fireEvent.click(await screen.findByRole("button",{name:"Importar 1 linha"}));
 await screen.findByText("Conexão interrompida");fireEvent.click(screen.getByRole("button",{name:"Importar 1 linha"}));
 await screen.findByText(/A tentativa anterior não foi confirmada/);expect(api.importOFX).toHaveBeenCalledTimes(1);expect(api.marcarArquivoWhatsappImportado).not.toHaveBeenCalled();
});
test("importação em andamento bloqueia atualizar e abrir outro arquivo",async()=>{
 let concluir; const api=criarApi({importOFX:jest.fn(()=>new Promise(resolve=>{concluir=resolve}))});await abrirImportacao(api);
 fireEvent.click(screen.getByRole("button",{name:"Pré-visualizar"}));fireEvent.click(await screen.findByRole("button",{name:"Importar 1 linha"}));
 await waitFor(()=>expect(api.importOFX).toHaveBeenCalledTimes(1));
 expect(screen.getByRole("button",{name:"Atualizar arquivos"})).toBeDisabled();
 expect(screen.getByRole("button",{name:"Conferir e importar OFX"})).toBeDisabled();
 concluir({ok:true,created:1,failed:0,repetido:true});await screen.findByText(/nenhum lançamento foi duplicado/);
 expect(api.marcarArquivoWhatsappImportado).not.toHaveBeenCalled();
});
test("resposta parcial conservadora bloqueia reimportação do mesmo arquivo",async()=>{
 const api=criarApi({importOFX:jest.fn(async()=>({ok:true,created:1,failed:1}))});await abrirImportacao(api);
 fireEvent.click(screen.getByRole("button",{name:"Pré-visualizar"}));fireEvent.click(await screen.findByRole("button",{name:"Importar 1 linha"}));
 await screen.findByText(/A importação teve falhas parciais/);
 expect(screen.getByRole("button",{name:"Conferir e importar OFX"})).toBeDisabled();expect(api.marcarArquivoWhatsappImportado).not.toHaveBeenCalled();
});
test("arquivos sem empresa exigem escolha e confirmação sem abrir conteúdo",async()=>{
 const api=criarApi();render(<PainelArquivosWhatsapp api={api} companyId="pc1" podeEscrever/>);
 expect(api.listarArquivosWhatsappNaoVinculados).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Ver arquivos sem empresa"}));
 fireEvent.click(await screen.findByRole("button",{name:"Escolher arquivo"}));
 const enviar=screen.getByRole("button",{name:"Vincular arquivo a esta empresa"});expect(enviar).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(enviar);
 await waitFor(()=>expect(api.vincularArquivoWhatsapp).toHaveBeenCalledWith("pc1","sem1"));
 expect(api.getConteudoArquivoWhatsapp).not.toHaveBeenCalled();expect(api.importOFX).not.toHaveBeenCalled();
});
test.each(["application/pdf","image/png","image/jpeg"])("preserva MIME seguro %s ao abrir original",mimeType=>{
 expect(arquivoDoConteudo({nomeArquivo:"original",mimeType,base64:btoa("original")}).type).toBe(mimeType);
});
test("PDF e arquivo expirado respeitam capacidades e não oferecem importação OFX",async()=>{
 const api=criarApi({listarArquivosWhatsapp:jest.fn(async()=>({arquivos:[{...arquivo,nomeArquivo:"extrato.pdf",mimeType:"application/pdf",estado:"EXPIRADO",podeAbrir:false,podeImportarOfx:false}],proximoCursor:null}))});
 render(<PainelArquivosWhatsapp api={api} companyId="pc1" podeEscrever/>);
 expect(await screen.findByRole("button",{name:"Abrir arquivo"})).toBeDisabled();expect(screen.queryByRole("button",{name:"Conferir e importar OFX"})).toBeNull();expect(api.getConteudoArquivoWhatsapp).not.toHaveBeenCalled();
});
test("falha de listagem aparece como falha, sem afirmar caixa vazia",async()=>{
 const api=criarApi({listarArquivosWhatsapp:jest.fn(async()=>{throw new Error("Sem acesso aos arquivos")})});
 render(<PainelArquivosWhatsapp api={api} companyId="pc1"/>);expect(await screen.findByRole("alert")).toHaveTextContent("Sem acesso aos arquivos");expect(screen.queryByText(/Nenhum arquivo recebido/)).toBeNull();
});

test("fila sem empresa mostra origem e carrega páginas anteriores por cursor",async()=>{
 const api=criarApi({listarArquivosWhatsappNaoVinculados:jest.fn().mockResolvedValueOnce({arquivos:[{id:"s1",nomeArquivo:"um.ofx",remetente:"Cliente A",telefone:"5521999998888"}],temMais:true,proximoCursor:"s1"}).mockResolvedValue({arquivos:[{id:"s2",nomeArquivo:"dois.ofx"}],temMais:false,proximoCursor:null})});
 render(<PainelArquivosWhatsapp api={api} companyId="pc1" podeEscrever/>);
 fireEvent.click(screen.getByRole("button",{name:"Ver arquivos sem empresa"}));
 expect(await screen.findByText(/Cliente A/)).toHaveTextContent("5521999998888");
 fireEvent.click(screen.getByRole("button",{name:"Carregar mais sem empresa"}));
 await screen.findByText("dois.ofx");expect(screen.getByText("um.ofx")).toBeInTheDocument();
 expect(api.listarArquivosWhatsappNaoVinculados).toHaveBeenLastCalledWith("pc1",{cursor:"s1"});
});
