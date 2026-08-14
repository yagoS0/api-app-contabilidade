// O DANFSe SÓ PODE DIZER O QUE O XML DIZ — E PRECISA DIZER TUDO EM UMA PÁGINA.
//
// ⚠ POR QUE ESTE TESTE EXISTE
//   • A API oficial que gerava o DANFSe (`adn.nfse.gov.br/danfse`) foi SOBRESTADA em 03/08/2026, e
//     a NT 008 diz que é por isso: o documento passou a ser responsabilidade do emissor. Sem PDF, o
//     cliente não tem o que mandar ao tomador.
//   • Res. CGNFS-e nº 3/2023, art. 13 (repetido na NT §2.1): o DANFSe "não poderá conter
//     informações que não existam no arquivo XML". Um teste que só verifica "não lançou exceção"
//     não prova layout nenhum — por isso aqui se lê o PDF GERADO de volta, com posições.

import fs from "node:fs";
import path from "node:path";
import pdfParse from "pdf-parse";
import { gerarDanfse } from "../gerarDanfse.js";
import { lerNfse } from "../danfseDados.js";
import { truncarComReticencias, urlDeConsulta, cm } from "../danfseLeiaute.js";

// ⚠ A FIXTURE É A AMOSTRA VERSIONADA, NÃO UMA CÓPIA COLADA AQUI. `docs/leiaute-nfse/` é a fonte, e
// duplicar o XML no teste faria a amostra e o teste divergirem na primeira correção de leiaute.
// (`import.meta.url` não serve: o jest deste projeto transpila para CJS.)
const RELATIVO = "docs/leiaute-nfse/nfse-nacional-substituicao.xml";
function acharFixture() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const tentativa = path.join(dir, RELATIVO);
    if (fs.existsSync(tentativa)) return tentativa;
    dir = path.dirname(dir);
  }
  throw new Error(`Amostra de NFS-e não encontrada a partir de ${process.cwd()} (${RELATIVO}).`);
}

const xmlBase = fs.readFileSync(acharFixture(), "utf8");
const semQrOk = { permitirSemQrCode: true };

/**
 * Extrai o TEXTO do PDF gerado — é isto que transforma "gerou" em "gerou o quê".
 *
 * ⚠ Não dá para procurar a frase nos bytes crus: o pdfkit comprime os content streams
 * (FlateDecode), então `pdf.toString()` não contém o texto impresso. Um teste escrito assim passa
 * no `not.toContain` por engano e falha no `toContain` — foi exatamente o que aconteceu aqui.
 * `pdf-parse` já é dependência do projeto (é o que lê o relatório do SITFIS).
 */
async function textoDoPdf(pdf) {
  const { text } = await pdfParse(pdf);
  return text;
}

describe("entrada: é a NFS-e, não a DPS", () => {
  it("recusa XML sem `infNFSe` — uma DPS ou um evento não geram DANFSe", async () => {
    const dps = '<?xml version="1.0"?><DPS versao="1.01"><infDPS Id="DPS1"><tpAmb>1</tpAmb></infDPS></DPS>';
    await expect(gerarDanfse({ xml: dps, ...semQrOk })).rejects.toMatchObject({
      code: "DANFSE_XML_NAO_E_NFSE",
    });
  });

  it("recusa XML vazio", async () => {
    await expect(gerarDanfse({ xml: "", ...semQrOk })).rejects.toMatchObject({ code: "DANFSE_XML_VAZIO" });
  });
});

describe("QR Code — obrigatório (NT §2.2 e §2.4.3), e o projeto não tem biblioteca", () => {
  it("sem imagem de QR e sem escape explícito, RECUSA gerar", async () => {
    await expect(gerarDanfse({ xml: xmlBase })).rejects.toMatchObject({ code: "DANFSE_SEM_QRCODE" });
  });

  it("com o escape, gera — mas reporta a dependência faltante e o conteúdo que o QR levaria", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase, ...semQrOk });
    expect(conformidade.qrCode).toBe("ausente");
    expect(conformidade.dependenciaFaltante).not.toBeNull();
    // §2.4.3 — a URL é fixa e a chave entra depois do "=".
    expect(conformidade.conteudoDoQrCode).toBe(
      "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=33045572200000000000191000000000001826011111111110"
    );
  });

  it("urlDeConsulta usa a chave só com dígitos", () => {
    expect(urlDeConsulta("NFS 3304 5572")).toBe("https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=33045572");
    expect(urlDeConsulta("")).toBeNull();
  });
});

describe("a leitura é POR CAMINHO — o mesmo nome de tag existe em vários grupos", () => {
  // ⚠ Esta é a armadilha que `getTextByLocalNames` (utils/xml.js) cairia: `CNPJ` aparece em
  // `emit`, `prest` e `toma`. Num metadado isso é um campo torto; num DANFSe é imprimir o CNPJ do
  // prestador no lugar do tomador, num documento que circula.
  it("CNPJ do prestador e do tomador não se confundem", () => {
    const { valores } = lerNfse(xmlBase);
    expect(valores.prestDoc).toBe("00.000.000/0001-91");
    expect(valores.tomaDoc).toBe("11.222.333/0001-81");
  });

  it("`vBC` do ISSQN vem de infNFSe/valores, não do grupo IBSCBS", () => {
    const { valores } = lerNfse(xmlBase);
    expect(valores.vBC).toBe("198,00");
    // O grupo IBSCBS não existe no leiaute 1.01 — o campo homônimo tem de sair vazio, não herdar.
    expect(valores.bcAposExclusoes).toBeNull();
  });

  it("a chave sai do atributo Id de infNFSe, sem o prefixo NFS, com 50 dígitos (§2.1.1)", () => {
    const { meta } = lerNfse(xmlBase);
    expect(meta.chave).toHaveLength(50);
    expect(meta.chave.startsWith("NFS")).toBe(false);
  });
});

describe("campo ausente no XML NÃO vira rótulo vazio: leva traço (nota 12 do §2.4.5)", () => {
  it("campo sem informação sai com traço e é nomeado no relatório de conformidade", async () => {
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase, ...semQrOk });
    // A amostra 1.01 não tem `cNBS`, nem `IM` do prestador, nem nada do grupo IBSCBS.
    expect(conformidade.camposAusentes).toEqual(expect.arrayContaining(["cNBS", "prestIM", "vCBS"]));
    expect((await textoDoPdf(pdf)).length).toBeGreaterThan(0);
  });

  it("campo PRESENTE não é reportado como ausente", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase, ...semQrOk });
    expect(conformidade.camposAusentes).not.toContain("nNFSe");
    expect(conformidade.camposAusentes).not.toContain("vServ");
    expect(conformidade.camposAusentes).not.toContain("chaveAcesso");
  });

  it("os campos do grupo IBSCBS são reportados à parte — o leiaute 1.01 não os tem", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase, ...semQrOk });
    expect(conformidade.camposSemFonte).toEqual(
      expect.arrayContaining(["vCBS", "vIBSTot", "vTotNF", "finNFSe", "cstCClassTrib"])
    );
  });

  it("nada é inventado para preencher: o XML não tem xNome em prest e o campo NÃO cai para emit", () => {
    const { valores, avisos } = lerNfse(xmlBase);
    expect(valores.prestNome).toBeNull();
    // ⚠ A divergência é REPORTADA, não consertada por conta própria: usar `emit/xNome` seria
    // criar regra de leiaute que a NT não escreveu.
    expect(avisos.join(" ")).toMatch(/emit\/xNome/);
  });
});

describe("tpAmb = 2 obriga a expressão de homologação (§2 e §2.4.3)", () => {
  it("imprime 'NFS-e SEM VALIDADE JURÍDICA' quando tpAmb = 2", async () => {
    const xml = xmlBase.replace("<tpAmb>1</tpAmb>", "<tpAmb>2</tpAmb>");
    const { pdf } = await gerarDanfse({ xml, ...semQrOk });
    expect(lerNfse(xml).meta.homologacao).toBe(true);
    expect(await textoDoPdf(pdf)).toContain("SEM VALIDADE");
  });

  it("NÃO imprime quando tpAmb = 1 (produção)", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase, ...semQrOk });
    expect(lerNfse(xmlBase).meta.homologacao).toBe(false);
    expect(await textoDoPdf(pdf)).not.toContain("SEM VALIDADE");
  });
});

describe("uma única página — e é requisito (§2.2), não estética", () => {
  const contarPaginas = (pdf) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;

  it("a amostra cabe em uma página, em retrato e A4", async () => {
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase, ...semQrOk });
    expect(conformidade.paginas).toBe(1);
    expect(contarPaginas(pdf)).toBe(1);
    const mediaBox = pdf.toString("latin1").match(/\/MediaBox\s*\[([^\]]+)\]/)[1].trim().split(/\s+/).map(Number);
    expect(mediaBox[2]).toBeCloseTo(cm(21.0), 1);   // 210 mm
    expect(mediaBox[3]).toBeCloseTo(cm(29.7), 1);   // 297 mm
    expect(mediaBox[3]).toBeGreaterThan(mediaBox[2]); // retrato
  });

  // ⚠ O QUE A NT MANDA FAZER NO TRANSBORDO É TRUNCAR, NÃO PAGINAR. §2.1: a quantidade de
  // caracteres "não tem caráter obrigatório, podendo-se utilizar quantidade diversa, acrescido de
  // reticências (...), quando o campo não suportar a totalidade de caracteres". E o DANFSe não tem
  // tabela de itens — há UM `xDescServ` e UM bloco de informações complementares.
  it("descrição de serviço gigante continua em UMA página", async () => {
    const enorme = "SERVIÇO ".repeat(2000);
    const xml = xmlBase.replace(
      "<xDescServ>serviço de telemetria</xDescServ>",
      `<xDescServ>${enorme}</xDescServ>`
    );
    const { pdf, conformidade } = await gerarDanfse({ xml, ...semQrOk });
    expect(conformidade.paginas).toBe(1);
    expect(contarPaginas(pdf)).toBe(1);
    expect(conformidade.avisos.filter((a) => a.includes("páginas"))).toHaveLength(0);
  });

  it("informações complementares gigantes continuam em UMA página", async () => {
    const enorme = "X".repeat(30000);
    const xml = xmlBase.replace(
      "<xDescServ>serviço de telemetria</xDescServ>",
      `<xDescServ>svc</xDescServ></cServ><infoCompl><xInfComp>${enorme}</xInfComp></infoCompl><cServ>`
    );
    const { conformidade } = await gerarDanfse({ xml, ...semQrOk });
    expect(conformidade.paginas).toBe(1);
  });

  it("truncarComReticencias corta no limite da NT e marca o corte", () => {
    expect(truncarComReticencias("abcdef", 3)).toBe("abc...");
    expect(truncarComReticencias("abc", 10)).toBe("abc");
    expect(truncarComReticencias("abc", undefined)).toBe("abc");
  });
});

describe("informações complementares (§2.4.5, notas 7 e 10)", () => {
  it("a linha de Totais Aproximados é obrigatória e sai na forma exata da nota 10", () => {
    const { valores } = lerNfse(xmlBase);
    expect(valores.infoComplementares).toContain(
      "Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012:"
    );
    // A amostra traz pTotTrib (percentuais), não vTotTrib.
    expect(valores.infoComplementares).toMatch(/Federais: 11,33%/);
  });

  it("a chave substituída entra com o rótulo da nota 7, separada por pipe", () => {
    const { valores } = lerNfse(xmlBase);
    expect(valores.infoComplementares).toContain("NFS-e Subst.: 33045572200000000000191000000000001725120000000000");
    expect(valores.infoComplementares).toContain(" | ");
  });

  it("a linha de Totais sobrevive ao truncamento do corpo — ela é FIXA", () => {
    const xml = xmlBase.replace(
      "<xDescServ>serviço de telemetria</xDescServ>",
      `<xDescServ>svc</xDescServ></cServ><infoCompl><xInfComp>${"Y".repeat(9000)}</xInfComp></infoCompl><cServ>`
    );
    const { valores } = lerNfse(xml);
    expect(valores.infoComplementares).toContain("Totais Aproximados dos Tributos");
    expect(valores.infoComplementares).toContain("...");
  });
});

describe("supressões permitidas (§2.3) — o bloco vira UMA frase e o resto sobe", () => {
  it("sem destinatário e sem intermediário, os dois blocos são condensados com a frase da NT", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase, ...semQrOk });
    const ids = conformidade.blocosCondensados.map((b) => b.bloco);
    expect(ids).toContain("destinatario");
    expect(ids).toContain("intermediario");
    const dest = conformidade.blocosCondensados.find((b) => b.bloco === "destinatario");
    expect(dest.frase).toBe("DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");
  });

  it("o tomador da amostra está identificado — o bloco dele NÃO é condensado", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase, ...semQrOk });
    expect(conformidade.blocosCondensados.map((b) => b.bloco)).not.toContain("tomador");
  });
});

describe("descrições de código — pendentes, e a pendência é declarada", () => {
  // ⚠ A NT manda "utilizar a descrição das opções previstas no leiaute", e o leiaute NÃO está
  // versionado neste repositório. Imprimir o código cru é conteúdo do XML (art. 13 respeitado);
  // inventar a descrição seria fabricar tabela de código fiscal.
  it("campos codificados saem com o código cru e entram no relatório", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase, ...semQrOk });
    const campos = conformidade.descricoesPendentes.map((d) => d.campo);
    expect(campos).toEqual(expect.arrayContaining(["tpEmit", "cStat", "opSimpNac", "tribISSQN"]));
    expect(conformidade.descricoesPendentes[0].motivo).toMatch(/não está versionado/);
  });
});

describe("marca d'água (§2.5.1 e §2.5.2)", () => {
  it("`chSubstda` no XML NÃO carimba SUBSTITUÍDA — ele diz 'eu substituo aquela'", async () => {
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase, ...semQrOk });
    expect(await textoDoPdf(pdf)).not.toContain("SUBSTITUÍDA");
    expect(conformidade.avisos.join(" ")).toMatch(/não a torna 'substituída'/);
  });

  it("carimba quando o chamador manda — quem conhece o ciclo da nota é ele", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase, ...semQrOk, marcaDagua: "CANCELADA" });
    expect(await textoDoPdf(pdf)).toContain("CANCELADA");
  });
});

describe("conformidade carrega a procedência da regra", () => {
  it("aponta a NT, a versão, a data e o hash do arquivo versionado", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase, ...semQrOk });
    expect(conformidade.fonte.documento).toBe("NT SE/CGNFS-e nº 008");
    expect(conformidade.fonte.versao).toBe("1.02");
    expect(conformidade.fonte.sha256).toBe(
      "1265f403aedcdc5f08b3049dcc18a15c2bc155f51afccf3d12690fef2f4fb0ff"
    );
  });
});
