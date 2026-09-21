jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../fiscal/serpro/lerRelatorioSitfis.js", () => ({ lerSitfisPosicional: jest.fn(async () => ({ relatorio: {}, erro: null })) }));
import { criarServicoComercial } from "../ComercialService.js";
import { criarFiscalLead } from "../FiscalLeadService.js";
import { OnboardingError } from "../OnboardingService.js";

const user = { id: "contador-teste", role: "contador" };
const cnpj = "11222333000181", procuradorCnpj = "12345678000199";
const inicio = new Date("2026-09-21T15:00:00Z");
const clone = value => structuredClone(value);
const proof = (patch = {}) => ({ status: "ATIVA", systems: ["TODOS"], validUntil: "2099-01-01", checkedAt: new Date().toISOString(), procuradorCnpj, ...patch });

function setup() {
  const ficha = { id: "ficha-teste", cnpj, status: "RASCUNHO", criadoPorId: user.id, versao: 1 };
  let caso = null;
  const analises = [], trabalhos = [];
  const db = {
    onboarding: { findUnique: jest.fn(async () => clone(ficha)), update: jest.fn(async () => clone(ficha)) },
    atendimentoLead: {
      findFirst: jest.fn(async () => clone(caso)),
      updateMany: jest.fn(async ({ data }) => { Object.assign(caso, clone(data)); return { count: 1 }; }),
    },
    onboardingAnalise: {
      findFirst: jest.fn(async ({ where }) => clone([...analises].reverse().find(a => a.cnpj === where.cnpj && a.onboardingId === where.onboardingId && a.tipo === where.tipo) || null)),
      updateMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async ({ data }) => { const a = { id: `analise-${analises.length}`, createdAt: new Date(), updatedAt: new Date(), ...clone(data) }; analises.push(a); return clone(a); }),
      update: jest.fn(async ({ where, data }) => { const a = analises.find(a => a.id === where.id); Object.assign(a, clone(data), { updatedAt: new Date() }); return clone(a); }),
    },
    onboardingEvento: { create: jest.fn(async () => ({})) },
    user: { findUnique: jest.fn(async () => user) },
    trabalhoFiscalLead: {
      findMany: jest.fn(async ({ where }) => clone(trabalhos.filter(j => where.status.in.includes(j.status) && j.tentativas < where.tentativas.lt && j.proximaTentativaEm <= where.proximaTentativaEm.lte))),
      updateMany: jest.fn(async ({ where, data }) => {
        const encontrados = trabalhos.filter(j => (!where.id || j.id === where.id) && (!where.status || j.status === where.status) && (where.tentativas == null || j.tentativas === where.tentativas) && (!where.reservaToken || j.reservaToken === where.reservaToken) && (!where.leaseAte || j.leaseAte <= where.leaseAte.lte));
        for (const j of encontrados) Object.assign(j, clone(data), { tentativas: data.tentativas?.increment ? j.tentativas + data.tentativas.increment : j.tentativas });
        return { count: encontrados.length };
      }),
    },
  };
  const procura = jest.fn(async () => proof());
  const procuradorAtual = jest.fn(async () => procuradorCnpj);
  const sitfis = jest.fn(async () => ({ ok: true, protocolo: "protocolo-sintetico", relatorioPdfBuffer: Buffer.from("%PDF-sintetico") }));
  const cifrar = jest.fn(async () => "pdf-cifrado-sintetico");
  const comercial = criarServicoComercial({ db, procura, procuradorAtual, sitfis, cifrar, agora: () => new Date() });
  const fiscal = criarFiscalLead({ db, procura, comercial, flag: true });
  return {
    ficha, db, analises, trabalhos, procura, procuradorAtual, sitfis, cifrar, comercial, fiscal,
    consultar: () => comercial.analisar(ficha.id, user, "SITFIS"),
    caso: (patch = {}) => (caso = { id: "caso-teste", onboardingId: ficha.id, conversaId: "conversa-teste", encerradoEm: null, representanteVerificadoEm: new Date(), autorizacao: { cnpj, estado: "ATIVA", prova: proof() }, ...patch }),
    anterior: (patch = {}) => analises.push({ id: `anterior-${analises.length}`, onboardingId: ficha.id, tipo: "SITFIS", cnpj, createdAt: new Date(Date.now() - 61000), updatedAt: new Date(Date.now() - 61000), status: "FALHOU", resultado: { protocolo: "protocolo-salvo", procuracao: proof() }, ...patch }),
    job: (tipo, patch = {}) => { const j = { id: `trabalho-${trabalhos.length}`, onboardingId: ficha.id, cnpj, tipo, status: "PENDENTE", tentativas: 0, criadoPor: user.id, proximaTentativaEm: new Date(), ...patch }; trabalhos.push(j); return j; },
  };
}

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(inicio); });
afterEach(() => jest.useRealTimers());

test.each([null, Buffer.alloc(0)])("resposta terminal sem PDF útil falha e preserva protocolo (%p)", async pdf => {
  const t = setup(); t.sitfis.mockResolvedValue({ ok: true, protocolo: "protocolo-textual", relatorioPdfBuffer: pdf, relatorioTexto: "Resposta sem documento" });
  const out = await t.consultar();
  expect(out.analise).toMatchObject({ status: "FALHOU", resultado: { codigo: "RELATORIO_PDF_INDISPONIVEL", relatorioDisponivel: false, protocolo: "protocolo-textual" } });
  expect(t.cifrar).not.toHaveBeenCalled();
});

test.each([{ relatorioDisponivel: false, documentoCifrado: null }, { relatorioDisponivel: true, documentoCifrado: "" }])("concluída antiga sem documento não vira cache útil: %j", async anterior => {
  const t = setup(); t.anterior({ status: "CONCLUIDA", documentoCifrado: anterior.documentoCifrado, resultado: { protocolo: "protocolo-salvo", procuracao: proof(), relatorioDisponivel: anterior.relatorioDisponivel } });
  expect((await t.consultar()).reutilizada).not.toBe(true);
  expect(t.sitfis).toHaveBeenCalledWith(expect.objectContaining({ protocoloExistente: "protocolo-salvo" }));
});

test("concluída com PDF conserva cache e não gera chamadas", async () => {
  const t = setup(); t.anterior({ status: "CONCLUIDA", documentoCifrado: "cifrado", resultado: { relatorioDisponivel: true } });
  expect((await t.consultar()).reutilizada).toBe(true);
  expect(t.procura).not.toHaveBeenCalled(); expect(t.sitfis).not.toHaveBeenCalled();
});

test("falha depois de salvar protocolo e falha seguinte retomam a mesma consulta", async () => {
  const t = setup();
  t.sitfis.mockImplementationOnce(async ({ onProtocolo }) => { await onProtocolo("protocolo-recuperavel"); throw new Error("falha-sintetica"); })
    .mockRejectedValueOnce(new Error("segunda-falha-sintetica"));
  const primeira = await t.consultar();
  expect(primeira.analise.resultado.protocolo).toBe("protocolo-recuperavel");
  jest.setSystemTime(new Date(Date.now() + 61000));
  const segunda = await t.consultar();
  expect(t.sitfis.mock.calls[1][0].protocoloExistente).toBe("protocolo-recuperavel");
  expect(segunda.analise.resultado.protocolo).toBe("protocolo-recuperavel");
  jest.setSystemTime(new Date(Date.now() + 61000)); await t.consultar();
  expect(t.sitfis.mock.calls[2][0].protocoloExistente).toBe("protocolo-recuperavel");
});

test("rechecagem de procuração indisponível não apaga o protocolo recuperável", async () => {
  const t = setup(); t.anterior(); t.procura.mockRejectedValueOnce(new Error("temporario"));
  expect((await t.consultar()).analise.resultado.protocolo).toBe("protocolo-salvo");
  jest.setSystemTime(new Date(Date.now() + 61000)); await t.consultar();
  expect(t.sitfis).toHaveBeenCalledWith(expect.objectContaining({ protocoloExistente: "protocolo-salvo" }));
});

test.each(["cnpj", "procurador"])("não reaproveita protocolo de outro %s", async tipo => {
  const t = setup(); t.anterior(tipo === "cnpj" ? { cnpj: "99888777000166" } : { resultado: { protocolo: "outro-contexto", procuracao: proof({ procuradorCnpj: "99888777000166" }) } });
  await t.consultar(); expect(t.sitfis).toHaveBeenCalledWith(expect.objectContaining({ protocoloExistente: null }));
});

test("PDF concluído vencido mantém a semântica de nova solicitação", async () => {
  const t = setup(); t.anterior({ status: "CONCLUIDA", createdAt: new Date(Date.now() - 5 * 3600000), documentoCifrado: "cifrado", resultado: { protocolo: "antigo", relatorioDisponivel: true, procuracao: proof() } });
  await t.consultar(); expect(t.sitfis).toHaveBeenCalledWith(expect.objectContaining({ protocoloExistente: null }));
});

test("worker procuração → SITFIS no minuto seguinte aproveita prova oficial do próprio caso", async () => {
  const t = setup(); t.caso({ autorizacao: { cnpj, estado: "AGUARDANDO_OUTORGA" } });
  t.procura.mockResolvedValueOnce(proof()).mockRejectedValue(Object.assign(new Error("repetida"), { code: "SERPRO_CHAMADA_REPETIDA", detalhe: { segundosRestantes: 240 } }));
  const verificacao = t.job("PROCURACAO"); await t.fiscal.processarUmaVez();
  expect(verificacao.status).toBe("CONCLUIDO");
  jest.setSystemTime(new Date(Date.now() + 60000));
  const consulta = t.job("SITFIS"); await t.fiscal.processarUmaVez();
  expect(consulta.status).toBe("CONCLUIDO"); expect(t.procura).toHaveBeenCalledTimes(1);
  expect(t.sitfis).toHaveBeenCalledTimes(1); expect(t.procuradorAtual).toHaveBeenCalledTimes(1);
  expect(t.db.atendimentoLead.findFirst).toHaveBeenCalledWith({ where: { onboardingId: t.ficha.id, encerradoEm: null } });
});

test.each(["antiga", "futura", "procurador mudou"])("prova %s exige nova conferência oficial", async motivo => {
  const t = setup(); const p = proof();
  if (motivo === "antiga") p.checkedAt = new Date(Date.now() - 300001).toISOString();
  if (motivo === "futura") p.checkedAt = new Date(Date.now() + 1000).toISOString();
  if (motivo === "procurador mudou") t.procuradorAtual.mockResolvedValue("99888777000166");
  t.caso({ autorizacao: { cnpj, estado: "ATIVA", prova: p } });
  t.procura.mockResolvedValue(proof({ status: "REVOGADA" }));
  const out = await t.consultar(); expect(t.procura).toHaveBeenCalledTimes(1);
  expect(out.analise.status).toBe("BLOQUEADA"); expect(t.sitfis).not.toHaveBeenCalled();
});

test("revogação conhecida no caso impede uso de prova ativa anterior", async () => {
  const t = setup(); t.anterior({ resultado: { protocolo: "anterior", procuracao: proof() } });
  t.caso({ autorizacao: { cnpj, estado: "REVOGADA", prova: proof({ status: "REVOGADA" }) } });
  await t.consultar(); expect(t.sitfis).not.toHaveBeenCalled();
});

test.each(["cnpj", "representante", "identidade"])("não aproveita prova quando %s do caso mudou", async campo => {
  const t = setup(); const a = t.caso();
  if (campo === "cnpj") a.autorizacao.cnpj = "99888777000166";
  if (campo === "representante") a.representanteVerificadoEm = null;
  if (campo === "identidade") {
    a.interlocutorId = "antigo";
    t.db.conversaWhatsapp = { findUnique: jest.fn(async () => ({ id: a.conversaId, telefoneE164: "5511999990000", vinculoNumeroId: "v" })) };
    t.db.vinculoNumeroInterlocutor = { findUnique: jest.fn(async () => ({ id: "v", encerrouEm: new Date(), interlocutorId: "antigo" })) };
  }
  const out = await t.consultar(); expect(out.analise.status).toBe("FALHOU");
  expect(t.procura).not.toHaveBeenCalled(); expect(t.sitfis).not.toHaveBeenCalled();
});

test("revogação durante leitura da configuração impede SITFIS", async () => {
  const t = setup(); const a = t.caso();
  t.procuradorAtual.mockImplementation(async () => { a.autorizacao.estado = "REVOGADA"; return procuradorCnpj; });
  const out = await t.consultar(); expect(out.analise.status).toBe("FALHOU"); expect(t.sitfis).not.toHaveBeenCalled();
});

test("erro de repetição preserva prazo e causa legível", async () => {
  const t = setup(); t.procura.mockRejectedValue(Object.assign(new Error("repetição"), { code: "SERPRO_CHAMADA_REPETIDA", detalhe: { segundosRestantes: 243 } }));
  const out = await t.consultar();
  expect(out.analise.resultado).toMatchObject({ codigo: "SERPRO_CHAMADA_REPETIDA", tentarNovamenteEm: new Date(Date.now() + 243000).toISOString() });
  expect(out.analise.resultado.mensagem).toMatch(/243|aguard/i); expect(t.sitfis).not.toHaveBeenCalled();
});

test("clique repetido durante intervalo vira espera do worker, sem nova consulta paga", async () => {
  const t = setup(); t.caso(); t.anterior({ createdAt: new Date(Date.now() - 13000), status: "FALHOU" });
  const j = t.job("SITFIS"); await t.fiscal.processarUmaVez();
  expect(j.status).toBe("AGUARDANDO"); expect(j.resultado.codigo).toBe("aguarde_consulta");
  expect(j.proximaTentativaEm.getTime()).toBeGreaterThan(Date.now()); expect(t.sitfis).not.toHaveBeenCalled();
  jest.setSystemTime(j.proximaTentativaEm); await t.fiscal.processarUmaVez();
  expect(j.status).toBe("CONCLUIDO"); expect(t.sitfis).toHaveBeenCalledTimes(1);
});

test("worker respeita prazo retornado da guarda e limita tentativas", async () => {
  const t = setup(); t.caso();
  const comercial = { analisar: jest.fn(async () => ({ analise: { id: "aguardando", status: "FALHOU", resultado: { codigo: "SERPRO_CHAMADA_REPETIDA", mensagem: "Aguarde", tentarNovamenteEm: new Date(Date.now() + 243000).toISOString() } } })) };
  const fiscal = criarFiscalLead({ db: t.db, comercial, flag: true });
  const j = t.job("SITFIS"); await fiscal.processarUmaVez();
  expect(j.status).toBe("AGUARDANDO"); expect(j.proximaTentativaEm).toEqual(new Date(Date.now() + 243000));
  const esgotado = t.job("SITFIS", { tentativas: 3 }); await fiscal.processarUmaVez(); expect(esgotado.status).toBe("EXIGE_REVISAO");
});

test("resultado desconhecido ou teto nunca entram em retry automático", async () => {
  for (const codigo of ["SERPRO_CHAMADA_EM_ANDAMENTO", "SERPRO_REGISTRO_INDETERMINADO", "SERPRO_TETO_MENSAL_ESCRITORIO"]) {
    const t = setup(); t.caso(); const j = t.job("SITFIS");
    const comercial = { analisar: jest.fn(async () => { throw new OnboardingError(codigo, "Confira antes de repetir", 409); }) };
    await criarFiscalLead({ db: t.db, comercial, flag: true }).processarUmaVez();
    expect(j.status).toBe("FALHOU");
  }
});

test("prazo conhecido impede novo clique de reconsultar antes da liberação", async () => {
  const t = setup(); const tentarNovamenteEm = new Date(Date.now() + 243000).toISOString();
  t.anterior({ resultado: { codigo: "SERPRO_CHAMADA_REPETIDA", tentarNovamenteEm } });
  await expect(t.consultar()).rejects.toMatchObject({ code: "SERPRO_CHAMADA_REPETIDA", extra: { tentarNovamenteEm } });
  expect(t.procura).not.toHaveBeenCalled(); expect(t.db.onboardingAnalise.create).not.toHaveBeenCalled();
});

test("prova atualizada no polling continua reutilizável sem repetir procuração", async () => {
  const t = setup(); t.caso({ autorizacao: { cnpj, estado: "ATIVA", prova: proof({ checkedAt: new Date(Date.now() - 360000).toISOString() }) } });
  t.anterior({ status: "PROCESSANDO", resultado: { protocolo: "protocolo-em-processamento", procuracao: proof({ checkedAt: new Date(Date.now() - 120000).toISOString() }) } });
  t.sitfis.mockResolvedValue({ ok: true, processando: true, protocolo: "protocolo-em-processamento" });
  const out = await t.consultar(); expect(out.analise.status).toBe("PROCESSANDO");
  expect(t.procura).not.toHaveBeenCalled();
  expect(t.sitfis).toHaveBeenCalledWith(expect.objectContaining({ protocoloExistente: "protocolo-em-processamento" }));
});

test("falha na cifra não permite concluir relatório indisponível", async () => {
  const t = setup(); t.cifrar.mockResolvedValue(null);
  const out = await t.consultar(); expect(out.analise.status).toBe("FALHOU");
  expect(out.analise.resultado.relatorioDisponivel).toBe(false);
});
