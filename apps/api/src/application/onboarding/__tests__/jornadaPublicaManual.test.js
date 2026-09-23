jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { criarJornadaLead } from "../JornadaLeadService.js";
import { montarJornadaComercial } from "../PoliticaJornadaComercial.js";
import { criarPropostasComerciais } from "../PropostasComerciaisService.js";
import { propostaParaCliente } from "../PropostaComercialPdf.js";
import { CATALOGO_SINTETICO } from "./fixtures/catalogoSintetico.js";

const user = { id: "contador-sintetico", role: "contador" };
const cnpj = "11222333000181";
const manual = { fonte: "Documento cadastral apresentado pelo cliente", evidencia: "Conferi CNPJ e razão social no documento recebido, com registro no atendimento." };
const clone = v => structuredClone(v);
function matches(item, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.path) return item[key]?.[value.path[0]] === value.equals;
      if (value.in) return value.in.includes(item[key]);
      if (value.notIn) return !value.notIn.includes(item[key]);
      if (Object.hasOwn(value, "not")) return item[key] !== value.not;
    }
    return item[key] === value;
  });
}
function setup(origem = "TRANSFERENCIA") {
  const ficha = { id: "ficha-sintetica", criadoPorId: user.id, origem, cnpj, versao: 1, status: "RASCUNHO", responsavelNome: "Pessoa exemplo", dados: { modalidadeServico: "AVULSO" } };
  const eventos = [], analises = [], propostas = [], contratos = [];
  let sequence = 0;
  const ordered = list => [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || String(b.id).localeCompare(String(a.id)));
  const create = (list, data) => { const item = { id: `registro-${String(++sequence).padStart(4, "0")}`, createdAt: new Date(), ...clone(data) }; list.push(item); return clone(item); };
  const db = {
    onboarding: {
      findUnique: jest.fn(async () => clone(ficha)),
      update: jest.fn(async ({ data }) => { Object.assign(ficha, clone(data)); return clone(ficha); }),
      updateMany: jest.fn(async ({ where, data }) => { if (!matches(ficha, where)) return { count: 0 }; if (data.versao?.increment) ficha.versao += data.versao.increment; return { count: 1 }; }),
    },
    onboardingAnalise: {
      findMany: jest.fn(async ({ where }) => clone(ordered(analises.filter(a => matches(a, where))))),
      findFirst: jest.fn(async ({ where }) => clone(ordered(analises.filter(a => matches(a, where)))[0] || null)),
      create: jest.fn(async ({ data }) => create(analises, data)),
    },
    onboardingEvento: {
      findMany: jest.fn(async ({ where, take }) => clone(ordered(eventos.filter(e => matches(e, where))).slice(0, take))),
      findFirst: jest.fn(async ({ where }) => clone(ordered(eventos.filter(e => matches(e, where)))[0] || null)),
      create: jest.fn(async ({ data }) => create(eventos, data)),
    },
    mensagemWhatsapp: { findMany: jest.fn(async () => []) },
    propostaComercial: {
      findFirst: jest.fn(async ({ where }) => clone([...propostas].reverse().find(p => matches(p, where)) || null)),
      create: jest.fn(async ({ data }) => create(propostas, { status: "RASCUNHO", revogadaEm: null, ...data })),
      update: jest.fn(async ({ where, data }) => { const p = propostas.find(p => p.id === where.id); Object.assign(p, clone(data)); return clone(p); }),
      updateMany: jest.fn(async ({ where, data }) => { const items = propostas.filter(p => matches(p, where)); for (const p of items) Object.assign(p, clone(data)); return { count: items.length }; }),
    },
    recursoComercial: {
      findFirst: jest.fn(async () => ({ id: "catalogo-sintetico", versao: 1, dados: CATALOGO_SINTETICO })),
      findUnique: jest.fn(async () => ({ id: "modelo-sintetico", tipo: "CONTRATO", aprovadoEm: new Date(), versao: 1, dados: { recorrente: false }, texto: "{{nome}}: {{servico}}. Honorários: {{honorarios}}. {{condicoes}}" })),
    },
    contratoComercial: { upsert: jest.fn(async ({ create: data }) => create(contratos, data)) },
  };
  let lock = Promise.resolve();
  db.$transaction = jest.fn(async fn => { const anterior = lock; let release; lock = new Promise(r => { release = r; }); await anterior; try { return await fn(db); } finally { release(); } });
  const jornada = criarJornadaLead({ db });
  return { ficha, eventos, analises, propostas, contratos, db, jornada,
    conferir: (body = {}) => jornada.conferirAnalise(ficha.id, user, { tipo: "PUBLICA", versao: ficha.versao, manual, ...body }),
    diagnosticar: (body = {}) => jornada.diagnosticar(ficha.id, user, { versao: ficha.versao,
      devolutiva: { certo: "Cadastro conferido pelo contador para delimitar o atendimento.", atencao: "A situação fiscal privada ainda não foi consultada.", corrigir: "Atualização cadastral restrita ao serviço solicitado." },
      regularizacao: { necessaria: false, justificativa: "Não identificada no escopo cadastral restrito conferido.", condicaoInicioMensal: "SEM_REGULARIZACAO" },
      servicos: "Serviço cadastral solicitado pelo interessado.", dispensaConsultaPrivada: "Escopo restrito ao serviço cadastral; não foi consultada a situação fiscal privada.", ...body }),
  };
}

test.each(["TRANSFERENCIA", "INATIVA"])("%s segue manualmente sem fabricar consulta nem regularidade fiscal", async origem => {
  const t = setup(origem); const evidencia = await t.conferir();
  expect(evidencia).toMatchObject({ tipo: "JORNADA_PUBLICA_MANUAL_CONFERIDA", atorId: user.id, dados: { cnpj, fichaVersao: 1, ...manual } });
  expect(t.db.onboardingAnalise.create).not.toHaveBeenCalled();
  const j = await t.jornada.carregar(t.ficha.id, user);
  expect(j.publicaConferida).toBe(true); expect(j.publicaConferencia).toMatchObject({ modo: "MANUAL", id: evidencia.id, ...manual });
  expect(j.fiscalConferido).toBe(false); expect(j.analises).toEqual([]);
  const d = await t.diagnosticar();
  expect(d.dados.conferenciaCadastro).toMatchObject({ modo: "MANUAL", id: evidencia.id });
  expect(d.dados.texto).toMatch(/cadast.*manual/i); expect(d.dados.texto).toMatch(/consulta automática não/i);
  expect(d.dados.analiseId).toBeNull();
  await t.jornada.registrarApresentacao(t.ficha.id, user, { versao: t.ficha.versao, diagnosticoId: d.id, meio: "Reunião", evidencia: "Escopo apresentado em reunião com o interessado." });
  const final = await t.jornada.carregar(t.ficha.id, user);
  const politica = montarJornadaComercial({ onboarding: t.ficha, jornada: final });
  expect(politica.comandosPermitidos.aprovarProposta).toBe(true);
  expect(politica.passos.find(p => p.id === "publica").concluido).toBe(true);
  expect(politica.fiscal).toBeUndefined();
});

test.each([
  { fonte: "", evidencia: manual.evidencia },
  { fonte: manual.fonte, evidencia: "ok" },
  { fonte: "a".repeat(301), evidencia: manual.evidencia },
  { fonte: manual.fonte, evidencia: "x".repeat(2001) },
])("conferência manual exige fonte e evidência legíveis: %j", async dados => {
  const t = setup(); await expect(t.conferir({ manual: dados })).rejects.toMatchObject({ code: "conferencia_manual_invalida" });
  expect(t.eventos).toHaveLength(0);
});

test("não permite usar modo manual para fingir SITFIS consultado", async () => {
  const t = setup(); await expect(t.conferir({ tipo: "SITFIS" })).rejects.toMatchObject({ code: "conferencia_invalida" });
  expect(t.eventos).toHaveLength(0);
});

test("conferência manual respeita gestor, ficha, CNPJ, versão e encerramento", async () => {
  const t = setup();
  await expect(t.jornada.conferirAnalise(t.ficha.id, { id: "externo", role: "cliente" }, { tipo: "PUBLICA", versao: 1, manual })).rejects.toMatchObject({ code: "forbidden" });
  await expect(t.conferir({ versao: 0 })).rejects.toMatchObject({ code: "formulario_alterado" });
  t.ficha.cnpj = null; await expect(t.conferir()).rejects.toMatchObject({ code: "cnpj_necessario" });
  t.ficha.cnpj = cnpj; t.ficha.status = "DESISTIU";
  await expect(t.conferir()).rejects.toMatchObject({ code: "formulario_alterado" }); expect(t.eventos).toHaveLength(0);
});

test("cliques duplicados idênticos conservam a mesma conferência", async () => {
  const t = setup(); const respostas = await Promise.all([t.conferir(), t.conferir()]);
  expect(respostas[0].id).toBe(respostas[1].id); expect(t.eventos).toHaveLength(1);
});

test("CNPJ alterado invalida a conferência manual e o diagnóstico anteriores", async () => {
  const t = setup(); await t.conferir(); const anterior = await t.diagnosticar();
  t.ficha.cnpj = "99888777000166"; t.ficha.versao++;
  const j = await t.jornada.carregar(t.ficha.id, user);
  expect(j.publicaConferida).toBe(false); expect(j.publicaConferencia).toBeNull(); expect(j.diagnostico).toBeNull();
  expect(j.diagnosticoAnterior).toEqual(anterior.dados);
  expect(j.devolutiva.concluida).toBe(false);
  await expect(t.diagnosticar()).rejects.toMatchObject({ code: "analise_pendente" });
});

test("nova conferência manual invalida diagnóstico e apresentação anteriores", async () => {
  const t = setup(); await t.conferir(); const d = await t.diagnosticar();
  await t.conferir({ manual: { ...manual, evidencia: "Documento novo recebido; conferência revista após atualização cadastral." } });
  const j = await t.jornada.carregar(t.ficha.id, user);
  expect(j.diagnostico).toBeNull(); expect(j.diagnosticoDesatualizado).toBe(true);
  await expect(t.jornada.registrarApresentacao(t.ficha.id, user, { versao: t.ficha.versao, diagnosticoId: d.id, meio: "Reunião", evidencia: "Conferida" })).rejects.toMatchObject({ code: "diagnostico_alterado" });
});

test("diagnóstico preserva pendências e não transforma roteiro vazio em consultas realizadas", async () => {
  const t = setup(); await t.conferir(); const d = await t.diagnosticar();
  expect(Object.values(d.dados.roteiro.conferencias).every(c => c.estado === "PENDENTE")).toBe(true);
  expect(d.dados.roteiroPendencias).toContain("Certidões RFB e PGFN");
  expect(d.dados.texto).toContain("O que está certo:");
  expect(d.dados.texto).toContain("Pontos de atenção e o que falta conferir:");
  expect(d.dados.texto).toContain("O que podemos corrigir ou fazer a seguir:");
  expect(d.dados.texto).toContain("Ainda não conferido nesta análise:");
  expect(d.dados.fichaVersao).toBe(t.ficha.versao);
  expect(t.db.onboardingAnalise.create).not.toHaveBeenCalled();
});

test("diagnóstico novo exige os três blocos e uma decisão sobre regularização", async () => {
  const t = setup(); await t.conferir();
  await expect(t.diagnosticar({ devolutiva: undefined })).rejects.toMatchObject({ code: "diagnostico_incompleto" });
  await expect(t.diagnosticar({ regularizacao: undefined })).rejects.toMatchObject({ code: "diagnostico_incompleto" });
  await expect(t.diagnosticar({ regularizacao: { necessaria: true, justificativa: "Regularização de declarações omissas.", condicaoInicioMensal: "SEM_REGULARIZACAO" } })).rejects.toMatchObject({ code: "diagnostico_incompleto" });
  expect(t.eventos.filter(e => e.tipo === "JORNADA_DIAGNOSTICO")).toHaveLength(0);
});

test("conferido ou não aplicável precisa de evidência; alteração exige nova apresentação", async () => {
  const t = setup(); await t.conferir();
  for (const estado of ["FEITO", "NAO_APLICAVEL"]) await expect(t.diagnosticar({ roteiro: { conferencias: { certidoesFederais: { estado, evidencia: "ok" } } } })).rejects.toMatchObject({ code: "diagnostico_incompleto" });
  const d = await t.diagnosticar({ roteiro: { conferencias: { certidoesFederais: { estado: "FEITO", evidencia: "Certidões apresentadas e validade conferida manualmente." } } } });
  await t.jornada.registrarApresentacao(t.ficha.id, user, { versao: t.ficha.versao, diagnosticoId: d.id, meio: "Reunião", evidencia: "Apresentação sintética conferida." });
  const novo = await t.diagnosticar({ diagnosticoBaseId: d.id, roteiro: { conferencias: { certidoesFederais: { estado: "FEITO", evidencia: "Nova certidão apresentada com validade revisada." } } } });
  expect(novo.id).not.toBe(d.id); expect((await t.jornada.carregar(t.ficha.id, user)).devolutiva.concluida).toBe(false);
  await expect(t.diagnosticar({ diagnosticoBaseId: d.id, servicos: "Escopo de um rascunho concorrente desatualizado." })).rejects.toMatchObject({ code: "diagnostico_alterado" });
});

test("mudança material de regime ou folha invalida diagnóstico estruturado sem apagar evidências", async () => {
  const t = setup(); t.ficha.dados = { regimeAtual: "SIMPLES", qtdFuncionarios: 2 }; await t.conferir(); const d = await t.diagnosticar();
  t.ficha.dados.qtdFuncionarios = 4; t.ficha.versao++;
  const j = await t.jornada.carregar(t.ficha.id, user);
  expect(j.diagnostico).toBeNull(); expect(j.diagnosticoAnteriorId).toBe(d.id); expect(j.diagnosticoAnterior.roteiro).toEqual(d.dados.roteiro);
  expect(j.diagnosticoDesatualizado).toBe(true);
});

test("primeiro preenchimento de perfil ausente conserva o diagnóstico que não utilizou esses dados", async () => {
  const t = setup(); await t.conferir(); const d = await t.diagnosticar();
  expect(d.dados.perfilConferido).toEqual({});
  Object.assign(t.ficha.dados, { regimeAtual: "SIMPLES", qtdFuncionarios: 2, notasRecebidasMes: 20, consultoriaMensal: false }); t.ficha.versao++;
  const j = await t.jornada.carregar(t.ficha.id, user);
  expect(j.diagnostico.id).toBe(d.id); expect(j.diagnosticoDesatualizado).toBe(false);
  expect(j.diagnostico.dados.roteiroPendencias).toContain("Funcionários CLT"); // snapshot antigo não foi reescrito como conferido
});

test("a ficha é a fonte da folha e dos documentos usados na análise e no orçamento", async () => {
  const t = setup(); t.ficha.dados = { qtdFuncionarios: 2, notasRecebidasMes: 20 }; await t.conferir();
  const d = await t.diagnosticar({ roteiro: { dados: { funcionariosClt: 100, documentosEntradaMes: 999, receita12Meses: 120000 } } });
  expect(d.dados.roteiro.dados).toMatchObject({ funcionariosClt: 2, documentosEntradaMes: 20, receita12Meses: 120000 });
});

test("devolutiva longa é recusada antes da gravação para caber no WhatsApp com a assinatura", async () => {
  const t = setup(); await t.conferir();
  await expect(t.diagnosticar({ devolutiva: { certo: "a".repeat(1200), atencao: "b".repeat(1200), corrigir: "c".repeat(1200) }, servicos: "d".repeat(1200) })).rejects.toMatchObject({ code: "diagnostico_incompleto" });
  expect(t.eventos.filter(e => e.tipo === "JORNADA_DIAGNOSTICO")).toHaveLength(0);
});

test("origem manual fica no snapshot; contrato conserva exatamente preço e escopo aceitos", async () => {
  const t = setup(); await t.conferir(); const diagnostico = await t.diagnosticar();
  await t.jornada.registrarApresentacao(t.ficha.id, user, { versao: t.ficha.versao, diagnosticoId: diagnostico.id, meio: "Presencial", evidencia: "Cliente conferiu o escopo durante reunião." });
  const s = criarPropostasComerciais({ db: t.db });
  const p = await s.gerar(t.ficha.id, user, { versao: t.ficha.versao, ajustes: { tipoServicoAvulso: "OUTRO", servicoCentavos: 24680, justificativa: "Honorário sintético conferido", escopoAvulso: "Serviço cadastral sintético." } });
  const aprovada = await s.aprovar(t.ficha.id, p.id, user);
  expect(aprovada.snapshot.conferenciaCadastro).toMatchObject({ modo: "MANUAL", id: diagnostico.dados.conferenciaCadastro.id });
  const publica = propostaParaCliente(aprovada);
  expect(publica.conferenciaCadastro).toEqual({ modo: "MANUAL" });
  expect(JSON.stringify(publica)).not.toContain(manual.evidencia);
  const aceita = t.propostas.find(v => v.id === p.id); aceita.status = "ACEITA"; aceita.opcaoAceita = "AVULSO";
  const ct = await s.contrato(t.ficha.id, p.id, user, { modeloId: "modelo-sintetico", variaveis: { honorarios: "0", servico: "escopo inventado" } });
  expect(ct.dados.opcao).toEqual(aceita.snapshot.opcoes[0]); expect(ct.dados.opcao.unicoCentavos).toBe(24680);
  expect(ct.texto).toContain("246,80"); expect(ct.texto).not.toContain("escopo inventado");
});

test("proposta mensal gerada e aprovada alimenta formulário contratual sem permitir alterar os termos aceitos", async () => {
  const t = setup();
  t.ficha.dados = { modalidadeServico: "RECORRENTE", regimeAtual: "SIMPLES", qtdFuncionarios: 2, notasRecebidasMes: 15, consultoriaMensal: false };
  await t.conferir(); const diagnostico = await t.diagnosticar();
  await t.jornada.registrarApresentacao(t.ficha.id, user, { versao: t.ficha.versao, diagnosticoId: diagnostico.id, meio: "Presencial", evidencia: "Cliente conferiu serviços mensais e condições em reunião." });
  const service = criarPropostasComerciais({ db: t.db });
  const p = await service.gerar(t.ficha.id, user, { versao: t.ficha.versao, ajustes: {} });
  await service.aprovar(t.ficha.id, p.id, user);
  const aceita = t.propostas.find(v => v.id === p.id); aceita.status = "ACEITA"; aceita.opcaoAceita = "RECORRENTE";
  const opcao = aceita.snapshot.opcoes.find(o => o.chave === "RECORRENTE");
  const modelo = { id: "modelo-mensal", tipo: "CONTRATO", aprovadoEm: new Date(), versao: 2,
    dados: { recorrente: true, camposPadrao: { diaVencimento: 10 } },
    texto: "{{nome}} {{honorariosMensais}} {{honorariosMensaisExtenso}} {{servico}} {{condicoes}}; até {{limiteFuncionarios}} pessoas e {{limiteDocumentos}} documentos; vencimento {{diaVencimento}}" };
  t.db.recursoComercial.findUnique.mockResolvedValue(modelo);
  const c = await service.contrato(t.ficha.id, p.id, user, { modeloId: modelo.id, variaveis: { honorariosMensais: "R$ 1", honorariosMensaisExtenso: "um real", servico: "Escopo adulterado", condicoes: "Condições adulteradas", limiteFuncionarios: 999, limiteDocumentos: 999, diaVencimento: 18 } });
  expect(c.dados.opcao).toEqual(opcao);
  expect(c.dados.variaveis).toMatchObject({ servico: opcao.escopo, condicoes: aceita.snapshot.condicoes, limiteFuncionarios: aceita.snapshot.limitesPlano.funcionarios, limiteDocumentos: aceita.snapshot.limitesPlano.documentosEntradaMes, diaVencimento: 18 });
  expect(c.texto).toContain((opcao.mensalCentavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
  expect(c.texto).not.toMatch(/adulterad|999/);
  expect(c.dados.modeloVersao).toBe(2);
  const gravacoes = t.db.contratoComercial.upsert.mock.calls.length;
  await expect(service.contrato(t.ficha.id, p.id, user, { modeloId: modelo.id, variaveis: { diaVencimento: 50 } })).rejects.toMatchObject({ code: "contrato_incompleto" });
  expect(t.db.contratoComercial.upsert).toHaveBeenCalledTimes(gravacoes);
});

test("conferência por consulta preserva origem, exige análise exata e não dispensa SITFIS sozinha", async () => {
  const t = setup();
  t.analises.push({ id: "publica-sintetica", onboardingId: t.ficha.id, cnpj, tipo: "PUBLICA", status: "CONCLUIDA", createdAt: new Date() });
  await expect(t.jornada.conferirAnalise(t.ficha.id, user, { versao: 1, tipo: "PUBLICA", analiseId: "outra" })).rejects.toMatchObject({ code: "analise_pendente" });
  await t.jornada.conferirAnalise(t.ficha.id, user, { versao: 1, tipo: "PUBLICA", analiseId: "publica-sintetica" });
  const j = await t.jornada.carregar(t.ficha.id, user);
  expect(j.publicaConferencia).toMatchObject({ modo: "CONSULTA", analiseId: "publica-sintetica" }); expect(t.ficha.versao).toBe(1);
  await expect(t.jornada.diagnosticar(t.ficha.id, user, { versao: 1, achados: "Conferência cadastral sintética.", servicos: "Serviços solicitados pelo cliente." })).rejects.toMatchObject({ code: "analise_pendente" });
});
