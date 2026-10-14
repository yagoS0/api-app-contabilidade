import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ModalCorrigirValorGuia } from "../ModalCorrigirValorGuia";
const guia={id:"g1",linhaDigitavelValorLidoCentavos:82666};
const previa={guideId:"g1",companyId:"pc",novoValor:826.66,valorAtual:100,revisao:"rev1",lancamentosAfetados:1,pdfPreservado:true,linhaConfirmada:true};
const apiBase=()=>({preverCorrecaoValorGuia:jest.fn(async()=>previa),corrigirValorGuia:jest.fn(async()=>({ok:true}))});
test("corrigir exige prévia e confirmação, envia revisão exata e preserva PDF",async()=>{
 const api=apiBase();const aoCorrigir=jest.fn();render(<ModalCorrigirValorGuia api={api} companyId="pc" guia={guia} aoFechar={jest.fn()} aoCorrigir={aoCorrigir}/>);
 const confirmar=await screen.findByRole("button",{name:"Confirmar correção do valor"});expect(confirmar).toBeDisabled();
 fireEvent.click(await screen.findByRole("checkbox"));fireEvent.click(confirmar);
 await waitFor(()=>expect(api.corrigirValorGuia).toHaveBeenCalledWith("pc","g1",{valor:826.66,revisao:"rev1"}));
 expect(await screen.findByRole("status")).toHaveTextContent(/Nenhuma mensagem foi enviada/);expect(aoCorrigir).toHaveBeenCalledTimes(1);
});
test("PDF ou revisão recusados deixam confirmação bloqueada",async()=>{
 const api=apiBase();api.preverCorrecaoValorGuia.mockResolvedValue({...previa,linhaConfirmada:false});
 render(<ModalCorrigirValorGuia api={api} companyId="pc" guia={guia} aoFechar={jest.fn()}/>);
 expect(await screen.findByRole("alert")).toHaveTextContent(/prévia não confirmou/);expect(screen.getByRole("button",{name:"Confirmar correção do valor"})).toBeDisabled();expect(api.corrigirValorGuia).not.toHaveBeenCalled();
});
test("mudança concorrente invalida prévia e impede repetir POST antigo",async()=>{
 const api=apiBase();api.corrigirValorGuia.mockRejectedValue(new Error("A guia mudou. Abra uma nova prévia."));
 render(<ModalCorrigirValorGuia api={api} companyId="pc" guia={guia} aoFechar={jest.fn()}/>);
 fireEvent.click(await screen.findByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Confirmar correção do valor"}));
 await screen.findByRole("alert");expect(screen.getByRole("button",{name:"Confirmar correção do valor"})).toBeDisabled();expect(api.corrigirValorGuia).toHaveBeenCalledTimes(1);
});

test('prévia recusada por perfil explica acesso e não confirma alteração',async()=>{const api=apiBase();api.preverCorrecaoValorGuia.mockRejectedValue(new Error('insufficient_role'));render(<ModalCorrigirValorGuia api={api} companyId="pc" guia={guia} aoFechar={jest.fn()}/>);expect(await screen.findByRole('alert')).toHaveTextContent('exige perfil de contador');expect(api.corrigirValorGuia).not.toHaveBeenCalled();});
test('durante correção checkbox e saída ficam bloqueados',async()=>{let concluir;const api=apiBase();api.corrigirValorGuia.mockImplementation(()=>new Promise(r=>{concluir=r}));const fechar=jest.fn();render(<ModalCorrigirValorGuia api={api} companyId="pc" guia={guia} aoFechar={fechar}/>);fireEvent.click(await screen.findByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Confirmar correção do valor'}));expect(screen.getByRole('checkbox')).toBeDisabled();expect(screen.getByRole('button',{name:'Corrigindo…'})).toBeDisabled();fireEvent.keyDown(document,{key:'Escape'});expect(fechar).not.toHaveBeenCalled();await act(async()=>concluir({ok:true}));});
