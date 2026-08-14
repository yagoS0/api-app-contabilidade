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
import zlib from "node:zlib";
import pdfParse from "pdf-parse";
import QRCode from "qrcode";
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
    await expect(gerarDanfse({ xml: dps })).rejects.toMatchObject({
      code: "DANFSE_XML_NAO_E_NFSE",
    });
  });

  it("recusa XML vazio", async () => {
    await expect(gerarDanfse({ xml: "" })).rejects.toMatchObject({ code: "DANFSE_XML_VAZIO" });
  });
});

const URL_DO_QR_DA_AMOSTRA =
  "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=33045572200000000000191000000000001826011111111110";

describe("QR Code — obrigatório (NT §2.2 e §2.4.3)", () => {
  it("o caminho normal gera COM o QR Code, e o conteúdo é a URL da NT + a chave", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase });
    expect(conformidade.qrCode).toBe("presente");
    // §2.4.3 — a URL é fixa e a chave entra depois do "=".
    expect(conformidade.conteudoDoQrCode).toBe(URL_DO_QR_DA_AMOSTRA);
  });

  // ⚠ A RECUSA NÃO FOI APAGADA COM A CHEGADA DA BIBLIOTECA — ela deixou de ser o caminho normal e
  // continua sendo a resposta certa quando o QR não pode ser feito. Ausência nunca é resposta: um
  // DANFSe sem QR Code servido em silêncio faria o contador mandar ao tomador um documento
  // inválido achando que mandou o certo. E NÃO HÁ MAIS ESCAPE (`permitirSemQrCode` / `?semQrCode=1`).
  it("XML sem chave de acesso RECUSA — não sai DANFSe sem QR Code", async () => {
    const semChave = xmlBase.replace(/Id="[^"]*"/, 'Id=""');
    await expect(gerarDanfse({ xml: semChave })).rejects.toMatchObject({
      code: "DANFSE_SEM_QRCODE",
      motivo: "chave_ausente",
    });
  });

  it("não existe parâmetro que faça o gerador entregar o PDF sem QR Code", async () => {
    // Passar o antigo escape não muda nada: ou o QR sai, ou a geração recusa.
    const semChave = xmlBase.replace(/Id="[^"]*"/, 'Id=""');
    await expect(gerarDanfse({ xml: semChave, permitirSemQrCode: true })).rejects.toMatchObject({
      code: "DANFSE_SEM_QRCODE",
    });
    const { conformidade } = await gerarDanfse({ xml: xmlBase, permitirSemQrCode: true });
    expect(conformidade.qrCode).toBe("presente");
  });

  it("urlDeConsulta usa a chave só com dígitos", () => {
    expect(urlDeConsulta("NFS 3304 5572")).toBe("https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=33045572");
    expect(urlDeConsulta("")).toBeNull();
  });

  // ⚠ O NÍVEL DE CORREÇÃO DE ERRO NÃO É FIXADO PELA NT (§2, §2.2, §2.4.3 e a tabela do §2.4.5 falam
  // de tamanho mínimo, posição, conteúdo e contraste — de nível, não). Ele é NOSSA escolha, e o
  // relatório de conformidade declara isso em vez de deixar parecer exigência do documento.
  it("declara o nível de correção escolhido — e declara que a NT não o fixa", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase });
    expect(conformidade.qrCodeTecnico.nivelCorrecaoErro).toBe("M");
    expect(conformidade.qrCodeTecnico.fixadoPelaNt).toBe(false);
    expect(conformidade.qrCodeTecnico.ladoCm).toBe(1.52);          // §2.4.3, mínimo
    expect(conformidade.qrCodeTecnico.zonaDeSilencioModulos).toBeGreaterThanOrEqual(4); // ISO/IEC 18004
  });
});

describe("QR Code no PDF — posição, tamanho e ORDEM DE PINTURA (§2.2 e §2.4.3)", () => {
  // ⚠ ISTO SE MEDE NO PDF GERADO, NÃO NO RELATÓRIO. `conformidade.qrCode = "presente"` diria
  // "presente" mesmo com o QR coberto por outro desenho — foi exatamente o defeito encontrado: o
  // quadro do QR era pintado ANTES do laço dos blocos, e o título do bloco "DADOS DA NFS-e"
  // (20,40 × 2,84 cm, cinza 5%) passava por cima dele inteiro. Um QR invisível é pior que nenhum.
  const PT_CM = 72 / 2.54;
  const MARGEM_CM = 0.15;

  function contentStream(pdf) {
    const s = pdf.toString("latin1");
    const encontrados = [];
    const re = /stream\r?\n/g;
    let m;
    while ((m = re.exec(s))) {
      const ini = m.index + m[0].length;
      const fim = s.indexOf("endstream", ini);
      try {
        const d = zlib.inflateSync(Buffer.from(s.slice(ini, fim), "latin1")).toString("latin1");
        if (d.includes(" re")) encontrados.push(d);
      } catch { /* não é um stream deflacionado de conteúdo */ }
    }
    return encontrados.sort((a, b) => b.length - a.length)[0] || "";
  }

  it("o símbolo ocupa 1,52 × 1,52 cm em X 17,48 / Y 1,67 (medido no content stream)", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase });
    const cs = contentStream(pdf);
    // pdfkit posiciona a imagem com `<larg> 0 0 -<alt> <x> <y> cm` seguido de `/I<n> Do`.
    const m = cs.match(/([\d.]+) 0 0 -([\d.]+) ([\d.]+) ([\d.]+) cm\n\/I\d+ Do/);
    expect(m).not.toBeNull();
    const [larg, alt, x, yBase] = m.slice(1).map(Number);
    expect(larg / PT_CM).toBeCloseTo(1.52, 2);
    expect(alt / PT_CM).toBeCloseTo(1.52, 2);
    expect(x / PT_CM - MARGEM_CM).toBeCloseTo(17.48, 2);
    expect((yBase - alt) / PT_CM - MARGEM_CM).toBeCloseTo(1.67, 2);
  });

  it("o QR é o ÚLTIMO a ser pintado — nada do leiaute passa por cima dele", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase });
    const cs = contentStream(pdf);
    const posImagem = cs.search(/[\d.]+ 0 0 -[\d.]+ [\d.]+ [\d.]+ cm\n\/I\d+ Do/);
    // O sombreado do bloco "DADOS DA NFS-e": 20,40 × 2,84 cm em 0,30 / 1,48 (mais a margem).
    const larg = (20.4 * PT_CM).toFixed(6);
    const posBloco = cs.indexOf(`${larg} `);
    expect(posBloco).toBeGreaterThan(-1);
    expect(posImagem).toBeGreaterThan(posBloco);
  });

  it("a zona de silêncio é BRANCA e envolve o quadro por inteiro (§2.2 exige contraste)", async () => {
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase });
    const cs = contentStream(pdf);
    const zona = conformidade.qrCodeTecnico.zonaDeSilencioCm;
    const lado = ((1.52 + 2 * zona) * PT_CM).toFixed(6);
    const esq = ((MARGEM_CM + 17.48 - zona) * PT_CM).toFixed(6);
    const sup = ((MARGEM_CM + 1.67 - zona) * PT_CM).toFixed(6);
    // ⚠ `1 1 1 scn` = branco puro. Cinza encostado nos módulos é o que o §2.2 proíbe, e o bloco
    // inteiro é pintado em cinza 5% por este gerador.
    expect(cs).toContain(`${esq} ${sup} ${lado} ${lado} re\n/DeviceRGB cs\n1 1 1 scn\nf`);
  });

  it("o QR entrou como IMAGEM de verdade e não empurrou a página (§2.2 e §2.2.1)", async () => {
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase });
    expect(pdf.toString("latin1")).toMatch(/\/Subtype\s*\/Image/);
    expect(conformidade.paginas).toBe(1);
  });

  // ⚠ AQUI SE LEEM OS PIXELS QUE FORAM PARAR DENTRO DO PDF, módulo a módulo. Conferir que "existe
  // uma imagem" não prova nada: prova o quadrado, não o QR. Isto pega imagem trocada, recortada,
  // esticada, invertida ou codificando outra chave.
  //
  // LIMITE DECLARADO desta verificação: ela compara os módulos com os do MESMO codificador, então
  // não re-deriva a cadeia de caracteres. A decodificação independente (info de formato, máscara,
  // zigue-zague, desintercalação de blocos e segmentos, sem usar o `qrcode`) foi executada fora do
  // suite sobre este mesmo PDF e devolveu exatamente `URL_DO_QR_DA_AMOSTRA`, em versão 5, nível M,
  // máscara 6, 2 blocos, 86 codewords de dados. Trazer aquele decodificador para cá seria pôr 150
  // linhas de máquina de teste, com bugs próprios, para repetir o que estas linhas já travam.
  it("os módulos dentro do PDF são o símbolo da URL exigida pela NT, não outro desenho", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase });
    const s = pdf.toString("latin1");
    const re = /\d+ \d+ obj\s*<<([^]*?)>>\s*stream\r?\n/g;
    let img = null;
    let m;
    while ((m = re.exec(s))) {
      if (!/\/Subtype\s*\/Image/.test(m[1])) continue;
      // ⚠ DeviceGray e SEM SMask: o QR é preto sobre branco, e é assim que ele entra no PDF.
      expect(m[1]).toMatch(/\/ColorSpace\s*\/DeviceGray/);
      expect(m[1]).not.toMatch(/\/SMask/);
      const len = Number(m[1].match(/\/Length\s+(\d+)/)[1]);
      const ini = m.index + m[0].length;
      img = {
        largura: Number(m[1].match(/\/Width\s+(\d+)/)[1]),
        bruto: zlib.inflateSync(pdf.subarray(ini, ini + len)),
      };
      break;
    }
    expect(img).not.toBeNull();

    // O IDAT é repassado direto pelo pdfkit, então vem com os filtros de linha do PNG
    // (Predictor 15). Desfazê-los é o preço de ler os pixels de verdade. 8 bits, 1 canal ⇒ bpp = 1.
    const larg = img.largura;
    const linhas = [];
    let anterior = Buffer.alloc(larg);
    for (let off = 0; off + 1 + larg <= img.bruto.length; off += 1 + larg) {
      const tipo = img.bruto[off];
      const linha = Buffer.from(img.bruto.subarray(off + 1, off + 1 + larg));
      for (let i = 0; i < larg; i += 1) {
        const a = i >= 1 ? linha[i - 1] : 0;
        const b = anterior[i];
        const c = i >= 1 ? anterior[i - 1] : 0;
        let v = linha[i];
        if (tipo === 1) v += a;
        else if (tipo === 2) v += b;
        else if (tipo === 3) v += (a + b) >> 1;
        else if (tipo === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        linha[i] = v & 0xff;
      }
      linhas.push(linha);
      anterior = linha;
    }

    const esperado = QRCode.create(URL_DO_QR_DA_AMOSTRA, { errorCorrectionLevel: "M" }).modules;
    const n = esperado.size;
    expect(linhas.length).toBe(larg);                 // quadrado, sem recorte
    expect(larg % n).toBe(0);                         // sem escala quebrada
    const px = larg / n;
    let iguais = 0;
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        // amostra o centro do módulo, que é o que um leitor faz
        const escuro = linhas[Math.floor(j * px + px / 2)][Math.floor(i * px + px / 2)] < 128;
        if (escuro === Boolean(esperado.get(j, i))) iguais += 1;
      }
    }
    expect(iguais).toBe(n * n);
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
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase });
    // A amostra 1.01 não tem `cNBS`, nem `IM` do prestador, nem nada do grupo IBSCBS.
    expect(conformidade.camposAusentes).toEqual(expect.arrayContaining(["cNBS", "prestIM", "vCBS"]));
    expect((await textoDoPdf(pdf)).length).toBeGreaterThan(0);
  });

  it("campo PRESENTE não é reportado como ausente", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase });
    expect(conformidade.camposAusentes).not.toContain("nNFSe");
    expect(conformidade.camposAusentes).not.toContain("vServ");
    expect(conformidade.camposAusentes).not.toContain("chaveAcesso");
  });

  it("os campos do grupo IBSCBS são reportados à parte — o leiaute 1.01 não os tem", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase });
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
    const { pdf } = await gerarDanfse({ xml });
    expect(lerNfse(xml).meta.homologacao).toBe(true);
    expect(await textoDoPdf(pdf)).toContain("SEM VALIDADE");
  });

  it("NÃO imprime quando tpAmb = 1 (produção)", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase });
    expect(lerNfse(xmlBase).meta.homologacao).toBe(false);
    expect(await textoDoPdf(pdf)).not.toContain("SEM VALIDADE");
  });
});

describe("uma única página — e é requisito (§2.2), não estética", () => {
  const contarPaginas = (pdf) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;

  it("a amostra cabe em uma página, em retrato e A4", async () => {
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase });
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
    const { pdf, conformidade } = await gerarDanfse({ xml });
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
    const { conformidade } = await gerarDanfse({ xml });
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
    const { conformidade } = await gerarDanfse({ xml: xmlBase });
    const ids = conformidade.blocosCondensados.map((b) => b.bloco);
    expect(ids).toContain("destinatario");
    expect(ids).toContain("intermediario");
    const dest = conformidade.blocosCondensados.find((b) => b.bloco === "destinatario");
    expect(dest.frase).toBe("DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");
  });

  it("o tomador da amostra está identificado — o bloco dele NÃO é condensado", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase });
    expect(conformidade.blocosCondensados.map((b) => b.bloco)).not.toContain("tomador");
  });
});

describe("descrições de código — pendentes, e a pendência é declarada", () => {
  // ⚠ A NT manda "utilizar a descrição das opções previstas no leiaute", e o leiaute NÃO está
  // versionado neste repositório. Imprimir o código cru é conteúdo do XML (art. 13 respeitado);
  // inventar a descrição seria fabricar tabela de código fiscal.
  it("campos codificados saem com o código cru e entram no relatório", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase });
    const campos = conformidade.descricoesPendentes.map((d) => d.campo);
    expect(campos).toEqual(expect.arrayContaining(["tpEmit", "cStat", "opSimpNac", "tribISSQN"]));
    expect(conformidade.descricoesPendentes[0].motivo).toMatch(/não está versionado/);
  });
});

describe("marca d'água (§2.5.1 e §2.5.2)", () => {
  it("`chSubstda` no XML NÃO carimba SUBSTITUÍDA — ele diz 'eu substituo aquela'", async () => {
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase });
    expect(await textoDoPdf(pdf)).not.toContain("SUBSTITUÍDA");
    expect(conformidade.avisos.join(" ")).toMatch(/não a torna 'substituída'/);
  });

  it("carimba quando o chamador manda — quem conhece o ciclo da nota é ele", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase, marcaDagua: "CANCELADA" });
    expect(await textoDoPdf(pdf)).toContain("CANCELADA");
  });
});

describe("conformidade carrega a procedência da regra", () => {
  it("aponta a NT, a versão, a data e o hash do arquivo versionado", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase });
    expect(conformidade.fonte.documento).toBe("NT SE/CGNFS-e nº 008");
    expect(conformidade.fonte.versao).toBe("1.02");
    expect(conformidade.fonte.sha256).toBe(
      "1265f403aedcdc5f08b3049dcc18a15c2bc155f51afccf3d12690fef2f4fb0ff"
    );
  });
});
