import { registrarVersaoPgdas, listarHistoricoPgdas, arquivoHistoricoPgdas, hashDocumentoPgdas } from "../PgdasHistoricoService.js";
jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
let db, registros;
const circular={pgdasNumeroDeclaracao:"123",pgdasDeclaracaoFileId:"pdf-1",pgdasReciboFileId:"rec-1",receitaBruta:100,dasTotal:6};
beforeEach(()=>{registros=new Map();db={apuracaoSnapshot:{findUnique:jest.fn(async()=>null)},appSetting:{upsert:jest.fn(async a=>{if(!registros.has(a.where.key))registros.set(a.where.key,a.create);return registros.get(a.where.key);}),findMany:jest.fn(async()=>[...registros.values()].reverse()),findUnique:jest.fn(async a=>registros.get(a.where.key))},companyMonthlyCircular:{findUnique:jest.fn(async()=>circular)}};});
test("mesmo conteúdo não duplica nem altera referência preservada",async()=>{
 const input={companyId:"a",competencia:"2026-09",circular,hashes:[hashDocumentoPgdas(Buffer.from("pdf")),"rec"]};
 const id=await registrarVersaoPgdas(input,db);
 await registrarVersaoPgdas({...input,circular:{...circular,pgdasDeclaracaoFileId:"pdf-2"}},db);
 expect(registros.size).toBe(1);expect([...registros.values()][0].value.declaracaoFileId).toBe("pdf-1");
 expect(await arquivoHistoricoPgdas("a","2026-09",id,"declaracao",db)).toBe("pdf-1");
 expect(await arquivoHistoricoPgdas("b","2026-09",id,"declaracao",db)).toBeNull();
});
test("lista registro legado sem escrever ou consultar provedor",async()=>{
 const r=await listarHistoricoPgdas("a","2026-09",db);
 expect(r.versoes).toHaveLength(1);expect(r.versoes[0]).toMatchObject({legado:true,atual:true,numeroDeclaracao:"123"});
 expect(db.appSetting.upsert).not.toHaveBeenCalled();
});
test("número novo é comparável sem apagar versão anterior",async()=>{
 await registrarVersaoPgdas({companyId:"a",competencia:"2026-09",circular,legado:true},db);
 const nova={...circular,pgdasNumeroDeclaracao:"124",receitaBruta:200,dasTotal:12,pgdasDeclaracaoFileId:"pdf-2"};
 const id=await registrarVersaoPgdas({companyId:"a",competencia:"2026-09",circular:nova},db);
 db.companyMonthlyCircular.findUnique.mockResolvedValue({...nova,metadata:{pgdasHistoricoId:id}});
 const r=await listarHistoricoPgdas("a","2026-09",db);
 expect(r.mudancaDetectada).toBe(true);expect(r.versoes.map(v=>v.numeroDeclaracao)).toEqual(["124","123"]);
 expect(r.versoes[0].atual).toBe(true);expect(r.versoes[1].dasTotal).toBe(6);
});
test("mudança de arquivo do mesmo número não afirma retificação",async()=>{
 await registrarVersaoPgdas({companyId:"a",competencia:"2026-09",circular},db);
 await registrarVersaoPgdas({companyId:"a",competencia:"2026-09",circular:{...circular,pgdasReciboFileId:"rec-2"}},db);
 expect((await listarHistoricoPgdas("a","2026-09",db)).mudancaDetectada).toBe(false);
});


test("apurada fora do fluxo interno tem evidência sem fechar apuração",async()=>{
 db.apuracaoSnapshot.findUnique.mockResolvedValue({estado:"aberta",numeroDeclaracao:null});
 const r=await listarHistoricoPgdas("a","2026-09",db);
 expect(r).toMatchObject({estadoInterno:"aberta",entregaSemTransmissaoInterna:true,declaracaoDiferenteDaInterna:false});
 expect(db.appSetting.upsert).not.toHaveBeenCalled();
});
test("números diferentes não atribuem origem externa nem ordenam transmissão",async()=>{
 db.apuracaoSnapshot.findUnique.mockResolvedValue({estado:"transmitida",numeroDeclaracao:"124"});
 expect(await listarHistoricoPgdas("a","2026-09",db)).toMatchObject({entregaSemTransmissaoInterna:false,declaracaoDiferenteDaInterna:true});
});
