jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../whatsapp/WhatsappLeaseService.js", () => ({
  adquirirLease: jest.fn(async id => ({ id, token: "owner" })),
  renovarLease: jest.fn(async () => true),
  liberarLease: jest.fn(async () => {}),
}));
jest.mock("../AssistenteComercialService.js", () => ({ responderLead: jest.fn(async () => ({ feito: true })) }));

import { enfileirarTurnoIa, processarTurnosIaUmaVez } from "../TurnoIaWhatsappService.js";
import { responderLead } from "../AssistenteComercialService.js";
import { adquirirLease, liberarLease } from "../../whatsapp/WhatsappLeaseService.js";

const agora = new Date("2026-09-09T12:00:00Z");
const logger = { error: jest.fn() };
const opcoes = { flag: true, piloto: ["pc-1"], comercialFlag: true, comercialPiloto: ["5511999999999"], agora, log: logger };
const job = (perfil = "LEAD") => ({ id: `job-${perfil}`, mensagemId: `msg-${perfil}`, conversaId: `cv-${perfil}`, portalClientId: perfil === "LEAD" ? null : "pc-1", perfil, status: "pendente", reservaToken: null, tentativas: 0 });
function banco(jobs = [job()]) {
  return {
    jobs,
    turnoIaWhatsapp: {
      findMany: jest.fn(async () => jobs.map(j => ({ ...j }))),
      updateMany: jest.fn(async ({ where, data }) => {
        const atual = jobs.find(j => j.id === where.id && (!where.status || j.status === where.status) && j.reservaToken === where.reservaToken);
        if (!atual) return { count: 0 };
        const { tentativas, ...resto } = data;
        Object.assign(atual, resto);
        if (tentativas) atual.tentativas += tentativas.increment;
        return { count: 1 };
      }),
    },
    mensagemWhatsapp: { findFirst: jest.fn(async () => null) },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  adquirirLease.mockImplementation(async id => ({ id, token: "owner" }));
  responderLead.mockImplementation(async () => ({ feito: true }));
});

test.each(["CLIENTE", "LEAD"])("enqueue %s mantém a pausa de 1500 ms e grava o perfil", async perfil => {
  const relogio = jest.spyOn(Date, "now").mockReturnValue(agora.getTime());
  const client = { turnoIaWhatsapp: { create: jest.fn(async ({ data }) => ({ id: "job", ...data })) } };
  try {
    const r = await enfileirarTurnoIa({ conversaId: "cv", mensagemId: "m", ...(perfil === "LEAD" ? { perfil } : { portalClientId: "pc-1" }), client });
    expect(r.perfil).toBe(perfil);
    expect(r.proximaTentativaEm.getTime()).toBe(agora.getTime() + 1500);
    expect(r.portalClientId).toBe(perfil === "LEAD" ? null : "pc-1");
  } finally { relogio.mockRestore(); }
});

test("reentrega devolve job existente sem reiniciar prazo nem trocar perfil", async () => {
  const existente = { ...job(), proximaTentativaEm: agora };
  const client = { turnoIaWhatsapp: {
    create: jest.fn(async () => { throw Object.assign(new Error("duplicado"), { code: "P2002" }); }),
    findUnique: jest.fn(async () => existente),
  } };
  const r = await enfileirarTurnoIa({ conversaId: existente.conversaId, mensagemId: existente.mensagemId, perfil: "LEAD", client });
  expect(r).toBe(existente);
  expect(client.turnoIaWhatsapp.findUnique).toHaveBeenCalledWith({ where: { mensagemId: existente.mensagemId } });
});

test("fila mista mantém filtros independentes, o mesmo lease e os assistentes separados", async () => {
  const client = banco([job("CLIENTE"), job("LEAD")]);
  const responder = jest.fn(async () => ({ feito: true }));
  const r = await processarTurnosIaUmaVez({ ...opcoes, client, responder });
  expect(r.processados).toBe(2);
  expect(responder).toHaveBeenCalledTimes(1);
  expect(responder).toHaveBeenCalledWith(expect.objectContaining({ conversaId: "cv-CLIENTE" }));
  expect(responderLead).toHaveBeenCalledTimes(1);
  expect(responderLead).toHaveBeenCalledWith(expect.objectContaining({ conversaId: "cv-LEAD", deps: expect.objectContaining({ leaseExterno: true, conferirLease: expect.any(Function) }) }));
  expect(adquirirLease.mock.calls.map(([id]) => id)).toEqual(["ia:cv-CLIENTE", "ia:cv-LEAD"]);
  expect(liberarLease).toHaveBeenCalledTimes(2);
  const filtro = client.turnoIaWhatsapp.findMany.mock.calls[0][0].where;
  expect(filtro.AND[0].OR).toEqual([
    { perfil: "CLIENTE", portalClientId: { in: ["pc-1"] } },
    { perfil: "LEAD", portalClientId: null, conversa: { telefoneE164: { in: ["5511999999999"] }, portalClientId: null } },
  ]);
  expect(filtro.OR[0].proximaTentativaEm).toEqual({ lte: agora });
});

test.each([
  { flag: false, piloto: ["pc-1"], comercialFlag: false, comercialPiloto: ["5511999999999"] },
  { flag: true, piloto: [], comercialFlag: true, comercialPiloto: [] },
])("flags ou pilotos vazios não leem jobs", async flags => {
  const client = banco();
  const r = await processarTurnosIaUmaVez({ ...opcoes, ...flags, client, responder: jest.fn() });
  expect(r.processados).toBe(0);
  expect(client.turnoIaWhatsapp.findMany).not.toHaveBeenCalled();
});

test("somente comercial ativo não seleciona clientes nem altera seu piloto", async () => {
  const client = banco();
  await processarTurnosIaUmaVez({ ...opcoes, flag: false, client, responder: jest.fn() });
  const escopos = client.turnoIaWhatsapp.findMany.mock.calls[0][0].where.AND[0].OR;
  expect(escopos).toHaveLength(1);
  expect(escopos[0].perfil).toBe("LEAD");
});

test("lease ocupado conserva o lead pendente sem modelo nem tentativa", async () => {
  const client = banco();
  adquirirLease.mockResolvedValueOnce(null);
  await processarTurnosIaUmaVez({ ...opcoes, client, responder: jest.fn() });
  expect(client.jobs[0]).toMatchObject({ status: "pendente", tentativas: 0 });
  expect(responderLead).not.toHaveBeenCalled();
  expect(liberarLease).not.toHaveBeenCalled();
});

test("saída anterior do lead impede reenvio após reinício", async () => {
  const client = banco();
  client.mensagemWhatsapp.findFirst.mockResolvedValue({ id: "saida" });
  await processarTurnosIaUmaVez({ ...opcoes, client, responder: jest.fn() });
  expect(client.jobs[0].status).toBe("indeterminado");
  expect(responderLead).not.toHaveBeenCalled();
});

test("lead que perdeu escopo comercial encerra job sem repetir o modelo", async () => {
  const client = banco();
  responderLead.mockResolvedValueOnce({ feito: false, motivo: "SEM_ESCOPO_COMERCIAL" });
  await processarTurnosIaUmaVez({ ...opcoes, client, responder: jest.fn() });
  expect(client.jobs[0].status).toBe("ignorado");
});
