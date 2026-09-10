// Core, parser, persistência da saída e hidratação reais. Somente banco, lease, transportes e
// consulta de vínculo são dublês. Não chama modelo, provedor fiscal nem WhatsApp real.
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../WhatsappLeaseService.js", () => {
  const donos = new Map();
  let sequencia = 0;
  return {
    __limparLeases: () => donos.clear(),
    adquirirLease: jest.fn(async id => { if (donos.has(id)) return null; const token = `dono-${++sequencia}`; donos.set(id, token); return { id, token }; }),
    renovarLease: jest.fn(async l => donos.get(l.id) === l.token),
    liberarLease: jest.fn(async l => { if (donos.get(l.id) === l.token) donos.delete(l.id); }),
  };
});

import { Prisma } from "@prisma/client";
import { atenderContextoResponsavel, resolverContextoDaMensagem, carregarMensagemResolvida, conferirContextoResponsavel } from "../AtendimentoResponsavelWhatsappService.js";
import { adquirirLease, renovarLease, liberarLease, __limparLeases } from "../WhatsappLeaseService.js";

const AGORA = new Date("2026-09-10T12:00:00.000Z");
const TELEFONE = "5521999998888";
const log = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
const copy = v => v === undefined ? undefined : structuredClone(v);
const ehData = v => Object.prototype.toString.call(v) === "[object Date]";
const sinal = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const empresa = (id, razao, cnpj) => ({ portalClientId: id, razao, cnpj, aliases: [id], pessoaAmbigua: false,
  contatos: [{ contatoId: `contato-${id}`, userId: "liz", nome: "Liz sintética", papelRbac: "CLIENT_ADMIN", statusRbac: "ACTIVE" }] });
const EMPRESAS = [empresa("klaus", "Klaus sintética", "11222333000181"), empresa("lente", "Lente sintética", "11444777000161"), empresa("alessandro", "Alessandro sintético", "19131243000197")];
const vinculo = empresas => ({ situacao: empresas.length > 1 ? "AMBIGUO" : empresas.length ? "VINCULADO" : "DESCONHECIDO", leitura: "ESTRITA", e164: TELEFONE, ambiguidades: empresas.length > 1 ? ["EMPRESA"] : [], empresas: copy(empresas) });

function casa(row, where) {
  if (where === undefined) return true;
  if (where === null || typeof where !== "object" || ehData(where)) return (row ?? null) === where || ehData(row) && ehData(where) && +row === +where;
  if (Object.hasOwn(where, "not")) return !casa(row, where.not);
  if (where.is) return row != null && casa(row, where.is);
  if (where.some) return (row || []).some(v => casa(v, where.some));
  if (where.none) return !(row || []).some(v => casa(v, where.none));
  if (where.in) return where.in.includes(row);
  if (where.notIn) return !where.notIn.includes(row);
  if (where.gt !== undefined) return row != null && row > where.gt;
  if (where.gte !== undefined) return row != null && row >= where.gte;
  if (where.lt !== undefined) return row != null && row < where.lt;
  if (where.lte !== undefined) return row != null && row <= where.lte;
  return Object.entries(where).every(([key, value]) => key === "OR" ? value.some(f => casa(row, f)) : key === "AND" ? value.every(f => casa(row, f)) : casa(row?.[key], value));
}

function banco() {
  const rows = { conversaWhatsapp: [], mensagemWhatsapp: [], atendimentoResponsavelWhatsapp: [], resolucaoContextoWhatsapp: [], rascunhoEmissaoWhatsapp: [], acaoPendenteWhatsapp: [], turnoIaWhatsapp: [] };
  const hooks = {};
  let sequencia = 0;
  const defaults = name => name === "conversaWhatsapp" ? { portalClientId: null, atendimentoId: null, atendidaPor: null, atendidaDesde: null, excluidaEm: null, automacaoInvalidadaEm: null }
    : name === "atendimentoResponsavelWhatsapp" ? { canal: "principal", userId: null, versao: 1, portalClientId: null, conversaId: null, aguardandoSelecao: true, pedidoPendente: null, interacaoPendente: null, coletaPendenteConversaId: null, ultimaInteracaoEm: null, ultimaMensagemId: null, atendidaPor: null, atendidaDesde: null, automacaoInvalidadaEm: null, expiraEm: null }
      : name === "mensagemWhatsapp" ? { registradaEm: new Date(), respondidaPelaIaEm: null } : {};
  const atribuir = (row, data) => { for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value === Prisma.DbNull ? null : value?.increment != null ? (row[key] || 0) + value.increment : copy(value); return row; };
  const expandir = (name, row) => {
    if (!row) return null;
    if (name === "conversaWhatsapp") return { ...row, portalClient: EMPRESAS.find(e => e.portalClientId === row.portalClientId) ? { id: row.portalClientId, ...EMPRESAS.find(e => e.portalClientId === row.portalClientId) } : null };
    if (name === "mensagemWhatsapp" || name === "acaoPendenteWhatsapp") return { ...row, conversa: rows.conversaWhatsapp.find(c => c.id === row.conversaId) || null };
    return row;
  };
  const client = { rows, hooks };
  for (const name of Object.keys(rows)) {
    const normalizarWhere = where => where?.canal_telefoneE164 || where || {};
    const encontrar = where => rows[name].find(row => casa(expandir(name, row), normalizarWhere(where)));
    const criar = async data => {
      const row = atribuir({ id: `${name}-${++sequencia}`, ...defaults(name) }, data);
      if (name === "resolucaoContextoWhatsapp" && rows[name].some(v => v.mensagemId === row.mensagemId)) throw Object.assign(new Error("unique"), { code: "P2002" });
      rows[name].push(row);
      if (name === "mensagemWhatsapp") await hooks.afterCreateMessage?.(row);
      return copy(expandir(name, row));
    };
    client[name] = {
      findUnique: jest.fn(async ({ where }) => copy(expandir(name, encontrar(where)))),
      findFirst: jest.fn(async ({ where = {} }) => copy(expandir(name, encontrar(where)))),
      findMany: jest.fn(async ({ where = {} } = {}) => rows[name].filter(row => casa(expandir(name, row), where)).map(row => copy(expandir(name, row)))),
      create: jest.fn(async ({ data }) => criar(data)),
      upsert: jest.fn(async ({ where, create, update }) => { const row = encontrar(where); return row ? copy(expandir(name, atribuir(row, update))) : criar(create); }),
      update: jest.fn(async ({ where, data }) => { const row = encontrar(where); if (!row) throw new Error(`ausente:${name}`); return copy(expandir(name, atribuir(row, data))); }),
      updateMany: jest.fn(async ({ where, data }) => { const matches = rows[name].filter(row => casa(expandir(name, row), where)); matches.forEach(row => atribuir(row, data)); return { count: matches.length }; }),
    };
  }
  client.$transaction = jest.fn(async fn => {
    const antes = copy(rows);
    try { return await fn(client); }
    catch (err) { for (const name of Object.keys(rows)) rows[name] = antes[name]; throw err; }
  });
  return client;
}

async function fixture() {
  const client = banco();
  let empresas = copy(EMPRESAS);
  let contador = 0;
  const resolverVinculo = jest.fn(async () => vinculo(empresas));
  const cloud = { enviarLista: jest.fn(async () => ({ wamid: `lista-${++contador}` })), enviarTexto: jest.fn(async () => ({ wamid: `texto-${++contador}` })) };
  const neutral = await client.conversaWhatsapp.create({ data: { id: "neutra", chaveEscopo: `sem-empresa:${TELEFONE}`, telefoneE164: TELEFONE, escopoVerificado: false } });
  const novo = async (corpo, { tipo = "text", interacao = null, agora = new Date(), id = `entrada-${++contador}`, respostaAProviderMessageId = null } = {}) => {
    const mensagem = await client.mensagemWhatsapp.create({ data: { id, conversaId: neutral.id, tipo, direcao: "in", corpo, registradaEm: agora, ocorridaEmProvedor: agora, providerMessageId: `wamid-${id}`, respostaAProviderMessageId } });
    const conversa = await client.conversaWhatsapp.findUnique({ where: { id: neutral.id } });
    return { registro: { conversa, mensagem, vinculo: vinculo(empresas), duplicada: false }, item: { tipo, corpo, interacao }, agora };
  };
  const processar = jest.fn(async (registro, item) => ({ processado: true, empresa: registro.conversa.portalClientId, texto: item.corpo }));
  const rodar = (entrada, over = {}) => atenderContextoResponsavel({ ...entrada, client, cloud, resolverVinculo, processar, flag: true, piloto: EMPRESAS.map(e => e.portalClientId), telefonesPiloto: [], conferirJanela: async () => ({ situacao: "ABERTA" }), log, ...over });
  const atendimento = () => client.rows.atendimentoResponsavelWhatsapp[0];
  const botao = companyId => cloud.enviarLista.mock.calls.at(-1)[0].linhas.find(l => l.id.endsWith(`.${companyId}`)).id;
  const selecionar = async (texto = "emitir nota", company = "klaus") => {
    await rodar(await novo(texto));
    jest.setSystemTime(new Date(Date.now() + 1000));
    const entrada = await novo(company, { tipo: "interactive", interacao: { id: botao(company) } });
    await rodar(entrada); return entrada;
  };
  return { client, resolverVinculo, cloud, novo, rodar, processar, atendimento, botao, selecionar, setEmpresas: value => { empresas = copy(value); } };
}

beforeEach(() => { jest.useFakeTimers({ now: AGORA, doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] }); jest.clearAllMocks(); __limparLeases(); });
afterEach(() => { jest.useRealTimers(); __limparLeases(); });

it("retoma pedido com campos após botão e preserva mensagem original interativa", async () => {
  const f = await fixture(), pedido = "emitir nota\nvalor: 150,00\nserviço: Consulta";
  const entrada = await f.selecionar(pedido);
  const [registro, item] = f.processar.mock.calls.at(-1);
  expect(registro.conversa.portalClientId).toBe("klaus"); expect(registro.mensagem).toMatchObject({ corpo: pedido, tipo: "text" });
  expect(item).toMatchObject({ corpo: pedido, tipo: "text", interacao: null });
  expect(f.client.rows.mensagemWhatsapp.find(m => m.id === entrada.registro.mensagem.id)).toMatchObject({ conversaId: "neutra", corpo: "klaus", tipo: "interactive" });
  const resolvida = await carregarMensagemResolvida({ conversa: registro.conversa, mensagemId: registro.mensagem.id, client: f.client });
  expect(resolvida.mensagem).toMatchObject({ corpo: pedido, tipo: "text", conversaId: registro.conversa.id });
});

it("restaura a função original quando primeiro clique precede seleção empresarial", async () => {
  const f = await fixture(), original = { id: "altan.client.nfse.issue.v1" };
  await f.rodar(await f.novo("Emitir NFS-e", { tipo: "interactive", interacao: original }));
  jest.setSystemTime(new Date(Date.now() + 1000));
  await f.rodar(await f.novo("Klaus", { tipo: "interactive", interacao: { id: f.botao("klaus") } }));
  expect(f.processar.mock.calls.at(-1)[1]).toMatchObject({ tipo: "interactive", interacao: original });
});

it.each(["emitir pela Klaus para a Lente", "emitir uma nota pela Klaus para a Lente"])("fixa emissora e intenção guiada em %s", async texto => {
  const f = await fixture();
  await f.rodar(await f.novo(texto));
  const [registro, item] = f.processar.mock.calls.at(-1);
  expect(registro.conversa.portalClientId).toBe("klaus");
  expect(registro.contexto.resultado.acaoOperacao).toBe("EMISSAO");
  expect(item.corpo).toContain("para a Lente");
  expect(item.corpo).not.toContain("pela Klaus");
});

it.each([false, true])("mantém o lease até processar terminar, inclusive rejeição=%s", async rejeita => {
  const f = await fixture(); await f.selecionar();
  jest.setSystemTime(new Date(Date.now() + 1000));
  const entrou = sinal(), terminar = sinal();
  const trabalho = jest.fn(async (_r, _i, lease) => { await lease.conferirLease(); entrou.resolve(); await terminar.promise; await lease.conferirLease(); if (rejeita) throw new Error("falha controlada"); return { ok: true }; });
  const entrada = await f.novo("continuar");
  const p = f.rodar(entrada, { processar: trabalho });
  const observada = p.then(value => ({ value }), error => ({ error }));
  await entrou.promise;
  const liberacoes = liberarLease.mock.calls.length;
  await expect(f.rodar(await f.novo("outra entrada"))).rejects.toMatchObject({ codigo: "FIO_OCUPADO" });
  expect(liberarLease.mock.calls.length).toBe(liberacoes);
  terminar.resolve(); const resultado = await observada;
  if (rejeita) expect(resultado.error.message).toBe("falha controlada"); else expect(resultado.value).toEqual({ ok: true });
  expect(liberarLease.mock.calls.length).toBe(liberacoes + 1);
  const lock = await adquirirLease(`responsavel:${f.atendimento().id}`, { client: f.client }); expect(lock).toBeTruthy(); await liberarLease(lock);
});

it.each(["CONFIRMAR A7K2", "CANCELAR PEDIDO"])("preserva %s somente no contexto vigente", async codigo => {
  const f = await fixture(); await f.selecionar();
  jest.setSystemTime(new Date(Date.now() + 1000));
  const e = await f.novo(codigo); await f.rodar(e);
  expect(f.processar.mock.calls.at(-1)[1].corpo).toBe(codigo);
  expect(f.client.rows.resolucaoContextoWhatsapp.find(r => r.mensagemId === e.registro.mensagem.id).texto).toBe(codigo);
});

it("confirmação depois de 30 minutos pede empresa e nunca reproduz código ao escolher", async () => {
  const f = await fixture(); await f.selecionar();
  jest.setSystemTime(new Date(Date.now() + 31 * 60000));
  const n = f.processar.mock.calls.length;
  await f.rodar(await f.novo("CONFIRMAR A7K2"));
  expect(f.processar).toHaveBeenCalledTimes(n); expect(f.atendimento().pedidoPendente).toBeNull();
  jest.setSystemTime(new Date(Date.now() + 1000));
  await f.rodar(await f.novo("1"));
  expect(f.processar.mock.calls.at(-1)[1].corpo).not.toContain("CONFIRMAR");
});

it("fora do piloto não cria atendimento, recibo, CAS, rascunho nem handoff", async () => {
  const f = await fixture(), e = await f.novo("emitir nota");
  const antes = copy(f.client.rows);
  await f.rodar(e, { piloto: [], telefonesPiloto: [] });
  expect(f.client.rows).toEqual(antes); expect(f.client.atendimentoResponsavelWhatsapp.upsert).not.toHaveBeenCalled();
  expect(f.client.atendimentoResponsavelWhatsapp.updateMany).not.toHaveBeenCalled(); expect(f.client.$transaction).not.toHaveBeenCalled();
  expect(adquirirLease).not.toHaveBeenCalled(); expect(f.cloud.enviarLista).not.toHaveBeenCalled(); expect(f.processar).toHaveBeenCalledTimes(1);
});

it("empresa oferecida fora do piloto encaminha o responsável e dá resposta explícita", async () => {
  const f = await fixture(); await f.rodar(await f.novo("manda a guia"), { piloto: ["klaus"] });
  jest.setSystemTime(new Date(Date.now() + 1000));
  const r = await f.rodar(await f.novo("Lente", { tipo: "interactive", interacao: { id: f.botao("lente") } }), { piloto: ["klaus"] });
  expect(r.motivo).toBe("EMPRESA_ATENDIMENTO_HUMANO"); expect(f.processar).not.toHaveBeenCalled();
  expect(+f.atendimento().atendidaDesde).toBe(Date.now());
  expect(f.client.rows.conversaWhatsapp.every(c => ehData(c.atendidaDesde))).toBe(true);
  expect(f.cloud.enviarTexto.mock.calls[0][0].texto).toContain("Lente sintética");
  expect(f.cloud.enviarTexto.mock.calls[0][0].texto).toContain("não está habilitado");
});

it.each([false, true])("pedido humano funciona sem seleção prévia e durante seletor=%s", async durante => {
  const f = await fixture();
  if (durante) { await f.rodar(await f.novo("emitir nota")); jest.setSystemTime(new Date(Date.now() + 1000)); }
  await f.rodar(await f.novo("quero falar com contador"));
  expect(f.processar).not.toHaveBeenCalled(); expect(+f.atendimento().atendidaDesde).toBe(Date.now());
  expect(f.cloud.enviarTexto.mock.calls.at(-1)[0].texto).toMatch(/Encaminhei.*equipe/);
  expect(f.client.rows.conversaWhatsapp.every(c => ehData(c.atendidaDesde))).toBe(true);
});

it.each(["revogado", "corte", "excluido"])("mudança %s entre recibo e saída impede envio do seletor", async mudanca => {
  const f = await fixture();
  f.client.hooks.afterCreateMessage = async m => {
    if (m.direcao !== "out") return;
    if (mudanca === "revogado") f.setEmpresas([]);
    else { const c = f.client.rows.conversaWhatsapp.find(v => v.id === m.conversaId); c[mudanca === "corte" ? "automacaoInvalidadaEm" : "excluidaEm"] = new Date(); }
  };
  await expect(f.rodar(await f.novo("emitir nota"))).rejects.toMatchObject({ codigo: mudanca === "revogado" ? "ACESSO_REVOGADO" : "AUTOMACAO_INVALIDADA" });
  expect(f.cloud.enviarLista).not.toHaveBeenCalled(); expect(f.cloud.enviarTexto).not.toHaveBeenCalled();
});

it("revogação total de responsável conhecido bloqueia com handoff, sem virar lead", async () => {
  const f = await fixture(); await f.selecionar(); f.setEmpresas([]);
  jest.setSystemTime(new Date(Date.now() + 1000)); const chamadas = f.processar.mock.calls.length;
  await f.rodar(await f.novo("preciso de uma guia"));
  expect(f.processar).toHaveBeenCalledTimes(chamadas); expect(+f.atendimento().atendidaDesde).toBe(Date.now());
  expect(f.cloud.enviarTexto.mock.calls.at(-1)[0].texto).toContain("conferência de acesso");
});

it("coleta expirada preserva campo e rascunho para retomada com nova versão", async () => {
  const f = await fixture(); await f.selecionar(); const conversaId = f.atendimento().conversaId;
  await f.client.rascunhoEmissaoWhatsapp.create({ data: { id: "draft", conversaId, versao: 3, expiraEm: new Date(+AGORA + 86400000), estado: { status: "COLETANDO", etapa: "VALOR", dados: { descricao: "Consulta", tomadorDoc: "52998224725" }, codigo: "A7K2" } } });
  await f.client.acaoPendenteWhatsapp.create({ data: { id: "acao", conversaId, atendimentoId: f.atendimento().id, status: "pendente" } });
  jest.setSystemTime(new Date(Date.now() + 31 * 60000));
  await f.rodar(await f.novo("150,00"));
  expect(f.atendimento()).toMatchObject({ aguardandoSelecao: true, pedidoPendente: "150,00", coletaPendenteConversaId: conversaId });
  expect(f.client.rows.rascunhoEmissaoWhatsapp[0]).toMatchObject({ versao: 4, estado: { status: "PAUSADO", dados: { descricao: "Consulta" } } });
  expect(f.client.rows.rascunhoEmissaoWhatsapp[0].estado.codigo).toBeUndefined(); expect(f.client.rows.acaoPendenteWhatsapp[0].status).toBe("cancelada");
  jest.setSystemTime(new Date(Date.now() + 1000)); await f.rodar(await f.novo("1"));
  const [registro, item] = f.processar.mock.calls.at(-1);
  expect(item.corpo).toBe("retomar emissão"); expect(registro.contexto.resultado).toEqual({ retomarColeta: true, textoRetomada: "150,00" });
  expect(registro.contexto.conversaId).toBe(conversaId); expect(f.atendimento().coletaPendenteConversaId).toBeNull();
});

it("escolher outra empresa após expiração não transporta o campo da coleta anterior", async () => {
  const f = await fixture(); await f.selecionar();
  await f.client.rascunhoEmissaoWhatsapp.create({ data: { id: "draft", conversaId: f.atendimento().conversaId, versao: 1, expiraEm: new Date(+AGORA + 86400000), estado: { status: "COLETANDO", dados: {} } } });
  jest.setSystemTime(new Date(Date.now() + 31 * 60000)); await f.rodar(await f.novo("52998224725"));
  jest.setSystemTime(new Date(Date.now() + 1000)); await f.rodar(await f.novo("2"));
  const [registro, item] = f.processar.mock.calls.at(-1);
  expect(registro.contexto.portalClientId).toBe("lente"); expect(item.corpo).toBe("menu"); expect(JSON.stringify(registro.contexto)).not.toContain("52998224725");
});

it("recibo sobrevive a nova execução do wrapper sem criar segunda saída de seleção", async () => {
  const f = await fixture(), entrada = await f.novo("emitir nota");
  await f.rodar(entrada); const quantidade = f.client.rows.resolucaoContextoWhatsapp.length;
  await f.rodar({ ...entrada, registro: { ...entrada.registro, duplicada: true } });
  expect(f.client.rows.resolucaoContextoWhatsapp).toHaveLength(quantidade); expect(f.cloud.enviarLista).toHaveBeenCalledTimes(1);
});

it("mesmo instante e processamento invertido recusam mensagem antiga antes de trocar empresa", async () => {
  const f = await fixture(); await f.selecionar();
  jest.setSystemTime(new Date(Date.now() + 1000));
  const velha = await f.novo("guia da Lente", { id: "m-a" }), nova = await f.novo("guia da Klaus", { id: "m-z" });
  await f.rodar(nova); const antes = copy(f.atendimento());
  const r = await f.rodar(velha);
  expect(r.motivo).toBe("CONTEXTO_FORA_DE_ORDEM"); expect(f.atendimento()).toEqual(antes);
});

it("uma mensagem citada comprovada escolhe a empresa do documento, sem inferir pelo texto", async () => {
  const f = await fixture(); await f.selecionar();
  const lente = f.client.rows.conversaWhatsapp.find(c => c.portalClientId === "lente");
  await f.client.mensagemWhatsapp.create({ data: { conversaId: lente.id, direcao: "out", tipo: "document", providerMessageId: "wamid-guia", envioGuiaId: "guia-lente", corpo: "Guia Lente" } });
  jest.setSystemTime(new Date(Date.now() + 1000));
  await f.rodar(await f.novo("essa guia", { respostaAProviderMessageId: "wamid-guia" }));
  expect(f.processar.mock.calls.at(-1)[0].conversa.portalClientId).toBe("lente");
});

it("guarda real recusa recibo antigo depois de voltar à mesma empresa", async () => {
  const f = await fixture(); const primeira = await f.selecionar();
  const [registro] = f.processar.mock.calls.at(-1);
  jest.setSystemTime(new Date(Date.now() + 1000)); await f.rodar(await f.novo("trocar para Lente"));
  jest.setSystemTime(new Date(Date.now() + 1000)); await f.rodar(await f.novo("trocar para Klaus"));
  await expect(conferirContextoResponsavel({ conversa: registro.conversa, mensagem: primeira.registro.mensagem, contexto: registro.contexto, client: f.client, resolverVinculo: f.resolverVinculo })).rejects.toMatchObject({ codigo: "CONTEXTO_ALTERADO" });
});
