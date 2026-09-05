// O ENVIO DA GUIA POR WHATSAPP — o caminho inteiro, sem UMA chamada de rede.
//
// ⚠ A TRAVA DE REDE É ESTRUTURAL: `globalThis.fetch` é substituído por um espião que ESTOURA. Se
// algum caminho esquecer o cliente injetado e cair no `fetch` nativo, o teste quebra com "REDE" em
// vez de sair uma mensagem de verdade para o celular de alguém.
//
// O que este arquivo trava, em ordem de importância:
//   1. com a flag OFF **nada sai**, e a recusa é declarada;
//   2. com o template não aprovado **nada sai**, e a recusa diz a situação;
//   3. a mesma guia não vai duas vezes ao cliente — nem por reexecução, nem por corrida;
//   4. guia que FALHOU volta a ser enviável;
//   5. ⚠ tocar a guia por WhatsApp **materializa o legado do e-mail** antes de a primeira linha de
//      `envios_guia` desligar a tolerância do `guideCompliance`.

jest.mock("../../../config.js", () => ({
  ...jest.requireActual("../../../config.js"),
  INTEGRACAO_WHATSAPP: true,
  WHATSAPP_ENVIO_DELAY_MS: 0,
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    templateWhatsapp: { findUnique: jest.fn() },
    guide: { findMany: jest.fn() },
    envioGuia: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), upsert: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    contatoWhatsapp: { findMany: jest.fn() },
    conversaWhatsapp: { upsert: jest.fn() },
    mensagemWhatsapp: { create: jest.fn() },
  },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { WhatsappError } from "../WhatsappCloudClient.js";
import { MOTIVOS } from "../elegibilidadeEnvioGuia.js";
import {
  MOTIVOS_SERVICO,
  carregarCanal,
  competenciaPorExtenso,
  conferirLote,
  enviarGuiaPorWhatsapp,
  executarLote,
  preverLote,
  valorFormatado,
} from "../EnvioGuiaWhatsappService.js";

const TEMPLATE_APROVADO = {
  chave: "guia_disponivel", nomeMeta: "guia_disponivel", statusAprovacao: "APROVADO", temDocumento: true,
};
const CONTATO = {
  id: "c1", portalClientId: "emp1", nome: "Maria Silva", telefoneE164: "5521999998888",
  optInEm: new Date("2026-01-10"), ativo: true,
};
const GUIA = {
  id: "g1", portalClientId: "emp1", tipo: "SIMPLES", competencia: "2026-07",
  valor: 1243.8, vencimento: new Date("2026-08-20T00:00:00.000Z"), status: "PROCESSED",
  emailStatus: "PENDING", emailSentAt: null, emailAttempts: 0,
  portalClient: { id: "emp1", razao: "LENTE LTDA", cnpj: "11222333000181" },
};

let fetchNativo;
const pdf = () => Buffer.from("%PDF-1.4 guia");

function clienteFalso(resultado = { wamid: "wamid.OK" }) {
  return {
    enviarGuia: jest.fn(async () => {
      if (resultado instanceof Error) throw resultado;
      return resultado;
    }),
  };
}

/** O estado de partida: nenhum envio registrado, contato com opt-in, template aprovado. */
function cenarioLimpo({ guias = [GUIA], contatos = [CONTATO], template = TEMPLATE_APROVADO, envios = [] } = {}) {
  prisma.templateWhatsapp.findUnique.mockResolvedValue(template);
  prisma.guide.findMany.mockImplementation(async (args) => (
    // `preverLote` pede o `portalClient` junto; `executarLote` recarrega só o necessário do envio.
    args?.select?.portalClient ? guias : guias.map(({ portalClient, ...g }) => g)
  ));
  prisma.envioGuia.findMany.mockResolvedValue(envios);
  prisma.contatoWhatsapp.findMany.mockResolvedValue(contatos);
  prisma.envioGuia.findUnique.mockResolvedValue(null);
  // ⚠ A chave passou a incluir o DESTINO (05/09/2026): quem procura o envio existente é o
  // `findFirst`, e a linha legada do e-mail é procurada por `destino: null`.
  prisma.envioGuia.findFirst.mockResolvedValue(null);
  prisma.envioGuia.upsert.mockResolvedValue({ id: "e1", status: "pendente" });
  prisma.envioGuia.updateMany.mockResolvedValue({ count: 1 });
  prisma.envioGuia.update.mockResolvedValue({ id: "e1" });
  prisma.envioGuia.create.mockImplementation(async ({ data }) => ({ id: data?.destino ? "e1" : "eLegado", ...data }));
  prisma.conversaWhatsapp.upsert.mockResolvedValue({ id: "conv1" });
  prisma.mensagemWhatsapp.create.mockResolvedValue({ id: "m1" });
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchNativo = globalThis.fetch;
  globalThis.fetch = jest.fn(() => {
    throw new Error("REDE: o teste tentou usar o fetch nativo — nada aqui pode alcançar a Meta");
  });
});
afterEach(() => { globalThis.fetch = fetchNativo; });

// ── Formatação que sai na mensagem do cliente ───────────────────────────────────────────────────

describe("o que o cliente lê", () => {
  it("competência por extenso e valor em pt-BR, como no esqueleto do dono", () => {
    expect(competenciaPorExtenso("2026-07")).toBe("Julho/2026");
    expect(valorFormatado(1243.8)).toBe("1.243,80");
  });

  it("competência estranha não vira mês inventado — volta como veio", () => {
    expect(competenciaPorExtenso("2026-13")).toBe("2026-13");
    expect(competenciaPorExtenso(null)).toBe("");
  });
});

// ── As duas recusas que valem HOJE ──────────────────────────────────────────────────────────────

describe("⚠ hoje NADA sai: flag OFF e template não aprovado", () => {
  it("flag OFF nem consulta o template — a resposta já está decidida", async () => {
    const canal = await carregarCanal({ integracaoLigada: false });
    expect(canal.disponivel).toBe(false);
    expect(canal.motivo).toBe(MOTIVOS.INTEGRACAO_DESLIGADA);
    expect(prisma.templateWhatsapp.findUnique).not.toHaveBeenCalled();
  });

  it("flag OFF: a prévia mantém a guia no lote, caindo para e-mail — ela NÃO some", async () => {
    cenarioLimpo();
    const previa = await preverLote({
      portalClientIds: ["emp1"], competencia: "2026-07", chaveTemplate: "guia_disponivel",
    });
    // `carregarCanal` lê a flag do config mockado (ligada); aqui o que se exercita é o template.
    prisma.templateWhatsapp.findUnique.mockResolvedValue({ ...TEMPLATE_APROVADO, statusAprovacao: "DECLARADO" });
    const previaSemTemplate = await preverLote({ portalClientIds: ["emp1"], competencia: "2026-07" });

    expect(previa.linhas).toHaveLength(1);
    expect(previaSemTemplate.linhas).toHaveLength(1);
    expect(previaSemTemplate.linhas[0].motivo).toBe(MOTIVOS.TEMPLATE_NAO_APROVADO);
    expect(previaSemTemplate.linhas[0].canalSugerido).toBe("EMAIL");
    expect(previaSemTemplate.resumo).toMatchObject({ total: 1, porWhatsapp: 0, porEmail: 1 });
  });

  it("template DECLARADO: o LOTE não manda mensagem nenhuma", async () => {
    cenarioLimpo({ template: { ...TEMPLATE_APROVADO, statusAprovacao: "DECLARADO" } });
    const cliente = clienteFalso();
    const r = await executarLote({
      portalClientIds: ["emp1"], competencia: "2026-07",
      conferencia: { total: 1, porWhatsapp: 0, porEmail: 1 },
      cliente, carregarPdf: pdf, delayMs: 0,
    });
    expect(cliente.enviarGuia).not.toHaveBeenCalled();
    expect(prisma.envioGuia.upsert).not.toHaveBeenCalled();
    expect(r.email.guideIds).toEqual(["g1"]);
  });
});

// ── Opt-in ──────────────────────────────────────────────────────────────────────────────────────

describe("opt-in é exigência para MANDAR", () => {
  it("contato sem opt-in: cai para e-mail com o motivo, e nada é registrado em envios_guia", async () => {
    cenarioLimpo({ contatos: [{ ...CONTATO, optInEm: null }] });
    const cliente = clienteFalso();
    const r = await executarLote({
      portalClientIds: ["emp1"], competencia: "2026-07",
      conferencia: { total: 1, porWhatsapp: 0, porEmail: 1 },
      cliente, carregarPdf: pdf, delayMs: 0,
    });
    expect(r.whatsapp.total).toBe(0);
    expect(r.email.linhas[0].motivo).toBe(MOTIVOS.SEM_OPT_IN);
    // ⚠ Recusa ANTES da tentativa não escreve linha nenhuma: uma linha "falhou" numa guia que nunca
    // foi tentada desligaria a tolerância do legado sem que nada tivesse acontecido.
    expect(prisma.envioGuia.upsert).not.toHaveBeenCalled();
    expect(cliente.enviarGuia).not.toHaveBeenCalled();
  });

  it("empresa sem contato nenhum também fica no lote, com o outro motivo", async () => {
    cenarioLimpo({ contatos: [] });
    const previa = await preverLote({ portalClientIds: ["emp1"], competencia: "2026-07" });
    expect(previa.linhas[0].motivo).toBe(MOTIVOS.SEM_CONTATO);
    expect(previa.resumo).toMatchObject({ porWhatsapp: 0, porEmail: 1 });
  });
});

// ── O envio individual ──────────────────────────────────────────────────────────────────────────

describe("o envio de uma guia", () => {
  it("caminho feliz: sobe o PDF, manda o template e grava o wamid no ENVIO", async () => {
    cenarioLimpo();
    const cliente = clienteFalso({ wamid: "wamid.ABC" });
    const r = await enviarGuiaPorWhatsapp({ guide: GUIA, contato: CONTATO, canal: { nomeMeta: "guia_disponivel" }, cliente, carregarPdf: pdf });

    expect(r).toMatchObject({ ok: true, enviada: true, providerMessageId: "wamid.ABC" });
    expect(cliente.enviarGuia).toHaveBeenCalledWith(expect.objectContaining({
      telefone: "5521999998888",
      template: "guia_disponivel",
      // Primeiro nome · tipo · competência por extenso · valor · vencimento — a ORDEM do esqueleto.
      variaveis: ["Maria", "Simples Nacional", "Julho/2026", "1.243,80", "20/08/2026"],
    }));
    expect(prisma.envioGuia.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "enviado", providerMessageId: "wamid.ABC" }),
    }));
  });

  it("⚠ o vencimento sai como DATA CIVIL — não um dia antes", async () => {
    // `Guide.vencimento` é meia-noite UTC; `toLocaleDateString` sem fuso já anunciou ao cliente,
    // por e-mail, um vencimento um dia antes do real.
    cenarioLimpo();
    const cliente = clienteFalso();
    await enviarGuiaPorWhatsapp({ guide: GUIA, contato: CONTATO, canal: {}, cliente, carregarPdf: pdf });
    expect(cliente.enviarGuia.mock.calls[0][0].variaveis[4]).toBe("20/08/2026");
  });

  it("o balão do fio aponta para o ENVIO (e a mensagem não guarda status)", async () => {
    cenarioLimpo();
    await enviarGuiaPorWhatsapp({ guide: GUIA, contato: CONTATO, canal: {}, cliente: clienteFalso(), carregarPdf: pdf });
    const dados = prisma.mensagemWhatsapp.create.mock.calls[0][0].data;
    expect(dados).toMatchObject({ direcao: "out", envioGuiaId: "e1", providerMessageId: "wamid.OK" });
    expect(dados).not.toHaveProperty("status");
  });

  it("⚠ falha ao gravar o balão NÃO transforma envio feito em falha", async () => {
    // A mensagem já saiu para o cliente. Reportar falha faria o contador reenviar.
    cenarioLimpo();
    prisma.mensagemWhatsapp.create.mockRejectedValue(new Error("banco fora"));
    const r = await enviarGuiaPorWhatsapp({ guide: GUIA, contato: CONTATO, canal: {}, cliente: clienteFalso(), carregarPdf: pdf });
    expect(r.ok).toBe(true);
  });

  it("PDF ausente: falha declarada, com o conserto na mensagem", async () => {
    // "Registro existe, arquivo não" é caso real (volume efêmero do Railway).
    cenarioLimpo();
    const cliente = clienteFalso();
    const r = await enviarGuiaPorWhatsapp({ guide: GUIA, contato: CONTATO, canal: {}, cliente, carregarPdf: async () => Buffer.alloc(0) });
    expect(r).toMatchObject({ ok: false, motivo: MOTIVOS_SERVICO.GUIA_SEM_PDF, podeTentarDeNovo: false });
    expect(cliente.enviarGuia).not.toHaveBeenCalled();
  });
});

// ── Idempotência e corrida ──────────────────────────────────────────────────────────────────────

describe("a mesma guia não vai duas vezes ao cliente", () => {
  it("envio TERMINAL naquele canal: não redispara (reexecutar o lote é inofensivo)", async () => {
    cenarioLimpo();
    prisma.envioGuia.findFirst.mockImplementation(async ({ where }) => (
      where.canal === "WHATSAPP" && where.destino ? { id: "e1", status: "entregue" } : null
    ));
    const cliente = clienteFalso();
    const r = await enviarGuiaPorWhatsapp({ guide: GUIA, contato: CONTATO, canal: {}, cliente, carregarPdf: pdf });
    expect(r).toMatchObject({ ok: true, jaEnviada: true });
    expect(cliente.enviarGuia).not.toHaveBeenCalled();
  });

  it("⚠ CORRIDA: quem não conseguir a reserva atômica desiste ANTES de gastar a mensagem", async () => {
    // Duplo clique, ou o lote correndo junto do envio individual da mesma guia: os dois passam pelo
    // check-then-act de `registrarEnvio` antes de qualquer um escrever.
    cenarioLimpo();
    prisma.envioGuia.updateMany.mockResolvedValue({ count: 0 });
    const cliente = clienteFalso();
    const r = await enviarGuiaPorWhatsapp({ guide: GUIA, contato: CONTATO, canal: {}, cliente, carregarPdf: pdf });
    expect(r).toMatchObject({ ok: false, motivo: MOTIVOS_SERVICO.ENVIO_EM_ANDAMENTO });
    expect(cliente.enviarGuia).not.toHaveBeenCalled();
  });

  it("envio que FALHOU é reenviável — a linha volta a `pendente`, sem segunda linha", async () => {
    cenarioLimpo();
    prisma.envioGuia.findFirst.mockImplementation(async ({ where }) => (
      where.canal === "WHATSAPP" && where.destino ? { id: "e1", status: "falhou" } : null
    ));
    const cliente = clienteFalso();
    const r = await enviarGuiaPorWhatsapp({ guide: GUIA, contato: CONTATO, canal: {}, cliente, carregarPdf: pdf });
    expect(r.ok).toBe(true);
    // ⚠ A MESMA LINHA volta a `pendente` — nunca uma segunda linha para o mesmo destino.
    expect(prisma.envioGuia.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "e1" },
      data: expect.objectContaining({ status: "pendente", erroCodigo: null }),
    }));
    expect(prisma.envioGuia.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ canal: "WHATSAPP" }),
    }));
  });
});

// ── O erro da Meta ──────────────────────────────────────────────────────────────────────────────

describe("quando a Meta recusa", () => {
  const erroMeta = (codigo, retentativa) => new WhatsappError({
    codigo, codigoMeta: codigo, traduzido: true, titulo: null, onde: null, solucaoDocumentada: null,
    detalheDaMeta: "", mensagemUsuario: "mensagem do contador", retentativa,
    baseDaRetentativa: "documentada", httpStatus: 400, httpStatusDocumentado: null,
    fbtraceId: "Ax1", subcodigoMeta: null, fonte: {}, procedencia: null,
    noEsqueletoDoDono: false, divergeDoEsqueleto: null,
  });

  it("grava a mensagem JÁ TRADUZIDA — código cru não chega à tela", async () => {
    cenarioLimpo();
    const cliente = clienteFalso(erroMeta("META_131026", "SIM"));
    const r = await enviarGuiaPorWhatsapp({ guide: GUIA, contato: CONTATO, canal: {}, cliente, carregarPdf: pdf });
    expect(r.ok).toBe(false);
    expect(prisma.envioGuia.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "falhou", erroMensagemUsuario: "mensagem do contador" }),
    }));
  });

  it("⚠ `proximaTentativaEm` fica NULO mesmo quando dá para reenviar — não há fila que o drene", async () => {
    cenarioLimpo();
    const cliente = clienteFalso(erroMeta("META_131056", "SIM"));
    await enviarGuiaPorWhatsapp({ guide: GUIA, contato: CONTATO, canal: {}, cliente, carregarPdf: pdf });
    expect(prisma.envioGuia.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ proximaTentativaEm: null }),
    }));
  });

  it("⚠ erro SEM CLASSIFICAÇÃO sobe como `null`, não como `false`", async () => {
    // `null` = a documentação da Meta descreve o erro e não fala em reenviar. Quem recebe não agenda
    // retentativa por conta própria — a decisão volta para o contador.
    cenarioLimpo();
    const cliente = clienteFalso(erroMeta("META_131048", "SEM_CLASSIFICACAO"));
    const r = await enviarGuiaPorWhatsapp({ guide: GUIA, contato: CONTATO, canal: {}, cliente, carregarPdf: pdf });
    expect(r.podeTentarDeNovo).toBeNull();
  });

  it("erro NÃO traduzido não vira 'erro desconhecido' mudo — tem código próprio", async () => {
    cenarioLimpo();
    const cliente = clienteFalso(new Error("timeout do socket"));
    const r = await enviarGuiaPorWhatsapp({ guide: GUIA, contato: CONTATO, canal: {}, cliente, carregarPdf: pdf });
    expect(r.motivo).toBe(MOTIVOS_SERVICO.RECUSADA_PELA_META);
    expect(r.podeTentarDeNovo).toBeNull();
  });
});

// ── ⚠ A materialização do legado ────────────────────────────────────────────────────────────────

describe("⚠ tocar a guia traz o legado do e-mail junto", () => {
  it("guia com emailStatus SENT: a linha EMAIL/enviado é criada ANTES do envio", async () => {
    cenarioLimpo({ guias: [{ ...GUIA, emailStatus: "SENT", emailSentAt: new Date("2026-08-01") }] });
    const guide = { ...GUIA, emailStatus: "SENT", emailSentAt: new Date("2026-08-01"), emailAttempts: 2 };
    await enviarGuiaPorWhatsapp({ guide, contato: CONTATO, canal: {}, cliente: clienteFalso(), carregarPdf: pdf });
    expect(prisma.envioGuia.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ guideId: "g1", canal: "EMAIL", status: "enviado", tentativas: 2 }),
    });
  });

  it("guia PENDING/ERROR não gera linha de legado — não se inventa histórico", async () => {
    for (const emailStatus of ["PENDING", "ERROR", "SENDING", null]) {
      jest.clearAllMocks();
      cenarioLimpo();
      // eslint-disable-next-line no-await-in-loop
      await enviarGuiaPorWhatsapp({ guide: { ...GUIA, emailStatus }, contato: CONTATO, canal: {}, cliente: clienteFalso(), carregarPdf: pdf });
      // ⚠ A linha do WHATSAPP é criada normalmente (a chave passou a incluir o destino, então
      // `registrarEnvio` cria em vez de dar upsert). O que NÃO pode nascer é a linha do e-mail.
      const criouLegado = prisma.envioGuia.create.mock.calls.some(([arg]) => arg?.data?.canal === "EMAIL");
      expect(criouLegado).toBe(false);
    }
  });

  it("legado já materializado não vira segunda linha", async () => {
    cenarioLimpo();
    prisma.envioGuia.findFirst.mockImplementation(async ({ where }) => (
      where.canal === "EMAIL" ? { id: "eLegado", status: "enviado" } : null
    ));
    await enviarGuiaPorWhatsapp({ guide: { ...GUIA, emailStatus: "SENT" }, contato: CONTATO, canal: {}, cliente: clienteFalso(), carregarPdf: pdf });
    const criouLegado = prisma.envioGuia.create.mock.calls.some(([arg]) => arg?.data?.canal === "EMAIL");
    expect(criouLegado).toBe(false);
  });
});

// ── A confirmação que repete os números ─────────────────────────────────────────────────────────

describe("⚠ ato de consequência: a confirmação repete os números", () => {
  const resumo = { total: 23, porWhatsapp: 19, porEmail: 4, jaEnviadas: 0 };

  it("sem conferência: recusa ANTES de qualquer envio", () => {
    expect(() => conferirLote(resumo, null)).toThrow(expect.objectContaining({ code: "CONFERENCIA_OBRIGATORIA" }));
  });

  it("números divergentes: 409 com os números de AGORA na mensagem", () => {
    expect(() => conferirLote(resumo, { total: 23, porWhatsapp: 20, porEmail: 3 }))
      .toThrow(expect.objectContaining({ code: "CONFERENCIA_DIVERGENTE", status: 409 }));
  });

  it("números iguais: passa", () => {
    expect(() => conferirLote(resumo, { total: 23, porWhatsapp: 19, porEmail: 4 })).not.toThrow();
  });

  it("o lote inteiro é recusado sem mandar nada quando a conferência diverge", async () => {
    cenarioLimpo();
    const cliente = clienteFalso();
    await expect(executarLote({
      portalClientIds: ["emp1"], competencia: "2026-07",
      conferencia: { total: 5, porWhatsapp: 5, porEmail: 0 },
      cliente, carregarPdf: pdf, delayMs: 0,
    })).rejects.toMatchObject({ code: "CONFERENCIA_DIVERGENTE" });
    expect(cliente.enviarGuia).not.toHaveBeenCalled();
  });
});

// ── O lote ──────────────────────────────────────────────────────────────────────────────────────

describe("o lote", () => {
  it("competência fora do formato é recusada antes de tocar o banco", async () => {
    await expect(preverLote({ portalClientIds: ["emp1"], competencia: "julho" }))
      .rejects.toMatchObject({ code: "COMPETENCIA_INVALIDA" });
    await expect(preverLote({ portalClientIds: [], competencia: "2026-07" }))
      .rejects.toMatchObject({ code: "EMPRESAS_OBRIGATORIAS" });
  });

  it("guia JÁ ENVIADA aparece na prévia marcada, e não é reenviada", async () => {
    cenarioLimpo({ envios: [{ guideId: "g1", canal: "EMAIL", status: "enviado" }] });
    const previa = await preverLote({ portalClientIds: ["emp1"], competencia: "2026-07" });
    expect(previa.linhas[0]).toMatchObject({ jaEnviada: true, motivo: MOTIVOS.GUIA_JA_ENVIADA, canalSugerido: null });
    expect(previa.resumo).toMatchObject({ total: 1, porWhatsapp: 0, porEmail: 0, jaEnviadas: 1 });
  });

  it("reporta progresso linha a linha e devolve o resumo", async () => {
    const g2 = { ...GUIA, id: "g2", tipo: "INSS" };
    cenarioLimpo({ guias: [GUIA, g2] });
    const progresso = [];
    const r = await executarLote({
      portalClientIds: ["emp1"], competencia: "2026-07",
      conferencia: { total: 2, porWhatsapp: 2, porEmail: 0 },
      cliente: clienteFalso(), carregarPdf: pdf, delayMs: 0,
      aoProgredir: (p) => progresso.push(p.atual),
    });
    expect(progresso).toEqual([1, 2]);
    expect(r.whatsapp).toMatchObject({ total: 2, enviadas: 2 });
    expect(r.whatsapp.falhas).toHaveLength(0);
  });
});
