import { autorizarChamada, concluirChamada, consumoDoMes, segundosDeCooldown } from "../SerproCallGuard.js";
import { comContextoSerpro } from "../serproCallContext.js";

const payload = { contribuinte: { numero: "12345678000190" }, pedidoDados: { idSistema: "PGDASD", idServico: "GERARDAS12", dados: "{}" } };
function banco() {
  const rows = []; let contador = 0, fila = Promise.resolve();
  const match = (r, w) => Object.entries(w || {}).every(([k,v]) => v && typeof v === "object"
    ? v.in ? v.in.includes(r[k]) : v.gte ? new Date(r[k]) >= v.gte : false : r[k] === v);
  const client = {
    rows,
    portalClient: { count: jest.fn(async () => 10), findFirst: jest.fn(async () => ({ id: "empresa" })) },
    serproChamada: {
      findFirst: jest.fn(async ({where}) => rows.filter((r) => match(r,where)).at(-1) || null),
      count: jest.fn(async ({where}) => rows.filter((r) => match(r,where)).length),
      create: jest.fn(async ({data}) => { const r = { id: String(++contador), createdAt: new Date(), ...data }; rows.push(r); return r; }),
      updateMany: jest.fn(async ({where,data}) => { const matches = rows.filter((r) => match(r,where)); matches.forEach((r) => Object.assign(r,data)); return {count: matches.length}; }),
    },
    $queryRaw: jest.fn(async () => [{ locked: 1 }]),
    // Modelo do lock transacional. SQL/semântica PostgreSQL precisam do banco na integração.
    $transaction: jest.fn((fn) => { const executar = fila.then(() => fn(client)); fila = executar.catch(() => {}); return executar; }),
  };
  return client;
}
const reservar = (client, body = payload) => autorizarChamada({ payload: body, rota: "/Emitir" }, client);

test("duas tentativas concorrentes idênticas reservam somente uma operação", async () => {
  const client = banco();
  const resultados = await Promise.allSettled([reservar(client), reservar(client)]);
  expect(resultados.map(r=>r.status).sort()).toEqual(["fulfilled","rejected"]);
  expect(client.rows.filter(r=>r.status === "reservada")).toHaveLength(1);
  expect(resultados.find(r=>r.status === "rejected").reason.code).toBe("SERPRO_CHAMADA_EM_ANDAMENTO");
  expect(client.$queryRaw).toHaveBeenCalledTimes(2);
});
test("chamadas diferentes concorrentes respeitam a última vaga do teto", async () => {
  const client = banco();
  for (let i=0;i<59;i++) client.rows.push({ id:`base${i}`, cnpj:payload.contribuinte.numero, assinatura:`s${i}`, status:"ok", createdAt:new Date() });
  const outro = { ...payload, pedidoDados: { ...payload.pedidoDados, dados:'{"pa":2}' } };
  const r = await Promise.allSettled([reservar(client), reservar(client,outro)]);
  expect(r.filter(v=>v.status === "fulfilled")).toHaveLength(1);
  expect(r.find(v=>v.status === "rejected").reason.code).toBe("SERPRO_TETO_DIARIO");
});
test("falha de medição ou reserva impede autorização, sem inventar zero", async () => {
  const client = banco(); client.serproChamada.count.mockRejectedValue(new Error("offline"));
  await expect(consumoDoMes(client)).rejects.toMatchObject({code:"SERPRO_MEDICAO_INDISPONIVEL"});
  await expect(reservar(client)).rejects.toMatchObject({code:"SERPRO_MEDICAO_INDISPONIVEL"});
  const outro = banco(); outro.serproChamada.create.mockRejectedValue(new Error("offline"));
  await expect(reservar(outro)).rejects.toMatchObject({code:"SERPRO_MEDICAO_INDISPONIVEL"});
});
test("autenticação abortada libera orçamento; reserva desconhecida não expira", async () => {
  const client = banco(), a = await reservar(client);
  await concluirChamada(a,{abortadaAuth:true,erroCodigo:"AUTH"},client);
  expect((await consumoDoMes(client)).usadas).toBe(0);
  const b = await reservar(client);
  client.rows.find(r=>r.id === b.id).createdAt = new Date("2020-01-01");
  await expect(reservar(client)).rejects.toMatchObject({code:"SERPRO_CHAMADA_EM_ANDAMENTO"});
});
test("falha ao concluir mantém reserva e impede repetição", async () => {
  const client=banco(), a=await reservar(client);
  client.serproChamada.updateMany.mockRejectedValue(new Error("offline"));
  await expect(concluirChamada(a,{httpStatus:200},client)).rejects.toMatchObject({code:"SERPRO_REGISTRO_INDETERMINADO"});
  await expect(reservar(client)).rejects.toMatchObject({code:"SERPRO_CHAMADA_EM_ANDAMENTO"});
});
test("erro sem resposta é incerto e continua reservado; erro HTTP conhecido entra no orçamento", async () => {
  for(const resultado of [{erroCodigo:"TIMEOUT"},{httpStatus:400,erroCodigo:"HTTP_400"}]) {
    const client=banco(), a=await reservar(client); await concluirChamada(a,resultado,client);
    expect(client.rows[0].status).toBe(resultado.httpStatus ? "erro" : "incerta");
    expect((await consumoDoMes(client)).usadas).toBe(1);
  }
});
test("cooldown diferencia rejeição, falha transitória e protocolo assíncrono", () => {
  expect(segundosDeCooldown({status:"erro",httpStatus:400})).toBe(300);
  expect(segundosDeCooldown({status:"erro",httpStatus:503})).toBe(30);
  expect(segundosDeCooldown({status:"ok",httpStatus:202})).toBe(0);
  expect(segundosDeCooldown({status:"ok",httpStatus:304})).toBe(0);
});
test("liberação do teto registra identidade e não contorna operação em andamento", async () => {
  const client=banco(); for(let i=0;i<60;i++) client.rows.push({id:`b${i}`,cnpj:payload.contribuinte.numero,assinatura:`s${i}`,status:"ok",createdAt:new Date()});
  await comContextoSerpro({forcar:true,userId:"admin",origem:"manual:teste"}, async()=>{
    const a=await reservar(client); expect(a.forcado).toBe(true);
    expect(client.rows.at(-1)).toMatchObject({forcado:true,userId:"admin",origem:"manual:teste"});
    await expect(reservar(client)).rejects.toMatchObject({code:"SERPRO_CHAMADA_EM_ANDAMENTO"});
  });
});
