// A REGRA DO DANFSe NA TELA DO CLIENTE — quando o botão pode, e o que cada recusa diz.
//
// ⚠ ESTE MÓDULO É O GÊMEO DE `apps/web/src/features/notas/lib/danfseDaNota.js`, e os dois divergem
// de propósito: o contrato do CLIENTE (`serializeInvoice`, `apps/api/src/routes/portalInvoices.js`)
// **não traz `chaveAcesso`** — traz `type`, `hasXml` e `confirmadaPeloAdn`. Copiar a versão do
// escritório sem olhar faria a regra ler um campo que nunca chega.

import {
  podeEntrarNoLoteDeDanfse,
  MOTIVO_SEM_DANFSE,
  lerRecusaDanfse,
  nomeDoArquivoDanfse,
  podeGerarDanfse,
} from "../danfseDaNota";

function nota(patch = {}) {
  return { invoiceId: "inv-1", type: "NFSE", numero: "13000", hasXml: true, confirmadaPeloAdn: true, ...patch };
}

describe("podeGerarDanfse", () => {
  test("NFS-e confirmada e com XML: pode", () => {
    expect(podeGerarDanfse(nota())).toMatchObject({ pode: true, motivo: null });
  });

  test("NF-e: não pode — o documento auxiliar dela é o DANFE, que este portal não gera", () => {
    const r = podeGerarDanfse(nota({ type: "NFE" }));
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(MOTIVO_SEM_DANFSE.NAO_E_NFSE);
    expect(r.texto).toMatch(/NF-e/);
  });

  test("sem XML guardado: não pode, e o texto diz que o DANFSe SAI do XML (nada é inventado)", () => {
    const r = podeGerarDanfse(nota({ hasXml: false }));
    expect(r.motivo).toBe(MOTIVO_SEM_DANFSE.SEM_XML);
    expect(r.texto).toMatch(/inventado/i);
  });

  /**
   * ⚠⚠ ESTE PAR DE CASOS VIROU O CONTRÁRIO EM 31/08/2026 — e o que caiu foi a PREMISSA, não a regra.
   *
   * Eles diziam *"não pode: o id dela é um `ServiceInvoice.id` e a rota lê `PortalInvoice`, pedir o
   * PDF devolveria 404"*. Isso era verdade em 19/08. Em **24/08** a rota passou a ler dos dois
   * lados, a pedido do dono; a tela não voltou aqui, e em 31/08 ele veio cobrar: *"ao emitir a nota
   * não consigo baixar a danfe, o que também deveríamos conseguir de imediato."*
   *
   * ⚠⚠ E o `hasXml: false` destas notas NÃO é uma segunda razão para recusar: ele é cravado por
   * `serializeEmitidaNaoConfirmada`, cujo próprio comentário diz que significa *"não há rota que o
   * sirva por este id"* — a rota do XML. O XML existe, em `ServiceInvoice.xml`, e o DANFSe sai dele.
   */
  test("⚠⚠ emitida por nós e AINDA NÃO confirmada pelo ADN: PODE — o servidor lê do outro lado", () => {
    const r = podeGerarDanfse(nota({ confirmadaPeloAdn: false, hasXml: false }));
    expect(r.pode).toBe(true);
    expect(r.motivo).toBeNull();
  });

  test("⚠⚠ e o `hasXml: false` dela NÃO barra — ele descreve a rota do XML, não a do DANFSe", () => {
    // Se o XML de lá não servir (a nota recusada guarda a DPS), quem recusa é o SERVIDOR, nomeado.
    expect(podeGerarDanfse(nota({ confirmadaPeloAdn: false, hasXml: false })).pode).toBe(true);
    // ⚠ Mas na nota JÁ CONFIRMADA o `hasXml` continua valendo: ali ele significa mesmo "não há XML".
    expect(podeGerarDanfse(nota({ confirmadaPeloAdn: true, hasXml: false })).motivo)
      .toBe(MOTIVO_SEM_DANFSE.SEM_XML);
  });

  test("⚠ `undefined` (contrato antigo, ou o app mobile) é lido como CONFIRMADA, não como falsa", () => {
    const { confirmadaPeloAdn, ...semOCampo } = nota();
    expect(podeGerarDanfse(semOCampo).pode).toBe(true);
  });

  test("nota que ainda não carregou: não pode, e diz isso", () => {
    expect(podeGerarDanfse(null)).toMatchObject({ pode: false });
  });

  test("⚠ TODO motivo tem `resumo` curto — é ele que a tabela mostra ao lado do botão desabilitado", () => {
    // ⚠ `confirmadaPeloAdn: false` SAIU desta lista em 31/08/2026: ela deixou de ser uma recusa —
    // a nota recém-emitida PODE gerar DANFSe. Ver o par de casos lá em cima.
    for (const patch of [{ type: "NFE" }, { hasXml: false }]) {
      const r = podeGerarDanfse(nota(patch));
      expect(r.pode).toBe(false);
      expect(String(r.resumo || "").length).toBeGreaterThan(0);
      expect(String(r.resumo).length).toBeLessThan(40);
    }
  });
});

describe("⚠⚠ lerRecusaDanfse — a mensagem do SERVIDOR vence", () => {
  test("`danfse_sem_qrcode` traz o PORQUÊ, e ele não é 'tente de novo'", () => {
    const r = lerRecusaDanfse({ code: "danfse_sem_qrcode", message: "A chave não está no XML.", motivo: "chave_ausente" });
    expect(r.texto).toBe("A chave não está no XML.");
    expect(r.porQue).toMatch(/Um DANFSe sem QR Code não é um DANFSe/);
    expect(r.porQue).not.toMatch(/tente de novo/i);
    expect(r.motivo).toBe("chave_ausente");
  });

  test("o `motivo` também é lido de dentro do corpo (`ApiError.corpo`)", () => {
    const r = lerRecusaDanfse({ code: "danfse_sem_qrcode", corpo: { motivo: "qrcode_falhou" } });
    expect(r.motivo).toBe("qrcode_falhou");
  });

  test("sem mensagem do servidor, entra um texto nosso — nunca uma tela em branco", () => {
    const r = lerRecusaDanfse({ code: "danfse_sem_qrcode" });
    expect(String(r.texto).length).toBeGreaterThan(0);
  });

  test.each([
    ["xml_indisponivel", /XML/i],
    ["xml_nao_e_nfse", /NFS-e/i],
    ["nota_nao_encontrada", /não foi encontrada|não encontrada/i],
  ])("`%s` tem título e texto próprios", (code, esperado) => {
    const r = lerRecusaDanfse({ code });
    expect(r.codigo).toBe(code);
    expect(`${r.titulo} ${r.texto}`).toMatch(esperado);
  });

  test("⚠ código DESCONHECIDO não ganha procedimento fabricado", () => {
    const r = lerRecusaDanfse({ code: "algo_novo_que_esta_tela_nao_conhece" });
    expect(r.porQue).toBeNull();
    expect(`${r.titulo} ${r.texto}`).not.toMatch(/tente de novo|aguarde|recarregue/i);
  });

  test("erro de rede (sem `code`) ainda produz um título legível", () => {
    const r = lerRecusaDanfse(new Error("network_error"));
    expect(r.titulo).toMatch(/O DANFSe não foi gerado/);
  });
});

describe("nomeDoArquivoDanfse", () => {
  test("usa o NÚMERO da nota (o contrato do cliente não traz a chave)", () => {
    expect(nomeDoArquivoDanfse(nota({ numero: "13000" }))).toBe("danfse-13000.pdf");
  });

  test("sem número, cai no id — e nunca sai sem nome", () => {
    expect(nomeDoArquivoDanfse(nota({ numero: null, invoiceId: "inv-9" }))).toBe("danfse-inv-9.pdf");
    expect(nomeDoArquivoDanfse(null)).toBe("danfse-nota.pdf");
  });

  test("caracteres fora de `[\\w.-]` são removidos — o mesmo corte do `Content-Disposition`", () => {
    expect(nomeDoArquivoDanfse(nota({ numero: "13/000 A" }))).toBe("danfse-13000A.pdf");
  });
});

// ⚠⚠ AS DUAS PORTAS DO DANFSe NÃO ALCANÇAM A MESMA POPULAÇÃO (31/08/2026)
//
// Achado por teste de usabilidade no navegador, no MESMO dia em que a causa foi introduzida: ao
// liberar o DANFSe da nota ainda não confirmada, ela passou a ser MARCÁVEL na seleção da página —
// e o zip do lote (que filtra `PortalInvoice`) vinha SEM ela. "Baixar 3 DANFSe" entregava 2, e a
// ausente só aparecia abrindo o `RELATORIO.txt` lá dentro.
//
// ⚠ `selecaoDeNotas.js` afirma por escrito que no escopo PÁGINA *"o que não gera nem pode ser
// marcado: 'Baixar 3 DANFSe' é uma promessa que se cumpre"*. Este bloco é o que a mantém verdadeira.
describe("⚠⚠ podeEntrarNoLoteDeDanfse — mais estrita que a porta individual", () => {
  it("⚠⚠ a nota AINDA NÃO CONFIRMADA pode individualmente, mas NÃO entra no lote", () => {
    const naoConfirmada = nota({ confirmadaPeloAdn: false, hasXml: false });
    // A porta individual acha `ServiceInvoice` desde 24/08 — este ramo continua liberado.
    expect(podeGerarDanfse(naoConfirmada).pode).toBe(true);
    // A do lote filtra `PortalInvoice`, onde ela ainda não está.
    expect(podeEntrarNoLoteDeDanfse(naoConfirmada)).toBe(false);
  });

  it("a nota confirmada e com XML entra no lote", () => {
    expect(podeEntrarNoLoteDeDanfse(nota())).toBe(true);
  });

  it("⚠ o que já não gera DANFSe também não entra — a segunda pergunta não afrouxa a primeira", () => {
    expect(podeEntrarNoLoteDeDanfse(nota({ type: "NFE" }))).toBe(false);
    expect(podeEntrarNoLoteDeDanfse(nota({ hasXml: false }))).toBe(false);
    expect(podeEntrarNoLoteDeDanfse(null)).toBe(false);
  });

  it("⚠ `undefined` continua sendo lido como CONFIRMADA — contrato antigo e app mobile", () => {
    const { confirmadaPeloAdn, ...semOCampo } = nota();
    expect(podeEntrarNoLoteDeDanfse(semOCampo)).toBe(true);
  });
});
