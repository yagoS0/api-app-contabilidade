jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { createHash } from "node:crypto";
import { prepararHistoricoGuia, reconciliarHistoricoGuiasWhatsapp, reconciliarTentativaGuia, salvarArquivoManual,
  cartaoGuiaParaTela, enriquecerMensagensWhatsapp, obterArquivoDaMensagem, resumoMensagemHistorico } from "../HistoricoArquivoWhatsappService.js";

const PDF = Buffer.from("%PDF-1.4 versao original");
const hash = b => createHash("sha256").update(b).digest("hex");
const DATA = new Date("2026-09-25T12:00:00Z");
const conversa = { id: "conv1", portalClientId: "emp1", escopoVerificado: true, vinculoNumeroId: "v1", canalId: "principal" };
const guide = { id: "g1", portalClientId: "emp1", tipo: "SIMPLES", competencia: "2026-08", valor: "123.45", vencimento: new Date("2026-09-21Z"), portalClient: { razao: "Empresa Teste", cnpj: "11222333000181" } };
const preparo = { tentativaId: "t1", envioGuiaId: "e1", guide, conversa, contato: { telefoneE164: "5521999999999" },
  canal: { nomeMeta: "guia_disponivel", idioma: "pt_BR" }, variaveis: ["Ana", "Simples", "Agosto/2026", "123,45", "21/09/2026"], nomeArquivo: "DAS-2026-08.pdf", conteudoPdf: PDF, tipoLabel: "Simples Nacional" };

function cenario() {
  const tentativas = new Map([["t1", { id: "t1", envioGuiaId: "e1", status: "enviando", criadoEm: DATA }]]);
  const mensagens = new Map(), arquivos = new Map(), objetos = new Map();
  const client = {
    envioGuiaTentativa: {
      findUnique: jest.fn(async ({ where }) => tentativas.get(where.id)),
      findMany: jest.fn(async ({ where }) => [...tentativas.values()].filter(t => where.id ? where.id.in.includes(t.id) : t.providerMessageId)),
      updateMany: jest.fn(async ({ where, data }) => { Object.assign(tentativas.get(where.id), data); return { count: 1 }; }),
    },
    conversaWhatsapp: { findFirst: jest.fn(async () => conversa), updateMany: jest.fn(async () => ({ count: 1 })) },
    mensagemWhatsapp: {
      upsert: jest.fn(async ({ where, update, create }) => {
        if (mensagens.has(where.id)) Object.assign(mensagens.get(where.id), update);
        else mensagens.set(where.id, { ...create });
        return mensagens.get(where.id);
      }),
      findUnique: jest.fn(async ({ where }) => [...mensagens.values()].find(m => where.id ? m.id === where.id : m.providerMessageId === where.providerMessageId)),
      findFirst: jest.fn(async ({ where }) => { const m = mensagens.get(where.id); return m && where.conversaId.in.includes(m.conversaId) ? { ...m, envioGuiaTentativa: tentativas.get(m.envioGuiaTentativaId) } : null; }),
    },
    arquivoWhatsapp: {
      upsert: jest.fn(async ({ where, create }) => { if (!arquivos.has(where.mensagemId)) arquivos.set(where.mensagemId, { id: "a1", ...create }); return arquivos.get(where.mensagemId); }),
      findUnique: jest.fn(async ({ where }) => arquivos.get(where.mensagemId)),
      findMany: jest.fn(async ({ where }) => [...arquivos.values()].filter(a => where.mensagemId.in.includes(a.mensagemId))),
    },
    envioGuia: { findMany: jest.fn(async () => [{ id: "e1", guideId: "g1", guide }]) },
  };
  const storage = { upload: jest.fn(async ({ key, buffer }) => objetos.set(key, Buffer.from(buffer))), downloadBuffer: jest.fn(async ({ key }) => objetos.get(key)) };
  return { client, storage, tentativas, mensagens, arquivos, objetos };
}
let fetchAnterior;
beforeEach(() => { fetchAnterior = globalThis.fetch; globalThis.fetch = jest.fn(() => { throw Error("Rede proibida"); }); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); globalThis.fetch = fetchAnterior; });

test("congela empresa, cinco variáveis e PDF antes do transporte; documento novo não altera o original", async () => {
  const c = cenario();
  await prepararHistoricoGuia(preparo, c);
  const t = c.tentativas.get("t1");
  expect(t.snapshot).toMatchObject({ empresa: "Empresa Teste", competencia: "2026-08", valor: "123.45", template: { variaveis: preparo.variaveis, versaoProvedor: null } });
  expect(t.arquivoSha256).toBe(hash(PDF));
  expect(c.storage.upload.mock.invocationCallOrder[0]).toBeLessThan(c.client.mensagemWhatsapp.upsert.mock.invocationCallOrder[0]);
  await expect(prepararHistoricoGuia({ ...preparo, conteudoPdf: Buffer.from("%PDF-1.4 recalculada") }, c)).rejects.toMatchObject({ code: "HISTORICO_IMUTAVEL" });
  const original = await obterArquivoDaMensagem({ mensagemId: "guia-whatsapp-t1", conversaIds: ["conv1"], mensagemIds: ["guia-whatsapp-t1"], empresasPermitidas: ["emp1"] }, c);
  expect(Buffer.from(original.base64, "base64")).toEqual(PDF);
  expect(c.storage.upload).toHaveBeenCalledTimes(1);
});

test("modelo/variáveis alterados não substituem tentativa já preparada", async () => {
  const c = cenario(); await prepararHistoricoGuia(preparo, c);
  await expect(prepararHistoricoGuia({ ...preparo, variaveis: ["outra"] }, c)).rejects.toMatchObject({ code: "HISTORICO_IMUTAVEL" });
});

test("falha de armazenamento impede reserva do balão e não chama transporte", async () => {
  const c = cenario(); c.storage.upload.mockRejectedValue(new Error("storage fora"));
  await expect(prepararHistoricoGuia(preparo, c)).rejects.toThrow("storage fora");
  expect(c.client.envioGuiaTentativa.updateMany).not.toHaveBeenCalled();
  expect(c.mensagens.size).toBe(0);
});

test("duas guias se distinguem por empresa, competência e tributo mesmo com corpo nulo", async () => {
  const c = cenario(); await prepararHistoricoGuia(preparo, c);
  const original = cartaoGuiaParaTela({ envioGuiaTentativaId: "t1" }, c.tentativas.get("t1"), { guideId: "g1", guide });
  const antiga = cartaoGuiaParaTela({ corpo: null, envioGuiaId: "e2" }, null, { guideId: "g2", status: "enviado", guide: { ...guide, tipo: "INSS", competencia: "2026-07", portalClient: { razao: "Outra Empresa" } } });
  expect(original).toMatchObject({ origem: "ORIGINAL_REGISTRADO", tipo: "Simples Nacional", empresa: "Empresa Teste", arquivo: { podeAbrir: true } });
  expect(antiga).toMatchObject({ origem: "RECUPERADO_DO_VINCULO", tipo: "INSS", empresa: "Outra Empresa", competencia: "2026-07", arquivo: { podeAbrir: false } });
  expect(antiga.aviso).toContain("não foi preservada");
});

test("aceite com escrita final falha recupera exatamente um balão por tentativa sem Meta", async () => {
  const c = cenario(); await prepararHistoricoGuia(preparo, c);
  Object.assign(c.tentativas.get("t1"), { status: "enviado", providerMessageId: "wamid1", aceitoEm: DATA });
  const upsert = c.client.mensagemWhatsapp.upsert.getMockImplementation();
  c.client.mensagemWhatsapp.upsert.mockRejectedValueOnce(new Error("banco caiu"));
  await expect(reconciliarTentativaGuia("t1", c)).rejects.toThrow("banco caiu");
  c.client.mensagemWhatsapp.upsert.mockImplementation(upsert);
  await reconciliarHistoricoGuiasWhatsapp(c); await reconciliarHistoricoGuiasWhatsapp(c);
  expect(c.mensagens.size).toBe(1);
  expect([...c.mensagens.values()][0]).toMatchObject({ providerMessageId: "wamid1", envioGuiaTentativaId: "t1" });
});

test("reconciliador recupera balão ausente a partir da tentativa original, sem guia atual", async () => {
  const c = cenario(); await prepararHistoricoGuia(preparo, c); c.mensagens.clear();
  Object.assign(c.tentativas.get("t1"), { providerMessageId: "wamid1", aceitoEm: DATA });
  await reconciliarHistoricoGuiasWhatsapp(c);
  expect([...c.mensagens.values()][0]).toMatchObject({ registradaEm: DATA, corpo: expect.stringContaining("Empresa Teste") });
});

test("resultado incerto sem identificador nunca é reconciliado como aceito", async () => {
  const c = cenario(); await prepararHistoricoGuia(preparo, c);
  expect(await reconciliarTentativaGuia("t1", c)).toEqual({ reconciliada: false });
  expect([...c.mensagens.values()][0].providerMessageId).toBeUndefined();
});

test.each([
  { conversaIds: [], mensagemIds: ["guia-whatsapp-t1"], empresasPermitidas: ["emp1"] },
  { conversaIds: ["conv1"], mensagemIds: [], empresasPermitidas: ["emp1"] },
  { conversaIds: ["outra"], mensagemIds: ["guia-whatsapp-t1"], empresasPermitidas: ["emp1"] },
  { conversaIds: ["conv1"], mensagemIds: ["guia-whatsapp-t1"], empresasPermitidas: ["outra"] },
])("arquivo fora do escopo é recusado (%j)", async escopo => {
  const c = cenario(); await prepararHistoricoGuia(preparo, c);
  await expect(obterArquivoDaMensagem({ mensagemId: "guia-whatsapp-t1", ...escopo }, c)).rejects.toMatchObject({ status: 404 });
  expect(c.storage.downloadBuffer).not.toHaveBeenCalled();
});

test("objeto adulterado é recusado pelo hash", async () => {
  const c = cenario(); await prepararHistoricoGuia(preparo, c);
  c.storage.downloadBuffer.mockResolvedValue(Buffer.from("%PDF-trocado"));
  await expect(obterArquivoDaMensagem({ mensagemId: "guia-whatsapp-t1", conversaIds: ["conv1"], mensagemIds: ["guia-whatsapp-t1"], empresasPermitidas: ["emp1"] }, c)).rejects.toMatchObject({ code: "ARQUIVO_DIVERGENTE" });
});

test("PDF/imagem manual são preservados antes da rede e o conteúdo não é sobrescrito", async () => {
  const c = cenario(), mensagem = { id: "manual", conversaId: "conv1", direcao: "out" };
  c.mensagens.set(mensagem.id, mensagem);
  await salvarArquivoManual({ mensagem, conversa, buffer: PDF, nomeArquivo: "guia.pdf", mimeType: "application/pdf" }, { ...c, agora: DATA });
  await expect(salvarArquivoManual({ mensagem, conversa, buffer: Buffer.from("%PDF-alterado"), nomeArquivo: "nova.pdf" }, c)).rejects.toMatchObject({ code: "ARQUIVO_IMUTAVEL" });
  const r = await obterArquivoDaMensagem({ mensagemId: "manual", conversaIds: ["conv1"], mensagemIds: ["manual"], empresasPermitidas: ["emp1"] }, { ...c, agora: DATA });
  expect(r.nomeArquivo).toBe("guia.pdf"); expect(Buffer.from(r.base64, "base64")).toEqual(PDF);
});

test("arquivo vinculado posteriormente a empresa fora do escopo fica inacessível", async () => {
  const c = cenario(), mensagem = { id: "manual", conversaId: "conv1", direcao: "out" }; c.mensagens.set(mensagem.id, mensagem);
  await salvarArquivoManual({ mensagem, conversa, buffer: PDF, nomeArquivo: "guia.pdf" }, { ...c, agora: DATA });
  c.arquivos.get("manual").portalClientId = "outra";
  await expect(obterArquivoDaMensagem({ mensagemId: "manual", conversaIds: ["conv1"], mensagemIds: ["manual"], empresasPermitidas: ["emp1"] }, { ...c, agora: DATA })).rejects.toMatchObject({ status: 404 });
});

test("arquivo expirado tem cartão explícito, sem botão para abrir, e download recusa", async () => {
  const c = cenario(), mensagem = { id: "manual", conversaId: "conv1", direcao: "out", tipo: "document" }; c.mensagens.set(mensagem.id, mensagem);
  await salvarArquivoManual({ mensagem, conversa, buffer: PDF, nomeArquivo: "guia.pdf" }, { ...c, agora: DATA });
  const agora = new Date("2027-02-01Z");
  const [r] = await enriquecerMensagensWhatsapp([mensagem], { ...c, agora, empresasPermitidas: ["emp1"] });
  expect(r.arquivo).toMatchObject({ estado: "EXPIRADO", podeAbrir: false, origem: "ORIGINAL_REGISTRADO" });
  await expect(obterArquivoDaMensagem({ mensagemId: "manual", conversaIds: ["conv1"], mensagemIds: ["manual"], empresasPermitidas: ["emp1"] }, { ...c, agora })).rejects.toMatchObject({ status: 410 });
});

test("anexo legado sem bytes não recebe aparência de original disponível", async () => {
  const c = cenario();
  const [r] = await enriquecerMensagensWhatsapp([{ id: "old", tipo: "image", corpo: null }], c);
  expect(r.arquivo).toMatchObject({ estado: "INDISPONIVEL", origem: "RECUPERADO_DO_VINCULO", podeAbrir: false });
});

test("arquivo atribuído a empresa fora do escopo não revela nome, tipo ou tamanho no cartão", async () => {
  const c = cenario(), mensagem = { id: "manual", conversaId: "conv1", direcao: "out", tipo: "document" };
  await salvarArquivoManual({ mensagem, conversa, buffer: PDF, nomeArquivo: "sigiloso.pdf" }, { ...c, agora: DATA });
  const [r] = await enriquecerMensagensWhatsapp([mensagem], { ...c, empresasPermitidas: ["outra"], agora: DATA });
  expect(r.arquivo).toEqual({ nomeArquivo: null, mimeType: null, tamanho: null, estado: "SEM_ACESSO", podeAbrir: false, origem: null });
});

test("prévia conserva corpo real e identifica guia antiga com origem recuperada", () => {
  expect(resumoMensagemHistorico({ corpo: "Texto original", cartaoGuia: { empresa: "empresa" } })).toBe("Texto original");
  expect(resumoMensagemHistorico({ tipo: "template", cartaoGuia: { empresa: "Empresa Teste", tipo: "DAS", competencia: "2026-08", valor: "123.45", origem: "RECUPERADO_DO_VINCULO" } }))
    .toBe("Empresa Teste · DAS · 2026-08 · R$ 123,45 (dados recuperados)");
  expect(resumoMensagemHistorico({ tipo: "document", arquivo: { estado: "SEM_ACESSO", nomeArquivo: null } })).toBe("Documento");
});


test("reconciliação só reabre lixeira anterior ao aceite, nunca exclusão posterior", async () => {
  const c = cenario(); await prepararHistoricoGuia(preparo, c);
  const atual = { ...conversa, excluidaEm: new Date(DATA.getTime() - 1000) };
  c.client.conversaWhatsapp.findFirst.mockResolvedValue(atual);
  c.client.conversaWhatsapp.updateMany.mockImplementation(async ({ where, data }) => {
    if (!atual.excluidaEm || atual.excluidaEm > where.excluidaEm.lte) return { count: 0 };
    Object.assign(atual, data); return { count: 1 };
  });
  Object.assign(c.tentativas.get("t1"), { providerMessageId: "wamid1", aceitoEm: DATA });
  await reconciliarTentativaGuia("t1", c);
  expect(atual.excluidaEm).toBeNull();
  const exclusaoPosterior = new Date(DATA.getTime() + 1000);
  atual.excluidaEm = exclusaoPosterior;
  await reconciliarTentativaGuia("t1", c);
  expect(atual.excluidaEm).toBe(exclusaoPosterior);
  expect(c.mensagens.size).toBe(1);
});
