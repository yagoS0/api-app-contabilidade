// A REGRA DO DANFSe NA TELA DO CLIENTE — quando o botão pode, e o que cada recusa diz.
//
// ⚠ ESTE MÓDULO É O GÊMEO DE `apps/web/src/features/notas/lib/danfseDaNota.js`, e os dois divergem
// de propósito: o contrato do CLIENTE (`serializeInvoice`, `apps/api/src/routes/portalInvoices.js`)
// **não traz `chaveAcesso`** — traz `type`, `hasXml` e `confirmadaPeloAdn`. Copiar a versão do
// escritório sem olhar faria a regra ler um campo que nunca chega.

import {
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

  test("⚠ emitida por nós e ainda não confirmada pelo ADN: não pode", () => {
    // O id dela é um `ServiceInvoice.id` e a rota lê `PortalInvoice` — pedir o PDF devolveria 404.
    const r = podeGerarDanfse(nota({ confirmadaPeloAdn: false, hasXml: false }));
    expect(r.motivo).toBe(MOTIVO_SEM_DANFSE.NAO_CONFIRMADA);
  });

  test("⚠ a NÃO CONFIRMAÇÃO vence a falta de XML — o motivo certo é o mais informativo dos dois", () => {
    const r = podeGerarDanfse(nota({ confirmadaPeloAdn: false, hasXml: false }));
    expect(r.motivo).toBe(MOTIVO_SEM_DANFSE.NAO_CONFIRMADA);
    expect(r.texto).not.toMatch(/não guardamos o XML/i);
  });

  test("⚠ `undefined` (contrato antigo, ou o app mobile) é lido como CONFIRMADA, não como falsa", () => {
    const { confirmadaPeloAdn, ...semOCampo } = nota();
    expect(podeGerarDanfse(semOCampo).pode).toBe(true);
  });

  test("nota que ainda não carregou: não pode, e diz isso", () => {
    expect(podeGerarDanfse(null)).toMatchObject({ pode: false });
  });

  test("⚠ TODO motivo tem `resumo` curto — é ele que a tabela mostra ao lado do botão desabilitado", () => {
    for (const patch of [{ type: "NFE" }, { hasXml: false }, { confirmadaPeloAdn: false }]) {
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
