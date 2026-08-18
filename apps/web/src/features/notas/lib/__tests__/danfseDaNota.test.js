// O DANFSe NA TELA — quando o botão vale, e o que a recusa diz.
//
// ⚠ A RECUSA COM QR CODE AUSENTE É O TESTE MAIS IMPORTANTE DAQUI. O backend responde 503
// `danfse_sem_qrcode` de propósito (NT 008 §2.2/§2.4.3: um DANFSe sem QR Code não é um DANFSe), e a
// tela precisa MOSTRAR isso — não uma tela em branco, não "falha ao baixar", não um PDF vazio.

import {
  MOTIVO_SEM_DANFSE,
  lerRecusaDanfse,
  nomeDoArquivoDanfse,
  podeGerarDanfse,
} from "../danfseDaNota";

const nfse = (patch = {}) => ({
  id: "nota-1", type: "NFSE", numero: "13000",
  chaveAcesso: "33045572255387580000103000000013000260889699241",
  xml: { disponivel: true, bytes: 5200, conteudo: "<NFSe/>", truncadoPorTamanho: false },
  ...patch,
});

describe("quando o DANFSe pode ser gerado", () => {
  it("NFS-e com XML guardado pode", () => {
    expect(podeGerarDanfse(nfse()).pode).toBe(true);
  });

  // 29 de 29 NF-e da base não têm `xmlRaw`, e o documento auxiliar delas nem é o DANFSe.
  it("NF-e não pode, e o motivo é o DOCUMENTO, não a falta do arquivo", () => {
    const r = podeGerarDanfse(nfse({ type: "NFE", xml: { disponivel: false } }));
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(MOTIVO_SEM_DANFSE.NAO_E_NFSE);
    expect(r.texto).toMatch(/DANFE/);
  });

  it("NFS-e sem XML não pode, e a tela diz o que fazer (recapturar)", () => {
    const r = podeGerarDanfse(nfse({ xml: { disponivel: false, bytes: null, conteudo: null } }));
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(MOTIVO_SEM_DANFSE.SEM_XML);
    expect(r.texto).toMatch(/recapture/i);
  });

  // ⚠ O XML existe no SERVIDOR; quem não o recebeu foi a tela. O PDF é gerado lá.
  it("XML grande demais para caber na resposta NÃO impede o DANFSe", () => {
    const r = podeGerarDanfse(nfse({
      xml: { disponivel: true, bytes: 2_000_000, conteudo: null, truncadoPorTamanho: true },
    }));
    expect(r.pode).toBe(true);
  });

  it("sem nota, não afirma que dá — e não estoura", () => {
    expect(podeGerarDanfse(null).pode).toBe(false);
  });
});

describe("a recusa do servidor", () => {
  it("503 sem QR Code: título próprio, o motivo do servidor e o PORQUÊ da recusa", () => {
    const err = new Error("Não foi possível gerar o QR Code obrigatório do DANFSe.");
    err.code = "danfse_sem_qrcode";
    err.status = 503;
    err.motivo = "a nota não tem chave de acesso no XML";

    const r = lerRecusaDanfse(err);
    expect(r.titulo).toMatch(/QR Code/i);
    expect(r.texto).toMatch(/QR Code obrigat/i);
    expect(r.motivo).toBe("a nota não tem chave de acesso no XML");
    expect(r.porQue).toMatch(/documento inv[áa]lido/i);
  });

  it("o `motivo` também é lido de dentro do payload (é onde `bad()` o coloca)", () => {
    const err = new Error("x");
    err.code = "danfse_sem_qrcode";
    err.payload = { motivo: "a biblioteca de QR falhou" };
    expect(lerRecusaDanfse(err).motivo).toBe("a biblioteca de QR falhou");
  });

  it("XML indisponível vira a frase da recaptura, não a do QR Code", () => {
    const err = new Error("Esta nota não tem o XML guardado.");
    err.code = "xml_indisponivel";
    const r = lerRecusaDanfse(err);
    expect(r.titulo).toMatch(/XML/i);
    expect(r.porQue).toMatch(/recapture/i);
  });

  // Mesma regra de `rejeicaoDaEmissao.js`: código nunca visto não ganha procedimento inventado.
  it("recusa desconhecida NÃO ganha um 'tente de novo' fabricado", () => {
    const err = new Error("erro estranho do servidor");
    err.code = "coisa_nova";
    const r = lerRecusaDanfse(err);
    expect(r.texto).toBe("erro estranho do servidor");
    expect(r.porQue).toBeNull();
  });

  it("sem mensagem nenhuma, diz que o servidor não explicou — em vez de calar", () => {
    const r = lerRecusaDanfse(new Error(""));
    expect(r.texto).toMatch(/n[ãa]o disse por qu/i);
  });
});

describe("o nome do arquivo espelha o Content-Disposition da rota", () => {
  it("usa a chave quando existe, sem caracteres fora de [\\w.-]", () => {
    expect(nomeDoArquivoDanfse(nfse())).toBe(
      "danfse-33045572255387580000103000000013000260889699241.pdf",
    );
  });

  it("cai para o número e depois para o id — a NFS-e nem sempre tem chave", () => {
    expect(nomeDoArquivoDanfse(nfse({ chaveAcesso: null }))).toBe("danfse-13000.pdf");
    expect(nomeDoArquivoDanfse({ id: "abc-1", chaveAcesso: null, numero: null })).toBe("danfse-abc-1.pdf");
  });
});
