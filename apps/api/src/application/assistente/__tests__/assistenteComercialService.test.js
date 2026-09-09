// Serviço e registro durável de saída reais; armazenamento, modelo e transporte são locais.
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../onboarding/LeadService.js", () => ({ iniciarAtendimento: jest.fn(), registrarCampos: jest.fn(), proximaPergunta: jest.fn() }));
jest.mock("../../onboarding/FiscalLeadService.js", () => ({ consultarPublicaLead: jest.fn() }));
jest.mock("../../onboarding/RecursosComerciaisService.js", () => ({ criarRecursosComerciais: jest.fn() }));
jest.mock("../../whatsapp/WhatsappLeaseService.js", () => ({
  adquirirLease: jest.fn(async id => ({ id, token: "posse" })),
  renovarLease: jest.fn(async () => true), liberarLease: jest.fn(async () => {}),
}));
jest.mock("../GuardaIaService.js", () => ({ autorizarChamadaIa: jest.fn(), concluirChamadaIa: jest.fn() }));

import { responderLead } from "../AssistenteComercialService.js";
import { iniciarAtendimento, registrarCampos, proximaPergunta } from "../../onboarding/LeadService.js";
import { criarRecursosComerciais } from "../../onboarding/RecursosComerciaisService.js";
import { adquirirLease, liberarLease } from "../../whatsapp/WhatsappLeaseService.js";

const inicio = new Date(Date.now() - 60000);
const clone = value => structuredClone(value);
const entrada = (id = "m1", corpo = "Quero abrir uma empresa", ms = 0) => ({ id, conversaId: "cv", direcao: "in", tipo: "text", corpo, registradaEm: new Date(inicio.getTime() + ms), respondidaPelaIaEm: null });
function corresponde(row, where = {}) {
  return Object.entries(where).every(([k, value]) => {
    if (value === undefined) return true;
    if (k === "OR") return value.some(w => corresponde(row, w));
    if (k === "AND") return value.every(w => corresponde(row, w));
    if (k === "NOT") return !corresponde(row, value);
    const atual = row[k];
    if (value instanceof Date) return new Date(atual).getTime() === value.getTime();
    if (value?.path) {
      const json = value.path.reduce((r, campo) => r?.[campo], atual);
      return Array.isArray(json) && value.array_contains.every(item => json.includes(item));
    }
    if (value && typeof value === "object") return Object.entries(value).every(([op, alvo]) => {
      if (op === "in") return alvo.includes(atual);
      if (op === "notIn") return !alvo.includes(atual);
      if (op === "not") return atual !== alvo;
      if (op === "lt") return atual < alvo;
      if (op === "lte") return atual <= alvo;
      if (op === "gt") return atual > alvo;
      if (op === "gte") return atual >= alvo;
      throw new Error(`Operador de teste não implementado: ${op}`);
    });
    return value === null ? atual == null : atual === value;
  });
}
function memoria(mensagens = [entrada()]) {
  const db = {
    mensagens: mensagens.map(clone), eventos: [],
    conversa: { id: "cv", telefoneE164: "5511999999999", portalClientId: null, chaveEscopo: "sem-empresa:5511999999999", atendidaPor: null, atendidaDesde: null, excluidaEm: null, automacaoInvalidadaEm: null },
    lead: { id: "lead", conversaId: "cv", onboardingId: "ficha", encerradoEm: null, autorizacao: null, onboarding: { id: "ficha", origem: "ABERTURA", dados: {}, versao: 1 } },
  };
  db.conversaWhatsapp = {
    findUnique: jest.fn(async () => clone(db.conversa)),
    update: jest.fn(async ({ data }) => clone(Object.assign(db.conversa, data))),
    updateMany: jest.fn(async ({ where, data }) => {
      if (!corresponde(db.conversa, where)) return { count: 0 };
      Object.assign(db.conversa, data); db.eventos.push("handoff-persistido"); return { count: 1 };
    }),
  };
  db.mensagemWhatsapp = {
    findFirst: jest.fn(async ({ where }) => clone(db.mensagens.find(m => corresponde(m, where)) || null)),
    findMany: jest.fn(async ({ where, orderBy = [], take }) => {
      const lista = db.mensagens.filter(m => corresponde(m, where));
      const chaves = Array.isArray(orderBy) ? orderBy : [orderBy];
      lista.sort((a, b) => {
        for (const chave of chaves) for (const [k, ordem] of Object.entries(chave)) {
          const delta = a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0;
          if (delta) return ordem === "desc" ? -delta : delta;
        }
        return 0;
      });
      return clone(lista.slice(0, take));
    }),
    create: jest.fn(async ({ data }) => {
      const m = { id: `saida-${db.mensagens.length}`, registradaEm: new Date(), ...data };
      db.mensagens.push(m); db.eventos.push("saida-registrada"); return clone(m);
    }),
    update: jest.fn(async ({ where, data }) => clone(Object.assign(db.mensagens.find(m => corresponde(m, where)), data))),
    updateMany: jest.fn(async ({ where, data }) => {
      const alvos = db.mensagens.filter(m => corresponde(m, where));
      alvos.forEach(m => Object.assign(m, data)); return { count: alvos.length };
    }),
  };
  db.atendimentoLead = {
    findFirst: jest.fn(async ({ where }) => corresponde(db.lead, where) ? clone(db.lead) : null),
    update: jest.fn(async ({ data }) => clone(Object.assign(db.lead, data))),
  };
  return db;
}
const fim = (texto = "Pode contratar só a abertura. Também podemos comparar com a contabilidade mensal.") => ({ texto, usage: { input_tokens: 10, output_tokens: 15 }, iteracoes: 2, ferramentasChamadas: ["registrar_atendimento"], stopReason: "end_turn" });
function ambiente(mensagens) {
  const db = memoria(mensagens);
  const deps = {
    client: db, flag: true, piloto: [db.conversa.telefoneE164],
    resolver: jest.fn(async () => ({ situacao: "DESCONHECIDO" })),
    janela: jest.fn(async () => ({ situacao: "ABERTA" })),
    autorizar: jest.fn(async () => ({ ok: true, contexto: { id: "consumo" } })), concluir: jest.fn(async () => {}),
    consultaPublica: jest.fn(async () => ({ razaoSocial: "Empresa de Teste", situacaoCadastral: "ATIVA" })),
    cloud: { enviarTexto: jest.fn(async () => { db.eventos.push("transporte"); return { wamid: `wamid.${db.mensagens.length}` }; }) },
    assistente: { responder: jest.fn(async ({ executar }) => { await executar("registrar_atendimento", { campos: [] }); return fim(); }) },
  };
  return { db, deps, rodar: (mensagemId = "m1") => responderLead({ conversaId: "cv", mensagemId, deps }) };
}
beforeEach(() => {
  jest.clearAllMocks();
  adquirirLease.mockImplementation(async id => ({ id, token: "posse" }));
  liberarLease.mockImplementation(async () => {});
  iniciarAtendimento.mockImplementation(async ({ client, origem }) => {
    if (origem && !client.lead.onboarding) { client.lead.onboardingId = "ficha"; client.lead.onboarding = { id: "ficha", origem, dados: {}, versao: 1 }; }
    return clone(client.lead);
  });
  registrarCampos.mockImplementation(async ({ client, operacoes }) => {
    const r = client.lead.onboarding;
    for (const op of operacoes) { if (op.acao === "unset") delete r.dados[op.campo]; else r.dados[op.campo] = op.valor; }
    r.versao += 1; r.cnpj = r.dados.cnpj || null; client.eventos.push("dados-salvos"); return clone(r);
  });
  proximaPergunta.mockImplementation(() => ({ campo: "atividadePretendida", pergunta: "Qual atividade você pretende exercer?" }));
  criarRecursosComerciais.mockReturnValue({ listar: jest.fn(async () => []), prepararOrientacao: jest.fn() });
});

test("registra pela função antes de enviar a resposta livre fundamentada no resultado", async () => {
  const a = ambiente();
  a.deps.assistente.responder.mockImplementation(async ({ executar, ferramentas, messages }) => {
    expect(ferramentas.map(f => f.name)).toEqual(["registrar_atendimento"]);
    expect(messages.at(-1).content).toContain("Quero abrir uma empresa");
    const resultado = await executar("registrar_atendimento", { campos: [{ campo: "responsavelNome", acao: "set", valor: "Carla" }] });
    expect(resultado.dadosRegistrados.responsavelNome).toBe("Carla");
    expect(a.deps.cloud.enviarTexto).not.toHaveBeenCalled();
    return fim("Carla, pode contratar só a abertura. Se quiser, comparamos também a opção com contabilidade mensal.");
  });
  expect(await a.rodar()).toMatchObject({ feito: true, motivo: "RESPONDIDA" });
  expect(a.deps.cloud.enviarTexto).toHaveBeenCalledWith(expect.objectContaining({ texto: expect.stringContaining("Carla, pode contratar só a abertura") }));
  expect(a.db.eventos).toEqual(["dados-salvos", "saida-registrada", "transporte"]);
});

test("duas bolhas com o mesmo timestamp viram uma resposta e preservam os dois IDs de origem", async () => {
  const a = ambiente([entrada(), entrada("m2", "Meu nome é Carla")]);
  a.deps.assistente.responder.mockImplementation(async ({ messages, executar }) => {
    expect(messages.at(-1).content).toContain("Quero abrir uma empresa\nMeu nome é Carla");
    await executar("registrar_atendimento", { campos: [{ campo: "responsavelNome", acao: "set", valor: "Carla" }] }); return fim();
  });
  expect(await a.rodar()).toMatchObject({ feito: true, mensagensRespondidas: ["m1", "m2"] });
  expect(registrarCampos).toHaveBeenCalledWith(expect.objectContaining({ mensagemId: "m1", mensagensIds: ["m1", "m2"] }));
  expect(a.db.mensagens.filter(m => m.direcao === "in").every(m => m.respondidaPelaIaEm)).toBe(true);
  expect(await a.rodar("m2")).toMatchObject({ feito: false, motivo: "JA_RESPONDIDA" });
  expect(a.deps.assistente.responder).toHaveBeenCalledTimes(1);
  expect(a.deps.cloud.enviarTexto).toHaveBeenCalledTimes(1);
});

test("histórico desempata timestamp por ID e não inclui mensagem futura fora do lote", async () => {
  const a = ambiente([entrada("m0", "Histórico do mesmo instante"), entrada(), entrada("m9", "Mensagem futura", 9000)]);
  a.deps.assistente.responder.mockImplementation(async ({ messages, executar }) => {
    const texto = JSON.stringify(messages);
    expect(texto).toContain("Histórico do mesmo instante"); expect(texto).not.toContain("Mensagem futura");
    await executar("registrar_atendimento", {}); return fim();
  });
  expect(await a.rodar()).toMatchObject({ feito: true, mensagensRespondidas: ["m1"] });
});

test("resposta intermediária impede agrupar o próximo pedido", async () => {
  const a = ambiente([entrada(), { ...entrada("m2", "Resposta da equipe", 1000), direcao: "out", statusEnvio: "enviado" }, entrada("m3", "Outro pedido", 2000)]);
  expect(await a.rodar()).toMatchObject({ feito: true, mensagensRespondidas: ["m1"] });
});

test.each(["Preço inventado R$ 1", "Custa 895 reais", "Sua alíquota é 5%", "A abertura fica por 895", "A abertura é gratuita"])("não envia condição comercial inventada: %s", async texto => {
  const a = ambiente();
  a.deps.assistente.responder.mockImplementation(async ({ executar }) => { await executar("registrar_atendimento", {}); return fim(texto); });
  expect(await a.rodar()).toMatchObject({ feito: true });
  expect(a.deps.cloud.enviarTexto.mock.calls[0][0].texto).toBe("Qual atividade você pretende exercer?");
});

test("pedido de contador só é confirmado após o handoff persistido", async () => {
  const a = ambiente();
  a.deps.assistente.responder.mockImplementation(async ({ executar }) => { await executar("registrar_atendimento", { chamarContador: true }); return fim("Já mandei para ele"); });
  a.deps.cloud.enviarTexto.mockImplementation(async ({ texto }) => {
    expect(a.db.conversa.atendidaDesde).toBeInstanceOf(Date);
    expect(texto).toContain("O contador vai conferir"); a.db.eventos.push("transporte"); return { wamid: "wamid.handoff" };
  });
  expect(await a.rodar()).toMatchObject({ feito: true, motivo: "ENCAMINHADA" });
  expect(a.db.eventos).toEqual(["handoff-persistido", "saida-registrada", "transporte"]);
});

test("falha de banco ao encaminhar não afirma encaminhamento nem envia mensagem", async () => {
  const a = ambiente();
  a.deps.assistente.responder.mockImplementation(async ({ executar }) => { await executar("registrar_atendimento", { chamarContador: true }); return fim("Já encaminhei"); });
  a.db.conversaWhatsapp.updateMany.mockRejectedValueOnce(new Error("banco indisponível"));
  expect(await a.rodar()).toMatchObject({ feito: false, motivo: "ERRO" });
  expect(a.deps.cloud.enviarTexto).not.toHaveBeenCalled();
  expect(a.db.mensagens.filter(m => m.direcao === "out")).toHaveLength(0);
});

test("contador assumindo durante a geração impede resposta pendente", async () => {
  const a = ambiente();
  a.deps.assistente.responder.mockImplementation(async ({ executar }) => { await executar("registrar_atendimento", {}); a.db.conversa.atendidaPor = "contador"; return fim(); });
  expect(await a.rodar()).toMatchObject({ feito: false, motivo: "ASSUMIDA_POR_HUMANO" });
  expect(a.deps.cloud.enviarTexto).not.toHaveBeenCalled();
});

test("contador assumindo entre reserva de saída e rede também impede envio", async () => {
  const a = ambiente();
  const criar = a.db.mensagemWhatsapp.create.getMockImplementation();
  a.db.mensagemWhatsapp.create.mockImplementation(async args => { const m = await criar(args); a.db.conversa.atendidaPor = "contador"; return m; });
  expect(await a.rodar()).toMatchObject({ feito: false, indeterminado: false, motivo: "ASSUMIDA_POR_HUMANO" });
  expect(a.deps.cloud.enviarTexto).not.toHaveBeenCalled();
  expect(a.db.mensagens.find(m => m.direcao === "out").statusEnvio).toBe("falhou");
});

test("erro de crédito do modelo encaminha com fallback e não inventa resposta", async () => {
  const a = ambiente();
  a.deps.assistente.responder.mockRejectedValueOnce(Object.assign(new Error("créditos indisponíveis"), { codigo: "CREDITO_PROVEDOR" }));
  expect(await a.rodar()).toMatchObject({ feito: true, motivo: "ENCAMINHADA" });
  expect(a.deps.concluir).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ erroCodigo: "CREDITO_PROVEDOR" }), expect.anything());
  expect(a.deps.cloud.enviarTexto.mock.calls[0][0].texto).toContain("O contador vai conferir");
});

test("teto de custo não chama o modelo e persiste encaminhamento", async () => {
  const a = ambiente(); a.deps.autorizar.mockResolvedValueOnce({ ok: false, motivo: "LIMITE" });
  expect(await a.rodar()).toMatchObject({ feito: true, motivo: "ENCAMINHADA" });
  expect(a.deps.assistente.responder).not.toHaveBeenCalled();
  expect(a.db.conversa.atendidaDesde).toBeInstanceOf(Date);
});

test("modelo sem função não tem resposta livre enviada", async () => {
  const a = ambiente(); a.deps.assistente.responder.mockResolvedValueOnce(fim("Já registrei todos os seus dados"));
  expect(await a.rodar()).toMatchObject({ feito: true, motivo: "ENCAMINHADA" });
  expect(a.deps.cloud.enviarTexto.mock.calls[0][0].texto).not.toContain("todos os seus dados");
});

test("timeout de envio conserva saída incerta e reentrega não chama modelo nem rede novamente", async () => {
  const a = ambiente(); a.deps.cloud.enviarTexto.mockRejectedValueOnce(Object.assign(new Error("timeout"), { codigo: "TIMEOUT" }));
  expect(await a.rodar()).toMatchObject({ feito: false, indeterminado: true, motivo: "TIMEOUT" });
  expect(a.db.mensagens.find(m => m.direcao === "out").statusEnvio).toBe("indeterminado");
  expect(await a.rodar()).toMatchObject({ feito: false, indeterminado: true, motivo: "SAIDA_JA_REGISTRADA" });
  expect(a.deps.assistente.responder).toHaveBeenCalledTimes(1);
  expect(a.deps.cloud.enviarTexto).toHaveBeenCalledTimes(1);
});

test("falha para marcar bolhas após envio aceito é indeterminada e não duplica o mesmo turno", async () => {
  const a = ambiente(); a.db.mensagemWhatsapp.updateMany.mockRejectedValueOnce(new Error("banco indisponível"));
  expect(await a.rodar()).toMatchObject({ feito: false, indeterminado: true });
  expect(await a.rodar()).toMatchObject({ feito: false, indeterminado: true, motivo: "SAIDA_JA_REGISTRADA" });
  expect(a.deps.cloud.enviarTexto).toHaveBeenCalledTimes(1);
});

test("segunda bolha já incluída em saída incerta não cria outra resposta", async () => {
  const a = ambiente([entrada(), entrada("m2", "Meu nome é Carla")]);
  a.deps.cloud.enviarTexto.mockRejectedValueOnce(Object.assign(new Error("timeout"), { codigo: "TIMEOUT" }));
  expect(await a.rodar()).toMatchObject({ feito: false, indeterminado: true });
  expect(await a.rodar("m2")).toMatchObject({ feito: false, indeterminado: true });
  expect(a.deps.assistente.responder).toHaveBeenCalledTimes(1);
  expect(a.deps.cloud.enviarTexto).toHaveBeenCalledTimes(1);
});

test.each([false, true])("dois jobs simultâneos compartilham lease e não duplicam o lote (timeout=%s)", async timeout => {
  const a = ambiente([entrada(), entrada("m2", "Meu nome é Carla")]);
  const posses = new Set();
  adquirirLease.mockImplementation(async id => {
    if (posses.has(id)) return null;
    posses.add(id); return { id, token: "posse" };
  });
  liberarLease.mockImplementation(async lease => { posses.delete(lease.id); });
  let avisarModelo, liberarModelo;
  const iniciouModelo = new Promise(resolve => { avisarModelo = resolve; });
  const continuar = new Promise(resolve => { liberarModelo = resolve; });
  a.deps.assistente.responder.mockImplementation(async ({ executar }) => {
    avisarModelo(); await continuar; await executar("registrar_atendimento", {}); return fim();
  });
  if (timeout) a.deps.cloud.enviarTexto.mockRejectedValueOnce(Object.assign(new Error("timeout"), { codigo: "TIMEOUT" }));
  const primeira = a.rodar();
  await iniciouModelo;
  expect(await a.rodar("m2")).toMatchObject({ feito: false, motivo: "OCUPADO" });
  liberarModelo();
  expect(await primeira).toMatchObject(timeout ? { feito: false, indeterminado: true } : { feito: true });
  const depois = await a.rodar("m2");
  expect(depois).toMatchObject(timeout ? { feito: false, indeterminado: true, motivo: "SAIDA_JA_REGISTRADA" } : { feito: false, motivo: "JA_RESPONDIDA" });
  expect(a.deps.assistente.responder).toHaveBeenCalledTimes(1);
  expect(a.deps.cloud.enviarTexto).toHaveBeenCalledTimes(1);
});

test.each(["outra-conversa", "legado-sem-correlacao"])("saída %s não é presumida como resposta da mensagem atual", async caso => {
  const a = ambiente();
  a.db.mensagens.push({ ...entrada("saida-anterior", "Texto antigo", 1000), direcao: "out", turnoIaId: "outro-turno", statusEnvio: "indeterminado",
    conversaId: caso === "outra-conversa" ? "cv-outro" : "cv",
    referenciaComercial: caso === "outra-conversa" ? { mensagensIds: ["m1"] } : null,
  });
  expect(await a.rodar()).toMatchObject({ feito: true });
  expect(a.deps.cloud.enviarTexto).toHaveBeenCalledTimes(1);
});

test("lease ocupado não consulta ficha e não chama modelo", async () => {
  const a = ambiente(); adquirirLease.mockResolvedValueOnce(null);
  expect(await a.rodar()).toEqual({ feito: false, motivo: "OCUPADO" });
  expect(iniciarAtendimento).not.toHaveBeenCalled();
  expect(a.deps.assistente.responder).not.toHaveBeenCalled();
  expect(liberarLease).not.toHaveBeenCalled();
});

test("orientação aprovada preserva texto e versão sem reescrita pelo modelo", async () => {
  const a = ambiente();
  criarRecursosComerciais.mockReturnValue({ listar: jest.fn(async () => [{ id: "orientacao", chave: "autorizacao", titulo: "Procuração" }]), prepararOrientacao: jest.fn(async () => ({ texto: "Passo a passo aprovado pelo escritório.", referencia: { chave: "autorizacao", recursoId: "orientacao", versao: 3 } })) });
  a.deps.assistente.responder.mockImplementation(async ({ executar }) => { await executar("registrar_atendimento", { orientacaoId: "orientacao" }); return fim("Texto reescrito indevidamente"); });
  expect(await a.rodar()).toMatchObject({ feito: true, motivo: "RESPONDIDA" });
  expect(a.deps.cloud.enviarTexto.mock.calls[0][0].texto).toBe("Passo a passo aprovado pelo escritório.");
  expect(a.db.mensagens.find(m => m.direcao === "out").referenciaComercial).toMatchObject({ recursoId: "orientacao", versao: 3 });
  expect(a.db.lead.autorizacao.estado).toBe("INSTRUCAO_ENVIADA");
});
