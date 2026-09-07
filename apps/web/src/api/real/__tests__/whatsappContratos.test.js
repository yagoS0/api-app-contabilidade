import { createRealApi } from "../realApi";
test("lixeira e restauração usam POST no segmento indicado; histórico mantém filtro e empresa", async () => {
 const api = createRealApi();
 await api.excluirConversaWhatsapp("cv/legado");
 expect(fetch.mock.calls[0][0]).toMatch(/conversas\/cv%2Flegado\/excluir$/);
 expect(fetch.mock.calls[0][1].method).toBe("POST");
 await api.restaurarConversaWhatsapp("cv/legado");
 expect(fetch.mock.calls[1][0]).toMatch(/conversas\/cv%2Flegado\/restaurar$/);
 expect(fetch.mock.calls[1][1].method).toBe("POST");
 await api.listarConversasWhatsapp("historico", { empresa: "pc1", cursor: "cv-antigo" });
 expect(Object.fromEntries(new URL(fetch.mock.calls[2][0]).searchParams)).toEqual({ filtro: "historico", empresa: "pc1", cursor: "cv-antigo" });
});
beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })); });
afterEach(() => { delete global.fetch; });
test("cursor e limite são enviados na lista e no histórico, preservando empresa", async () => {
 const api=createRealApi();
 await api.listarConversasWhatsapp("todas",{empresa:"pc1",cursor:"cv/2",limite:50});
 const lista=new URL(fetch.mock.calls[0][0]);expect(lista.pathname).toBe("/firm/whatsapp/conversas");
 expect(Object.fromEntries(lista.searchParams)).toEqual({filtro:"todas",empresa:"pc1",cursor:"cv/2",limite:"50"});
 await api.getMensagensWhatsapp("cv1",{cursor:"m/2",limite:50});
 const mensagens=new URL(fetch.mock.calls[1][0]);expect(mensagens.pathname).toBe("/firm/whatsapp/conversas/cv1/mensagens");expect(mensagens.searchParams.get("cursor")).toBe("m/2");
});
test("importação vincula arquivo à transação e preserva contrato do OFX comum",async()=>{
 const api=createRealApi();const transactions=[{rowIndex:1}];
 await api.importOFX("pc1",{transactions,arquivoWhatsappId:"a1"});
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({transactions,arquivoWhatsappId:"a1"});
 await api.importOFX("pc1",{transactions});expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({transactions});
});
test("fila e vínculo manual usam a empresa escolhida; leitura não abre conteúdo",async()=>{
 const api=createRealApi();await api.listarArquivosWhatsapp("pc1",{cursor:"a/2"});
 expect(new URL(fetch.mock.calls[0][0]).searchParams.get("cursor")).toBe("a/2");
 await api.listarArquivosWhatsappNaoVinculados("pc1");expect(fetch.mock.calls[1][0]).toMatch(/companies\/pc1\/whatsapp\/arquivos\/nao-vinculados$/);
 await api.vincularArquivoWhatsapp("pc1","a1");expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({confirmarCompanyId:"pc1"});expect(fetch.mock.calls[2][1].method).toBe("POST");
});
test("recusa com mensagem em português mantém código e frase",async()=>{
 global.fetch=jest.fn(async()=>({ok:false,status:409,json:async()=>({error:"ESCOPO_NAO_VERIFICADO",mensagem:"Confirme a empresa desta conversa."})}));
 await expect(createRealApi().devolverConversaWhatsapp("cv1")).rejects.toMatchObject({code:"ESCOPO_NAO_VERIFICADO",message:"Confirme a empresa desta conversa."});
});
