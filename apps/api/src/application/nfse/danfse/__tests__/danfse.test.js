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
import {
  truncarComReticencias,
  urlDeConsulta,
  cm,
  BLOCOS,
  tituloEhCaixaDelimitadora,
} from "../danfseLeiaute.js";
import { DESCRICOES } from "../danfseDescricoes.js";
import { rotuloMunicipioIbge } from "../../lote/municipiosIbge.js";

// ⚠ TEMPO-LIMITE PRÓPRIO — NÃO É FOLGA PARA TESTE LENTO ESCONDER REGRESSÃO.
// Cada caso aqui GERA um PDF e o LÊ DE VOLTA com pdf-parse; isso custa tempo de CPU de verdade, e o
// default do jest (5000 ms) não cabe: medido em 18/08/2026, o caso mais lento leva 2665 ms rodando
// sozinho e 4462 ms na suíte completa (8 workers) — 89% do orçamento, 538 ms de margem. O resultado
// era vermelho por sorteio: o mesmo teste passava 50/50 isolado e estourava em ~metade das rodadas
// cheias, e QUALQUER suíte nova acrescentada ao projeto reduzia essa margem. Vermelho por acaso
// treina a equipe a ignorar vermelho.
// 30 s = ~6,7x o pior tempo já medido sob carga. É margem para contenção de CPU, não para lentidão
// nova: se um caso destes chegar perto de 30 s, o gerador regrediu e o certo é investigar, não
// subir o número. (Local, e não `testTimeout` global no jest.config.js, porque o custo é deste
// arquivo — afrouxar o projeto inteiro esconderia teste travado em outro lugar.)
jest.setTimeout(30000);

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
    //
    // ⚠⚠ A ÚLTIMA, NÃO A PRIMEIRA. Até 24/08/2026 havia UMA imagem no PDF e `match` bastava; com a
    // logomarca oficial da NFS-e versionada (§2.4.3) são DUAS, e a primeira passou a ser a logo —
    // o teste media 3,49 cm no lugar de 1,52 e falhava sem que nada do QR tivesse mudado.
    // Pegar a ÚLTIMA não é contorno: **ser a última é a garantia do QR**, e é o que o teste
    // seguinte trava. Imagem nova desenhada DEPOIS dele quebraria os dois — que é o desejado.
    const todas = [...cs.matchAll(/([\d.]+) 0 0 -([\d.]+) ([\d.]+) ([\d.]+) cm\n\/I\d+ Do/g)];
    expect(todas.length).toBeGreaterThan(0);
    const m = todas[todas.length - 1];
    const [larg, alt, x, yBase] = m.slice(1).map(Number);
    expect(larg / PT_CM).toBeCloseTo(1.52, 2);
    expect(alt / PT_CM).toBeCloseTo(1.52, 2);
    expect(x / PT_CM - MARGEM_CM).toBeCloseTo(17.48, 2);
    expect((yBase - alt) / PT_CM - MARGEM_CM).toBeCloseTo(1.67, 2);
  });

  it("o QR é o ÚLTIMO a ser pintado — nada do leiaute passa por cima dele", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase });
    const cs = contentStream(pdf);
    // ⚠ A ÚLTIMA imagem — ver o teste acima. A logo da NFS-e é pintada no cabeçalho, no começo; o
    // QR é o último desenho do documento inteiro, e é isso que se afirma aqui.
    const posicoes = [...cs.matchAll(/[\d.]+ 0 0 -[\d.]+ [\d.]+ [\d.]+ cm\n\/I\d+ Do/g)].map((x) => x.index);
    expect(posicoes.length).toBeGreaterThan(0);
    const posImagem = posicoes[posicoes.length - 1];
    // ⚠ `lastIndexOf`, não `indexOf`: o que se quer travar é que NENHUM desenho do leiaute venha
    // depois do QR, e não só o primeiro deles. Os blocos de 20,40 cm de largura (cabeçalho, dados
    // da NFS-e, informações complementares) são os que já passaram por cima dele uma vez.
    const larg = (20.4 * PT_CM).toFixed(6);
    const posBloco = cs.lastIndexOf(`${larg} `);
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

  // ⚠⚠ ESTE TESTE FOI INVERTIDO EM 24/08/2026, NÃO APAGADO — mesma disciplina do teste do SIEFPAR.
  // Ele dizia *"o campo NÃO cai para emit"* e travava uma decisão que valia ENQUANTO NÃO HAVIA
  // EVIDÊNCIA. Medido nos XMLs REAIS que o sistema nacional devolveu
  // (`scripts/diag-danfse-prestador.mjs`): o bloco `prest` traz SÓ `CNPJ` e `regTrib` —
  // `prest/xNome` e `prest/end` NUNCA vêm. E a NT §2.4.5 EXIGE nome e endereço do prestador no
  // DANFSe. A trava mudou de lado: hoje ela prende o complemento **e o limite dele**.
  it("o prestador CAI para infNFSe/emit quando o CNPJ prova que é a mesma pessoa", () => {
    const { valores, avisos } = lerNfse(xmlBase);
    expect(valores.prestNome).toBe("EMPRESA EXEMPLO LTDA");
    // ⚠ O complemento é DECLARADO — quem confere o DANFSe contra o XML precisa saber que aquele
    // dado não veio do caminho que a NT indica.
    expect(avisos.join(" ")).toMatch(/infNFSe\/emit/);
    expect(avisos.join(" ")).toMatch(/mesmo CNPJ/i);
  });

  it("⚠⚠ CNPJ DIFERENTE não completa nada — o traço volta, com o motivo", () => {
    // Nota emitida pelo TOMADOR ou pelo INTERMEDIÁRIO: `emit` é OUTRA pessoa jurídica. Cair para
    // ele imprimiria o endereço de terceiro debaixo do rótulo "PRESTADOR", num documento fiscal.
    // É a proteção que o teste antigo dava, preservada exatamente onde ela importa.
    const xmlOutroEmitente = xmlBase.replace(
      /(<emit>[\s\S]*?<CNPJ>)(\d+)(<\/CNPJ>)/,
      (_m, abre, digitos, fecha) => `${abre}${digitos.slice(0, -2)}99${fecha}`
    );
    expect(xmlOutroEmitente).not.toBe(xmlBase); // o replace precisa ter acontecido

    const { valores, avisos } = lerNfse(xmlOutroEmitente);
    expect(valores.prestNome).toBeNull();
    expect(avisos.join(" ")).toMatch(/CNPJ diverg/i);
    expect(avisos.join(" ")).toMatch(/tomador|intermedi/i);
  });

  it("o que a DPS TRAZ vence o que veio de emit — completar não é sobrescrever", () => {
    // Havendo `prest/xNome`, ele é o que sai: é o que NÓS declaramos na DPS, e o eco do sistema
    // nacional não pode apagar uma correção de cadastro.
    const xmlComNomeNaDps = xmlBase.replace(
      /(<prest>\s*<CNPJ>\d+<\/CNPJ>)/,
      "$1<xNome>NOME DECLARADO NA DPS</xNome>"
    );
    expect(xmlComNomeNaDps).not.toBe(xmlBase);
    expect(lerNfse(xmlComNomeNaDps).valores.prestNome).toBe("NOME DECLARADO NA DPS");
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

describe("município por extenso (§2.4.5) — obrigação da NT, não melhoria", () => {
  // ⚠⚠ A NT escreve: *"Leiaute prevê a informação do código do município com 7 dígitos da Tabela do
  // IBGE. **Utilizar a descrição destes códigos.** Concatenar o nome do município com a respectiva
  // UF. Ex.: Município / UF"*. O DANFSe imprimia o código cru nos quatro campos de pessoa, e o
  // comentário que justificava isso ("a tabela do IBGE não está no projeto") tinha ficado FALSO em
  // 20/08/2026.
  it("o município da pessoa sai NOME / UF, e some de municipiosNaoResolvidos", async () => {
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase });
    expect(await textoDoPdf(pdf)).toContain("Rio de Janeiro / RJ");
    expect(conformidade.municipiosNaoResolvidos).toEqual([]);
  });

  it("⚠ o código CRU continua no campo IBGE/CEP — ali a NT pede o número, não o nome", async () => {
    // §2.4.5: "nnnnnnn / nn.nnn-nnn". São dois campos diferentes lendo o MESMO `cMun`, e trocar um
    // pelo outro é o tipo de conserto que parece arrumação e quebra a conformidade.
    const { valores } = lerNfse(xmlBase, { municipios: [["3304557", "Rio de Janeiro", "RJ"]] });
    expect(valores.prestMunicipio).toBe("Rio de Janeiro / RJ");
    expect(valores.prestIbgeCep).toMatch(/^3304557 \//);
  });

  it("⚠⚠ SEM a lista, volta ao código cru E é reportado — nunca derruba o PDF", async () => {
    // Direção do erro OPOSTA à do lote: lá lista ausente impede a emissão (a nota ainda vai
    // nascer); aqui o documento JÁ EXISTE e não pode deixar de ser impresso por uma tabela de
    // apoio. `lerNfse` sem `municipios` é exatamente o comportamento anterior a 24/08/2026.
    const { valores, meta } = lerNfse(xmlBase);
    expect(valores.prestMunicipio).toBe("3304557");
    expect(meta.municipiosNaoResolvidos).toEqual(
      expect.arrayContaining(["prestMunicipio", "tomaMunicipio"])
    );
  });

  it("⚠ código FORA da lista não vira nome aproximado — sai cru e reportado", () => {
    const { valores, meta } = lerNfse(xmlBase, { municipios: [["9999999", "Cidade Fantasia", "ZZ"]] });
    expect(valores.prestMunicipio).toBe("3304557");
    expect(meta.municipiosNaoResolvidos).toContain("prestMunicipio");
  });

  it("⚠ SETE dígitos exatos, sem padStart — código curto não vira município plausível", () => {
    // Completar com zero fabricaria um município a partir de um dígito perdido — a classe do
    // `cLocEmi=\"0000000\"` que este projeto já pagou.
    expect(rotuloMunicipioIbge([["0330455", "Qualquer", "XX"]], "330455")).toBeNull();
    expect(rotuloMunicipioIbge([["3304557", "Rio de Janeiro", "RJ"]], "3304557")).toBe("Rio de Janeiro / RJ");
    // Nome sem UF não vira meia resposta: "São Paulo" sozinho é ambíguo entre município e estado.
    expect(rotuloMunicipioIbge([["3550308", "São Paulo", ""]], "3550308")).toBeNull();
    expect(rotuloMunicipioIbge(null, "3304557")).toBeNull();
  });
});

describe("descrições de código — RESOLVIDAS pelo XSD oficial, e o desconhecido continua declarado", () => {
  // ⚠⚠ ESTE BLOCO FOI INVERTIDO EM 24/08/2026, NÃO APAGADO. Ele dizia "pendentes, e a pendência é
  // declarada", e a pendência era real ENQUANTO o leiaute não estava no repositório. Está: são 20
  // XSD em `docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/Schemas/`, com a descrição de cada
  // código dentro da `<xs:documentation>`. A NT §2.4.5 manda "utilizar a descrição das opções
  // previstas no leiaute" — deixar de traduzir passou a ser a não conformidade.
  //
  // A trava mudou de lado: hoje ela prende as descrições OFICIAIS **e** o comportamento quando o
  // código não estiver na enumeração, que é a proteção que o teste antigo dava.
  it("os campos codificados saem TRADUZIDOS, com o texto do leiaute", async () => {
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase });
    const texto = await textoDoPdf(pdf);
    // ⚠⚠ A amostra versionada é `cStat = 101` — a nota SUBSTITUÍDA. E é ela que prova por que a
    // entrada `101` (lida do XSD **1.00**, removida da enumeração no 1.01) precisou existir: sem
    // ela, a nota que mais precisa de explicação sairia com o código "101" cru na cara do tomador.
    // `tpEmit=1`, `opSimpNac=1`, `tribISSQN=1`.
    expect(texto).toContain("Prestador");
    expect(texto).toContain("Substituição Gerada");
    // ⚠⚠ NUNCA "Autorizada" — o dono pediu essa palavra para o `cStat` e o XSD contradiz
    // (`TStat` diz "Gerada"). Regra 4: fonte oficial vence. "Autorizada" é vocabulário de NF-e e é
    // o valor de `PortalInvoice.statusEfetivo`, que é palavra NOSSA — imprimi-la como descrição do
    // fisco misturaria os dois vocabulários num documento que circula.
    expect(texto).not.toContain("Autorizada");
    expect(texto).toContain("Não Optante");
    expect(texto).toContain("Operação tributável");
    // Resolvidos ⇒ não há pendência a declarar sobre eles.
    const campos = conformidade.descricoesPendentes.map((d) => d.campo);
    expect(campos).not.toEqual(expect.arrayContaining(["tpEmit", "cStat", "opSimpNac", "tribISSQN"]));
  });

  it("⚠ código FORA da enumeração continua saindo CRU e declarado — não se inventa tradução", async () => {
    // O `cStat` 999 não existe em nenhuma versão do leiaute. A resposta certa é imprimir o que
    // está no XML (art. 13) e NOMEAR que a tradução falta — nunca aproximar para o vizinho.
    const xml = xmlBase.replace(/<cStat>\d+<\/cStat>/, "<cStat>999</cStat>");
    expect(xml).not.toBe(xmlBase);
    const { pdf, conformidade } = await gerarDanfse({ xml });
    expect(await textoDoPdf(pdf)).toContain("999");
    expect(conformidade.descricoesPendentes.map((d) => d.campo)).toContain("cStat");
  });

  it("⚠ o 101 vem do XSD 1.00 — é a nota SUBSTITUÍDA, e o 1.01 removeu o código da enumeração", () => {
    // Sem esta entrada, a nota que mais precisa de explicação sairia com código cru.
    expect(DESCRICOES.cStat[101]).toBe("NFS-e de Substituição Gerada");
  });

  it("⚠ o texto é COPIADO do leiaute, com o erro de digitação do arquivo oficial", () => {
    // `TSTipoRetISSQN` escreve "Intermediario" sem acento. Não se corrige o fisco: a NT manda
    // usar "a descrição das opções previstas no leiaute", e o leiaute é este.
    expect(DESCRICOES.tpRetISSQN[3]).toBe("Retido pelo Intermediario");
  });

  it("⚠ zero é valor DECLARADO em três enumerações, não ausência", () => {
    // Confundir com a nota 12 (campo sem informação ⇒ traço) apagaria uma afirmação do emitente.
    expect(DESCRICOES.tpRetPisCofins[0]).toBe("PIS/COFINS/CSLL Não Retidos");
    expect(DESCRICOES.regEspTrib[0]).toBe("Nenhum");
    expect(DESCRICOES.tpImunidade[0]).toBe("Imunidade (tipo não informado na nota de origem)");
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// O que a CONFERÊNCIA CONTRA UM DANFSe OFICIAL mostrou (um documento real, gerado pelo sistema
// oficial, lido só para leiaute — nada dele entra neste repositório).
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("§2.4.2 — o rótulo impresso não é o NOME da tabela em caixa alta", () => {
  // A tabela do §2.4.5 escreve todo NOME em maiúsculas, mas o §2.4.2 manda imprimir "com a
  // primeira letra de cada palavra maiúscula e o restante minúsculo" — EXCETO no bloco 2.1.2
  // (Dados de Identificação da NFS-e), que é 7 pt e caixa alta. O gerador imprimia o NOME cru em
  // toda parte, o que deixava nove blocos fora da regra.
  it("os campos do bloco 2.1.2 saem em CAIXA ALTA e os demais em Primeira Letra", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase });
    const texto = await textoDoPdf(pdf);
    expect(texto).toContain("CHAVE DE ACESSO DA NFS-e");
    expect(texto).toContain("NÚMERO DA DPS");
    expect(texto).toContain("Indicador Municipal (Inscrição)");
    expect(texto).toContain("Simples Nacional na Data de Competência");
    expect(texto).toContain("Descrição do Serviço");
    expect(texto).not.toContain("INDICADOR MUNICIPAL");
    expect(texto).not.toContain("DESCRIÇÃO DO SERVIÇO");
  });

  // "NFS-e" é nome próprio (a lista de abreviaturas da própria NT o fixa assim) e a NT escreve as
  // duas formas para o MESMO campo. O DANFSe oficial imprime sempre "NFS-e".
  it('"NFS-e" não vira "NFS-E" nem nos rótulos em caixa alta', async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase });
    expect(await textoDoPdf(pdf)).not.toContain("NFS-E");
  });

  // Em CABEÇALHO, DADOS DA NFS-e e CANHOTO a linha do §2.4.5 é a caixa delimitadora do bloco: o
  // `esq`/`sup` dela é o do primeiro campo. Escrever o título ali imprimia "DADOS DA NFS-e" por
  // cima de "CHAVE DE ACESSO DA NFS-e". O DANFSe oficial não traz nenhum dos dois textos.
  it("bloco sem célula de título não imprime título nenhum", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase, incluirCanhoto: true });
    const texto = await textoDoPdf(pdf);
    expect(texto).not.toContain("DADOS DA NFS-e");
    expect(texto).not.toContain("CANHOTO");
    // ... mas os blocos que TÊM célula de título continuam imprimindo o seu.
    expect(texto).toContain("PRESTADOR / FORNECEDOR");
    expect(texto).toContain("INFORMAÇÕES COMPLEMENTARES");
  });
});

describe("§2.2.3 — sombreado é do CABEÇALHO e dos TÍTULOS, não do bloco inteiro", () => {
  const PT_CM = 72 / 2.54;
  const MARGEM_CM = 0.15;
  const CINZA = "0.9490196078431372 0.9490196078431372 0.9490196078431372 scn";

  function contentStream(pdf) {
    const s = pdf.toString("latin1");
    const achados = [];
    const re = /stream\r?\n/g;
    let m;
    while ((m = re.exec(s))) {
      const ini = m.index + m[0].length;
      const fim = s.indexOf("endstream", ini);
      try {
        const d = zlib.inflateSync(Buffer.from(s.slice(ini, fim), "latin1")).toString("latin1");
        if (d.includes(" re")) achados.push(d);
      } catch { /* não é conteúdo */ }
    }
    return achados.sort((a, b) => b.length - a.length)[0] || "";
  }
  // O pdfkit escreve os números com até 6 casas e SEM zeros à direita (32.88189, não 32.881890).
  const rect = (esq, sup, larg, alt) =>
    [esq + MARGEM_CM, sup + MARGEM_CM, larg, alt]
      .map((v) => String(Number((v * PT_CM).toFixed(6)))).join(" ") + " re";

  it("o bloco DADOS DA NFS-e (20,40 × 2,84 em 0,30/1,48) NÃO é pintado de cinza", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase });
    const cs = contentStream(pdf);
    // A caixa continua desenhada (linha divisória de 0,5 pt, §2.2.3) — o que não existe mais é o
    // preenchimento cinza dela, que sombreava os dez campos de identificação de uma vez.
    expect(cs).toContain(`${rect(0.3, 1.48, 20.4, 2.84)}\n/DeviceRGB CS`);
    expect(cs).not.toContain(`${rect(0.3, 1.48, 20.4, 2.84)}\n/DeviceRGB cs\n${CINZA}`);
  });

  it("o cabeçalho e o campo 'Emitente da NFS-e' CONTINUAM sombreados — o §2.2.3 os nomeia", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase });
    const cs = contentStream(pdf);
    expect(cs).toContain(`${rect(0.3, 0.3, 20.4, 1.16)}\n/DeviceRGB cs\n${CINZA}`);
    expect(cs).toContain(`${rect(0.3, 3.65, 5.09, 0.67)}\n/DeviceRGB cs\n${CINZA}`);
  });
});

describe("nota 5 do §2.4.5 — linha inteira sem dado no XML pode ser suprimida", () => {
  it("a linha de Benefício Municipal (toda vazia na amostra) some, e a supressão é declarada", async () => {
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase });
    const suprimida = conformidade.linhasSuprimidas.find((l) => l.campos.includes("tpBM"));
    expect(suprimida).toMatchObject({ bloco: "issqn", notaDaNt: 5 });
    expect(suprimida.campos).toEqual(["tpBM", "vCalcBM", "vDedRed", "vDescIncondIssqn"]);
    expect(await textoDoPdf(pdf)).not.toContain("Benefício Municipal");
  });

  it("linha com UM campo preenchido NÃO é suprimida — a nota exige a linha inteira vazia", async () => {
    // A amostra traz `regEspTrib` = 0, e ele está na linha do §2.4.5 em sup 15,08.
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase });
    expect(conformidade.linhasSuprimidas.some((l) => l.campos.includes("regEspTrib"))).toBe(false);
    const texto = await textoDoPdf(pdf);
    expect(texto).toContain("Regime Especial de Tributação do ISSQN");
    expect(texto).toContain("Número Processo Suspensão"); // o vizinho vazio da MESMA linha fica
  });

  it("esvaziando o campo que segurava a linha, ela também é suprimida", async () => {
    const xml = xmlBase.replace("<regEspTrib>0</regEspTrib>", "");
    const { conformidade } = await gerarDanfse({ xml });
    expect(conformidade.linhasSuprimidas.some((l) => l.campos.includes("regEspTrib"))).toBe(true);
    expect(conformidade.paginas).toBe(1);
  });
});

describe("máscaras — só as que a NT escreve no §2.4.5", () => {
  it("cTribNac sai como nn.nn.nn, com o municipal ao lado", () => {
    const { valores } = lerNfse(xmlBase);
    expect(valores.cTrib).toBe("31.01.04 / 001");
  });

  it("o CEP sai como nn.nnn-nnn, e o código do IBGE sai CRU", () => {
    // §2.4.5, CÓDIGO IBGE / CEP: "Ex.: nnnnnnn / nn.nnn-nnn". O DANFSe oficial imprime também um
    // ponto no código do IBGE ("nn.nnnnn") — a NT não o escreve, e por isso não o replicamos.
    const { valores } = lerNfse(xmlBase);
    expect(valores.tomaIbgeCep).toBe("3106200 / 30.000-000");
  });

  it("comprimento fora da máscara sai cru — não se corta dígito de código fiscal para caber", () => {
    const xml = xmlBase.replace("<cTribNac>310104</cTribNac>", "<cTribNac>31010</cTribNac>");
    expect(lerNfse(xml).valores.cTrib).toBe("31010 / 001");
  });
});

describe("nota 12 em campo COMPOSTO — um traço por componente", () => {
  it("campo de duas tags ausente sai '- / -', não '-'", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase });
    const texto = await textoDoPdf(pdf);
    // `CST / cClassTrib` e `Alíquota - IBS UF / IBS Mun` vêm do grupo IBSCBS, que não existe no 1.01.
    expect(texto).toContain("- / -");
    expect(texto).toContain("- / - / -");
  });

  it("componente presente e componente ausente convivem na mesma célula", () => {
    // `locPrest` = xLocPrestacao + cPaisPrestacao; a amostra só tem o primeiro.
    const { valores } = lerNfse(xmlBase);
    expect(valores.locPrest).toBe("Rio de Janeiro / -");
  });
});

describe("a descrição do serviço VEM DO XML — não falta tabela para imprimi-la", () => {
  // ⚠ Este era o achado a confirmar: o DANFSe oficial imprime "Serviços técnicos em
  // telecomunicações." acima do rótulo "Descrição do Serviço". Ela NÃO é um dos doze campos
  // codificados: é `xTribMun`/`xTribNac`, texto pronto dentro de `infNFSe`. O art. 13 é respeitado
  // por construção e `danfseDescricoes.js` não tem nada a ver com isso.
  it("usa a descrição MUNICIPAL quando ela existe (§2.4.5) e imprime sem rótulo", async () => {
    const { valores } = lerNfse(xmlBase);
    expect(valores.xTrib).toBe("Serviços técnicos em telecomunicações.");
    const { pdf, conformidade } = await gerarDanfse({ xml: xmlBase });
    expect(await textoDoPdf(pdf)).toContain("Serviços técnicos em telecomunicações.");
    // e ela não aparece na lista de pendências de descrição — não é código a traduzir
    expect(conformidade.descricoesPendentes.map((d) => d.campo)).not.toContain("xTrib");
  });

  it("sem a municipal, cai para a NACIONAL — nunca para o código", () => {
    const xml = xmlBase.replace(/<xTribMun>[^<]*<\/xTribMun>/, "");
    expect(lerNfse(xml).valores.xTrib).toBe("Serviços técnicos em telecomunicações e congêneres.");
  });
});

describe("§2.4.3 — a descrição complementar do QR Code sai INTEIRA, em 3 linhas", () => {
  it("a frase não é truncada com reticências", async () => {
    const { pdf } = await gerarDanfse({ xml: xmlBase });
    const texto = (await textoDoPdf(pdf)).replace(/\s+/g, " ");
    // O texto que a NT manda imprimir literalmente, quebrado em 3 linhas pelo pdfkit.
    expect(texto).toContain("A autenticidade desta NFS-e pode ser verificada");
    expect(texto).toContain("chave de acesso no portal nacional da NFS-e");
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// OS TRÊS DEFEITOS RELATADOS PELO DONO NUM DANFSe REAL (24/08/2026)
//
// > *"a descrição da nota deve aparecer completa, e esse texto: TRIBUTAÇÃO MUNICIPAL (ISSQN) Tipo
// > de Tributação do ISSQN está bugado no pdf ficando um em cima do outro"* · *"Rio de Janeiro / -
// > isso também tá errado, nesse caso deveria ser Rio de Janeiro/RJ"*
//
// Os três têm origem diferente e por isso ficam em blocos separados. Nenhum é "ajuste de layout":
// o primeiro APAGAVA texto do documento, o segundo tornava dois campos ilegíveis, e o terceiro
// fazia o traço de um campo AUSENTE (o país) ser lido como a UF faltando.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const MUNICIPIOS_DE_TESTE = [["3304557", "Rio de Janeiro", "RJ"]];

/** Troca a descrição do serviço na amostra versionada, preservando todo o resto do XML. */
function comDescricao(texto) {
  const trocado = xmlBase.replace(/<xDescServ>[\s\S]*?<\/xDescServ>/, `<xDescServ>${texto}</xDescServ>`);
  if (trocado === xmlBase) throw new Error("A amostra deixou de ter <xDescServ> — conferir a fixture.");
  return trocado;
}

const semEspacos = (valor) => String(valor).replace(/\s+/g, " ").trim();

describe("descrição do serviço — a célula CRESCE em vez de cortar o texto", () => {
  // ⚠ Uma descrição de 350 caracteres não é caso extremo: é uma descrição de serviço comum. A
  // célula do §2.4.5 tem 0,63 cm = 17,9 pt e o conteúdo é desenhado a 8 pt do topo — sobram 8,9 pt,
  // menos que UMA linha de 8 pt (~9,2 pt). Antes deste conserto o campo perdia o texto a partir da
  // primeira linha, com o `ellipsis` silencioso.
  const DESCRICAO_REAL =
    "Servico de telemetria e monitoramento remoto de ativos, incluindo instalacao de equipamentos, " +
    "configuracao de gateways, manutencao preventiva e corretiva, suporte tecnico especializado, " +
    "emissao de relatorios gerenciais periodicos e treinamento da equipe operacional do contratante.";

  it("imprime a descrição INTEIRA, e não a primeira linha com reticências", async () => {
    const { pdf } = await gerarDanfse({ xml: comDescricao(DESCRICAO_REAL) });
    expect(semEspacos(await textoDoPdf(pdf))).toContain(semEspacos(DESCRICAO_REAL));
  });

  it("declara o crescimento no relatório — quem lê o PDF precisa saber que a célula não é a do §2.4.5", async () => {
    const { conformidade } = await gerarDanfse({ xml: comDescricao(DESCRICAO_REAL) });
    const crescido = conformidade.camposCrescidos.find((c) => c.campo === "xDescServ");
    expect(crescido).toBeDefined();
    expect(crescido.paraCm).toBeGreaterThan(crescido.deCm);
    expect(crescido.truncado).toBe(false);
  });

  // ⚠⚠ ESTA É A TRAVA MAIS IMPORTANTE DO BLOCO. §2.2: *"deve ser impresso, obrigatoriamente, em uma
  // única página"*. Crescer a descrição só é lícito porque a altura sai da FOLGA do bloco elástico
  // (Informações Complementares), que encolhe na mesma medida. Sem o teto, a descrição empurraria o
  // canhoto para fora da folha — e o teste de página única que já existe não cobre o caso longo.
  it.each([false, true])(
    "continua em UMA página com a descrição além do limite do §2.4.5 (canhoto=%s)",
    async (incluirCanhoto) => {
      const gigante = "abcdefghij ".repeat(400); // 4.400 chars, muito além do `max: 1300`
      const { pdf, conformidade } = await gerarDanfse({ xml: comDescricao(gigante), incluirCanhoto });
      const { numpages, text } = await pdfParse(pdf);
      expect(numpages).toBe(1);
      // O que o §2.1 (`truncaEm`) deixou passar tem de aparecer INTEIRO: o corte é da regra de
      // caracteres, nunca da geometria da célula.
      expect(semEspacos(text)).toContain(semEspacos(gigante.slice(0, 1297)));
      expect(conformidade.camposCrescidos.find((c) => c.campo === "xDescServ").truncado).toBe(false);
    }
  );

  it("descrição curta quase não cresce — o crescimento é o necessário, não um bloco fixo", async () => {
    const { conformidade } = await gerarDanfse({ xml: comDescricao("Servicos de consultoria.") });
    const crescido = conformidade.camposCrescidos.find((c) => c.campo === "xDescServ");
    expect(crescido.paraCm).toBeLessThan(1);
  });
});

describe("título do bloco × rótulo do primeiro campo — a sobreposição do ISSQN", () => {
  // ⚠⚠ A NT dá ao bloco TRIBUTAÇÃO MUNICIPAL (ISSQN) e ao campo TIPO DE TRIBUTAÇÃO DO ISSQN
  // exatamente as mesmas coordenadas (0,63 · 5,09 · 0,30 · 14,43 — p. 18 do PDF versionado). A
  // transcrição está FIEL; o que faltava era a LEITURA: naquela linha o §2.4.5 descreve a CAIXA
  // DELIMITADORA do bloco, não uma célula de título. O critério já existia neste projeto para
  // CABEÇALHO, DADOS DA NFS-e e CANHOTO.
  // ⚠⚠ A ASSERÇÃO É A AUSÊNCIA DO TEXTO, E NÃO UM `not.toMatch` DE VIZINHANÇA. Experimento
  // executado: com a regra desligada, um `not.toMatch(/MUNICIPAL \(ISSQN\)\s*Tipo de Tributa/)`
  // continuava VERDE — o `pdf-parse` achata a página em linhas e não delata dois textos pintados no
  // MESMO `y`. Teste que não pode falhar é pior que teste nenhum: ele afirmaria que a sobreposição
  // foi consertada em qualquer estado do código.
  it("o título não é escrito — a célula pertence ao primeiro campo", async () => {
    const texto = await textoDoPdf((await gerarDanfse({ xml: xmlBase })).pdf);
    // ⚠ Comparado contra o `titulo` DO LEIAUTE, nunca contra um literal reescrito aqui: um título
    // reescrito à mão passa a valer por si e o teste deixa de falar do bloco de verdade.
    expect(texto).not.toContain(BLOCOS.find((b) => b.id === "issqn").titulo);
  });

  it("o rótulo do campo continua impresso — o que some é o título, nunca o rótulo", async () => {
    const texto = await textoDoPdf((await gerarDanfse({ xml: xmlBase })).pdf);
    expect(texto).toMatch(/Tipo de Tributação do ISSQN/);
  });

  it("declara no relatório qual título deixou de ser impresso, e por qual nota", async () => {
    const { conformidade } = await gerarDanfse({ xml: xmlBase });
    expect(conformidade.titulosNaoImpressos).toEqual([
      { bloco: "issqn", titulo: "TRIBUTAÇÃO MUNICIPAL (ISSQN)", notaDaNt: 4 },
    ]);
  });

  // ⚠ A regra é DERIVADA das coordenadas, e não uma bandeira à mão — é isso que impede um bloco
  // novo de reintroduzir a sobreposição sem ninguém lembrar da armadilha.
  it("a regra é geométrica: nenhum bloco escreve título onde o primeiro campo já escreve rótulo", () => {
    const colidem = BLOCOS.filter(
      (b) =>
        b.tituloImpresso !== false &&
        !tituloEhCaixaDelimitadora(b) &&
        b.campos &&
        b.campos[0] &&
        b.esq === b.campos[0].esq &&
        b.sup === b.campos[0].sup
    ).map((b) => b.id);
    expect(colidem).toEqual([]);
  });
});

describe("MUNICÍPIO / SIGLA UF / PAÍS — a UF vem do código do IBGE, nunca do `xLoc*`", () => {
  // ⚠ O rótulo do §2.4.5 promete três componentes e a `obs` é explícita: *"Concatenar município, UF
  // e País"*. Montávamos `xLocIncid + cPaisResult`, e `xLocIncid` traz SÓ O NOME — o resultado saía
  // "Rio de Janeiro / -", com o traço do PAÍS ausente parecendo a UF faltando.
  it("resolve a UF pelo `cLocIncid` / `cLocPrestacao`", () => {
    const { valores } = lerNfse(xmlBase, { municipios: MUNICIPIOS_DE_TESTE });
    expect(valores.locIncid).toMatch(/^Rio de Janeiro \/ RJ \//);
    expect(valores.locPrest).toMatch(/^Rio de Janeiro \/ RJ \//);
  });

  // ⚠ O traço final é o PAÍS, e a nota 12 manda marcá-lo. Ele não é a UF faltando.
  it("o país ausente continua saindo como traço — nota 12", () => {
    const { valores } = lerNfse(xmlBase, { municipios: MUNICIPIOS_DE_TESTE });
    expect(valores.locIncid.split(" / ")).toHaveLength(3);
    expect(valores.locIncid.split(" / ")[2]).toBe("-");
  });

  // ⚠ Sem a lista, ou com código fora dela, cai no nome cru: o nome sozinho é melhor que nada e
  // nunca é uma UF inventada. Mesma disciplina do `rotuloMunicipioIbge` (7 dígitos, sem padding).
  it("sem a lista do IBGE cai no nome cru, nunca numa UF inventada", () => {
    const { valores } = lerNfse(xmlBase, { municipios: null });
    expect(valores.locIncid).toBe("Rio de Janeiro / -");
  });
});
