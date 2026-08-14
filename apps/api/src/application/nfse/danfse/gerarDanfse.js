// GERADOR DO DANFSe — pdfkit, uma página, retrato, coordenadas da NT 008 §2.4.5.
//
// A API oficial (`adn.nfse.gov.br/danfse`) foi SOBRESTADA em 03/08/2026 e a própria NT diz que é
// por isso: ela "servirá de base para a geração do DANFSe por meios de softwares de emissão de
// NFS-e, ERPs e sistemas fiscais, motivo pelo qual a API será sobrestada". Sem PDF, o cliente não
// tem o que mandar ao tomador.
//
// ⚠ A ENTRADA É O XML, POR PARÂMETRO. Nada aqui lê banco, chama ADN/SEFAZ/SERPRO ou emite coisa
// alguma. Isso é de propósito: a conferência contra as notas REAIS capturadas
// (`PortalInvoice.xmlRaw`) é o próximo passo e é do dono — este módulo já está pronto para ela,
// basta passar o XML.
//
// ⚠ REUSA O `pdfkit` QUE JÁ EXISTE (única dependência de PDF do repo, hoje usada em `routes/adn.js`
// para despejar XML em Courier 8pt). A ÚNICA dependência acrescentada é `qrcode` (node-qrcode),
// escolhida pelo dono: devolve PNG em Buffer e não tem binding nativo — o build é Docker/Railway.

import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import fs from "node:fs";
import {
  BLOCOS,
  FORMULARIO,
  TIPOGRAFIA,
  QR_CODE,
  TEXTOS,
  FONTE,
  CAMPOS_SEM_FONTE_NO_LEIAUTE_1_01,
  cm,
  urlDeConsulta,
} from "./danfseLeiaute.js";
import { lerNfse, valorParaImpressao } from "./danfseDados.js";

const A4 = Object.freeze({ larguraCm: 21.0, alturaCm: 29.7 });

// §2.2.2 — "no mínimo 0,15cm e no máximo 0,20cm em cada lateral".
//
// ⚠ TEM DE SER 0,15 E NÃO 0,20, e a conta é fechada: o bloco mais largo vai de `esq` 0,30 até
// 0,30 + 20,40 = 20,70 cm a partir da margem. Com margem 0,20 a borda direita cairia em 20,90 cm,
// deixando 0,10 cm de folga — MENOS que o mínimo de 0,15 que a mesma regra exige do outro lado.
// Só 0,15 fecha simétrico: 0,15 + 20,70 + 0,15 = 21,00 cm, a largura exata do A4.
const MARGEM_CM = 0.15;

const LARGURA_MAXIMA_CORPO_CM = 20.7; // esq 0,30 + larg 20,40

/** Converte coordenada "em relação à margem" (unidade da NT) em ponto absoluto na página. */
function px(valorCm) {
  return cm(MARGEM_CM + Number(valorCm));
}

/** Extensão vertical natural de um bloco, em cm a partir da margem. */
function extensaoDoBloco(bloco) {
  const fundos = [bloco.sup + bloco.alt, ...bloco.campos.map((c) => c.sup + c.alt)];
  return { topo: bloco.sup, fundo: Math.max(...fundos) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Fontes (§2.4)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Registra Arial e Microsoft Sans Serif se os .ttf forem fornecidos.
 *
 * ⚠ Sem elas o pdfkit só tem as 14 fontes padrão do PDF, e o render cai em Helvetica. Isso é uma
 * NÃO CONFORMIDADE com o §2.4, que nomeia as duas famílias — por isso ela é REPORTADA, nunca
 * silenciada. Substituir por "parecida" sem dizer é o tipo de omissão que este projeto trata como
 * defeito.
 */
function registrarFontes(doc, fontes, avisos) {
  const nomes = { titulo: "Helvetica", tituloBold: "Helvetica-Bold", conteudo: "Helvetica" };

  const carregar = (caminho, apelido) => {
    if (!caminho) return false;
    try {
      if (!fs.existsSync(caminho)) return false;
      doc.registerFont(apelido, caminho);
      return true;
    } catch {
      return false;
    }
  };

  if (carregar(fontes?.arial, "Arial")) nomes.titulo = "Arial";
  if (carregar(fontes?.arialBold, "Arial-Bold")) nomes.tituloBold = "Arial-Bold";
  if (carregar(fontes?.msSansSerif, "MSSansSerif")) nomes.conteudo = "MSSansSerif";

  if (nomes.tituloBold !== "Arial-Bold" || nomes.conteudo !== "MSSansSerif") {
    avisos.push(
      `NT §2.4 exige Arial (títulos) e Microsoft Sans Serif (conteúdos). Os .ttf não foram ` +
      `fornecidos e o documento saiu em Helvetica. ${TIPOGRAFIA.observacaoFontes}`
    );
  }
  return nomes;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Primitivas de desenho
// ─────────────────────────────────────────────────────────────────────────────────────────────

function celula(doc, { esq, sup, larg, alt, sombreado }) {
  const x = px(esq);
  const y = px(sup);
  const w = cm(larg);
  const h = cm(alt);
  if (sombreado) {
    // §2.2.3 — cinza claro, 5% de densidade.
    doc.save().rect(x, y, w, h).fill("#F2F2F2").restore();
  }
  doc.save()
    .lineWidth(FORMULARIO.espessuraLinhaDivisoriaPt)
    .rect(x, y, w, h)
    .stroke("#000000")
    .restore();
  return { x, y, w, h };
}

function escreverLabel(doc, texto, { x, y, w }, { fonte, tamanho }) {
  doc.font(fonte).fontSize(tamanho).fillColor(TIPOGRAFIA.cor);
  doc.text(String(texto), x + 2, y + 1.5, { width: w - 4, height: tamanho + 2, lineBreak: false, ellipsis: true });
}

function escreverConteudo(doc, texto, { x, y, w, h }, fonteConteudo, opcoes = {}) {
  doc.font(fonteConteudo).fontSize(opcoes.tamanho || TIPOGRAFIA.conteudoPt).fillColor(TIPOGRAFIA.cor);
  const topo = y + (opcoes.topo != null ? opcoes.topo : 8);
  doc.text(String(texto), x + 2, topo, {
    width: w - 4,
    height: Math.max(0, h - (topo - y) - 1),
    lineBreak: opcoes.multilinha === true,
    ellipsis: true,
    align: opcoes.align || "left",
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Cabeçalho (§2.4.3)
// ─────────────────────────────────────────────────────────────────────────────────────────────

function desenharCabecalho(doc, dados, fontes, opcoes, conformidade) {
  const bloco = BLOCOS.find((b) => b.id === "cabecalho");
  const caixa = celula(doc, { ...bloco, sombreado: true });

  const logo = bloco.campos.find((c) => c.id === "logomarca");
  const logoCaixa = celula(doc, { ...logo, sombreado: true });
  if (opcoes.logoPng && fs.existsSync(opcoes.logoPng)) {
    doc.image(opcoes.logoPng, logoCaixa.x + 2, logoCaixa.y + 2, {
      fit: [logoCaixa.w - 4, logoCaixa.h - 4],
      align: "center", valign: "center",
    });
  } else {
    // ⚠ NÃO DESENHAMOS UM LOGO IMITANDO O OFICIAL. A NT dá a URL do arquivo (§2.4.3) e ele não
    // está versionado no repo; um desenho "parecido" seria marca fabricada num documento fiscal.
    conformidade.avisos.push(
      "Logomarca oficial da NFS-e ausente. A NT §2.4.3 aponta o arquivo em " +
      "gov.br/nfse/.../logos-da-nfs-e/. Baixar e versionar em docs/leiaute-nfse/ e passar em `logoPng`."
    );
    escreverConteudo(doc, "[LOGOMARCA NFS-e]", logoCaixa, fontes.conteudo, { tamanho: 6, topo: logoCaixa.h / 2 - 3, align: "center" });
  }

  const quadro = bloco.campos.find((c) => c.id === "quadroDescricao");
  const quadroCaixa = celula(doc, { ...quadro, sombreado: true });
  doc.font(fontes.tituloBold).fontSize(TIPOGRAFIA.cabecalhoTituloPt).fillColor(TIPOGRAFIA.cor);
  doc.text(TEXTOS.tituloCabecalho, quadroCaixa.x, quadroCaixa.y + 4, { width: quadroCaixa.w, align: "center", lineBreak: false });
  doc.text(TEXTOS.subtituloCabecalho, quadroCaixa.x, quadroCaixa.y + 15, { width: quadroCaixa.w, align: "center", lineBreak: false });

  // §2 e §2.4.3 — tpAmb = 2 obriga a expressão, em vermelho sólido, abaixo do subtítulo.
  if (dados.meta.homologacao) {
    doc.font(fontes.tituloBold)
      .fontSize(TIPOGRAFIA.semValidadeJuridicaPt)
      .fillColor(TIPOGRAFIA.semValidadeJuridicaCor);
    doc.text(TEXTOS.semValidadeJuridica, quadroCaixa.x, quadroCaixa.y + 26, {
      width: quadroCaixa.w, align: "center", lineBreak: false,
    });
    doc.fillColor(TIPOGRAFIA.cor);
  }

  const ident = bloco.campos.find((c) => c.id === "quadroIdentMunicipio");
  const identCaixa = celula(doc, { ...ident, sombreado: true });
  const municipio = dados.valores.municipio;
  if (municipio) {
    doc.font(fontes.conteudo).fontSize(TIPOGRAFIA.cabecalhoMunicipioPt).fillColor(TIPOGRAFIA.cor);
    doc.text(`Município: ${municipio}`, identCaixa.x + 2, identCaixa.y + 3, { width: identCaixa.w - 4, lineBreak: false, ellipsis: true });
  }
  // §2.4.5 posiciona os dois em `sup` 0,97 e 1,22, na mesma coluna do município (esq 15,62).
  const ambGer = bloco.campos.find((c) => c.id === "ambGer");
  const tpAmb = bloco.campos.find((c) => c.id === "tpAmb");
  doc.font(fontes.conteudo).fontSize(TIPOGRAFIA.cabecalhoAmbientePt).fillColor(TIPOGRAFIA.cor);
  doc.text(`Ambiente gerador: ${dados.valores.ambGer ?? "-"}`, px(ambGer.esq) + 2, px(ambGer.sup), {
    width: cm(ambGer.larg) - 4, lineBreak: false, ellipsis: true,
  });
  doc.text(`Tipo de ambiente: ${dados.valores.tpAmb ?? "-"}`, px(tpAmb.esq) + 2, px(tpAmb.sup), {
    width: cm(tpAmb.larg) - 4, lineBreak: false, ellipsis: true,
  });

  return caixa;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// QR Code (§2.4.3)
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ⚠ O NÍVEL DE CORREÇÃO DE ERRO **NÃO É FIXADO PELA NT**, e isto foi conferido no documento
// versionado: §2, §2.2, §2.4.3 e a tabela do §2.4.5 falam de tamanho mínimo (1,52 × 1,52 cm),
// posição (X 17,48 / Y 1,67), conteúdo (a URL + a chave) e do texto complementar — e de nada mais.
// A única exigência sobre a LEITURA é a do §2.2: "desde que seja garantido o contraste necessário
// para assegurar leitura do código de barras bidimensional (QR Code) sem problemas". Nível, tamanho
// de módulo e zona de silêncio ficam por nossa conta, e por isso a escolha vai escrita aqui.
//
// A escolha é **M**, e a conta que a sustenta (payload real: 53 caracteres de URL + 50 dígitos de
// chave = 103; o node-qrcode segmenta os 50 dígitos em modo numérico):
//
//   nível | versão | módulos | módulo dentro dos 1,52 cm | dano tolerado
//   ------|--------|---------|---------------------------|--------------
//     L   |    4   |   33    |          0,46 mm          |     ~7%
//     M   |    5   |   37    |          0,41 mm          |    ~15%
//     Q   |    7   |   45    |          0,34 mm          |    ~25%
//     H   |    8   |   49    |          0,31 mm          |    ~30%
//
// O envelope é FIXO em 1,52 cm (é o mínimo da NT e o quadro do leiaute não tem para onde crescer:
// o complemento começa em Y 3,36). Logo, subir o nível **encolhe o módulo** — compra-se redundância
// pagando com resolução. Contra o risco que de fato existe num DANFSe (impressora laser comum,
// leitura por câmera de celular a distância de mão), módulo menor é piora certa e permanente;
// rasgo/mancha é risco eventual. Por isso não vai a Q nem a H. E não fica em L porque o documento
// é impresso, dobrado, fotocopiado e fotografado: os ~15% de M custam 0,05 mm de módulo, que é
// barato. Se o dono preferir outro nível, é uma linha — e a tabela acima diz o que se ganha e o
// que se perde.
const QR_NIVEL_CORRECAO = "M";

// Pixels por módulo no PNG. 37 módulos × 10 = 370 px em 1,52 cm = 618 dpi — logo acima dos 600 dpi
// de uma impressora laser comum, que é o alvo real; resolução além disso o dispositivo não usa e
// custa tempo de geração (o `toBuffer` do node-qrcode empacota o PNG LINHA A LINHA por um stream
// de zlib, então o custo é proporcional à altura em pixels: medido dentro do jest, 0,86 s a 296 px,
// 1,4 s a 370 px e 3,2 s a 592 px — em node puro os mesmos casos ficam abaixo de 50 ms).
const QR_PIXELS_POR_MODULO = 10;

/**
 * Renderiza o PNG do QR Code.
 *
 * ⚠ `margin: 0` DE PROPÓSITO. A zona de silêncio existe (é exigência da ISO/IEC 18004, não da NT),
 * mas ela NÃO pode sair de dentro dos 1,52 cm: o mínimo da NT é do próprio QR Code, e uma margem
 * embutida no PNG faria o símbolo encolher para 1,25 cm — abaixo do mínimo — e o módulo junto com
 * ele. Aqui o símbolo ocupa os 1,52 cm inteiros e a zona de silêncio é pintada NA PÁGINA, no espaço
 * que o próprio leiaute deixa vazio em volta do quadro (ver `desenharQrCode`).
 *
 * Preto sólido sobre branco: §2.4 manda K100, e §2.2 manda garantir contraste.
 *
 * ⚠ `colorType: 0` — TONS DE CINZA, SEM CANAL ALFA. Um QR Code é preto sobre branco; alfa nele é
 * dado que não existe. E não é só arrumação: com alfa o pdfkit tem de DECODIFICAR a imagem em JS
 * (`splitAlphaChannel`, um laço sobre todos os pixels) e reescrevê-la com uma `SMask`; sem alfa ele
 * repassa o IDAT direto. Medido nesta máquina: embutir uma imagem de 888 × 888 caiu de 153 ms para
 * 7 ms, e o DANFSe da amostra saiu de 33,4 KB (RGBA) para **7,4 KB**.
 */
async function renderizarQrCodePng(url) {
  return QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: QR_NIVEL_CORRECAO,
    margin: 0,
    scale: QR_PIXELS_POR_MODULO,
    color: { dark: "#000000ff", light: "#ffffffff" },
    rendererOpts: { colorType: 0 },
  });
}

function desenharQrCode(doc, dados, fontes, opcoes, conformidade) {
  const bloco = BLOCOS.find((b) => b.id === "identificacao");
  const quadro = bloco.campos.find((c) => c.id === "quadroQrCode");
  const complemento = bloco.campos.find((c) => c.id === "quadroComplementoQrCode");

  // O complemento vem ANTES do QR de propósito: a borda de 0,5 pt desta célula encosta na zona de
  // silêncio, e quem tem de vencer é o QR (§2.2 faz da leitura dele requisito; a linha divisória é
  // §2.2.3, e o que ela perde é um fio de 0,09 mm no topo).
  const compCaixa = celula(doc, complemento);
  doc.font(fontes.conteudo).fontSize(TIPOGRAFIA.complementoQrCodePt).fillColor(TIPOGRAFIA.cor);
  doc.text(QR_CODE.textoComplementar, compCaixa.x + 2, compCaixa.y + 2, {
    width: compCaixa.w - 4, height: compCaixa.h - 3, align: "center", ellipsis: true,
  });

  // ⚠ ZONA DE SILÊNCIO PINTADA NA PÁGINA, e a medida sai do LEIAUTE, não de estimativa: o espaço
  // livre acima do quadro é `quadro.sup - bloco.sup` e o abaixo é `complemento.sup - fundo do
  // quadro`. O menor dos dois é a folga que a diagramação da NT realmente oferece.
  const folgaAcimaCm = quadro.sup - bloco.sup;
  const folgaAbaixoCm = complemento.sup - (quadro.sup + quadro.alt);
  const zonaCm = Math.min(folgaAcimaCm, folgaAbaixoCm);

  // ⚠ E ELA É BRANCA POR NECESSIDADE, NÃO POR ESTÉTICA. O título do bloco "DADOS DA NFS-e" é
  // pintado em cinza 5% sobre toda a faixa (§2.2.3 aplicado ao bloco inteiro por este gerador), e
  // cinza encostado nos módulos é exatamente o que o §2.2 proíbe: "contraste necessário para
  // assegurar leitura ... sem problemas". Nada de borda preta em volta do quadro, pelo mesmo motivo.
  doc.save()
    .rect(px(quadro.esq - zonaCm), px(quadro.sup - zonaCm),
          cm(quadro.larg + 2 * zonaCm), cm(quadro.alt + 2 * zonaCm))
    .fill("#FFFFFF")
    .restore();

  // O símbolo ocupa os 1,52 × 1,52 cm inteiros — o mínimo da NT §2.4.3, medido no símbolo.
  doc.image(opcoes.qrCodePng, px(quadro.esq), px(quadro.sup), {
    width: cm(quadro.larg), height: cm(quadro.alt),
  });

  conformidade.qrCode = "presente";
  const moduloCm = quadro.larg / opcoes.qrModulos;
  conformidade.qrCodeTecnico = {
    nivelCorrecaoErro: QR_NIVEL_CORRECAO,
    versao: opcoes.qrVersao,
    modulos: opcoes.qrModulos,
    ladoCm: quadro.larg,
    moduloMm: Number((moduloCm * 10).toFixed(3)),
    zonaDeSilencioCm: Number(zonaCm.toFixed(3)),
    zonaDeSilencioModulos: Number((zonaCm / moduloCm).toFixed(2)),
    // ⚠ A NT NÃO FIXA nível de correção, tamanho de módulo nem zona de silêncio — conferido no
    // documento versionado (§2, §2.2, §2.4.3 e tabela §2.4.5). O que ela fixa é tamanho mínimo,
    // posição, conteúdo e contraste. Estes números são NOSSA escolha, e ficam declarados.
    fixadoPelaNt: false,
  };
  if (conformidade.qrCodeTecnico.zonaDeSilencioModulos < 4) {
    conformidade.avisos.push(
      `Zona de silêncio do QR Code com ${conformidade.qrCodeTecnico.zonaDeSilencioModulos} módulos — ` +
      "a ISO/IEC 18004 pede 4. O espaço livre em volta do quadro no leiaute da NT não comporta mais."
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Marca d'água (§2.5.1 / §2.5.2)
// ─────────────────────────────────────────────────────────────────────────────────────────────

function desenharMarcaDagua(doc, texto, fontes) {
  const larguraPt = cm(A4.larguraCm);
  const alturaPt = cm(A4.alturaCm);
  doc.save();
  doc.rotate(-45, { origin: [larguraPt / 2, alturaPt / 2] });
  doc.font(fontes.titulo).fontSize(TIPOGRAFIA.marcaDaguaPtMinimo).fillColor(TIPOGRAFIA.marcaDaguaCor);
  doc.text(texto, 0, alturaPt / 2 - 30, { width: larguraPt, align: "center", lineBreak: false });
  doc.restore();
  doc.fillColor(TIPOGRAFIA.cor);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Gerador
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Gera o DANFSe de uma NFS-e.
 *
 * @param {object} params
 * @param {string} params.xml            XML da NFS-e (o documento que VOLTA, não a DPS).
 * @param {"CANCELADA"|"SUBSTITUIDA"|null} [params.marcaDagua]
 * @param {boolean} [params.incluirCanhoto=false]  Bloco opcional (nota 11).
 * @param {string} [params.logoPng]
 * @param {{arial,arialBold,msSansSerif}} [params.fontes]
 * @returns {Promise<{pdf: Buffer, conformidade: object}>}
 * @throws {Error} `DANFSE_SEM_QRCODE` quando o QR Code não pôde ser gerado. **Não há escape.**
 */
export async function gerarDanfse(params = {}) {
  const {
    xml,
    marcaDagua = null,
    incluirCanhoto = false,
    logoPng = null,
    fontes: arquivosDeFonte = null,
  } = params;

  const dados = lerNfse(xml);

  // ─── QR Code (§2.2 e §2.4.3) — obrigatório, e a falta dele CONTINUA sendo recusa ──────────────
  //
  // ⚠ A RECUSA NÃO FOI APAGADA quando a biblioteca entrou; ela só deixou de ser o caminho normal.
  // Um DANFSe servido em silêncio sem QR Code não é um DANFSe: o contador mandaria ao tomador um
  // documento inválido achando que mandou o certo. Ausência nunca é resposta.
  //
  // ⚠ E NÃO HÁ MAIS `permitirSemQrCode`. Ele existia para conferir layout enquanto não havia
  // biblioteca; hoje a conferência de layout se faz COM o QR, que é o layout de verdade. O que
  // sobraria dele era a única coisa que ele não pode fazer: servir o documento inválido justamente
  // quando ele é inválido.
  const urlDoQrCode = urlDeConsulta(dados.meta.chave);
  if (!urlDoQrCode) {
    const erro = new Error(
      "DANFSe exige QR Code (NT 008 §2.2 e §2.4.3) e o conteúdo dele é a URL de consulta MAIS a " +
      "chave de acesso — que este XML não traz (`infNFSe/@Id` ausente ou sem dígitos). Sem chave " +
      "não há QR Code, e sem QR Code não há DANFSe. Nada é fabricado para preencher."
    );
    erro.code = "DANFSE_SEM_QRCODE";
    erro.motivo = "chave_ausente";
    throw erro;
  }

  let qrCodePng;
  let qrSimbolo;
  try {
    // `create` primeiro: é o que informa versão e nº de módulos, e é o que prova, no relatório de
    // conformidade, o tamanho de módulo que foi impresso.
    qrSimbolo = QRCode.create(urlDoQrCode, { errorCorrectionLevel: QR_NIVEL_CORRECAO });
    qrCodePng = await renderizarQrCodePng(urlDoQrCode);
  } catch (causa) {
    const erro = new Error(
      "DANFSe exige QR Code (NT 008 §2.2 e §2.4.3) e a geração dele falhou: " +
      (causa?.message || String(causa)) + ". O documento NÃO é emitido sem o QR Code."
    );
    erro.code = "DANFSE_SEM_QRCODE";
    erro.motivo = "falha_na_biblioteca";
    erro.causa = causa;
    throw erro;
  }

  const conformidade = {
    fonte: FONTE,
    avisos: [...dados.avisos],
    qrCode: null,
    // §2.4.3 — o que EFETIVAMENTE foi codificado. É por aqui que se confere o QR sem decodificá-lo.
    conteudoDoQrCode: urlDoQrCode,
    qrCodeTecnico: null,
    camposAusentes: [],
    camposSemFonte: [],
    descricoesPendentes: [],
    municipiosNaoResolvidos: dados.meta.municipiosNaoResolvidos,
    blocosCondensados: [],
    paginas: null,
  };

  const doc = new PDFDocument({
    size: "A4",
    layout: "portrait",
    margin: 0,
    autoFirstPage: true,
    info: { Title: `DANFSe ${dados.meta.chave || ""}`.trim(), Producer: "portal-contabil" },
  });

  const fontes = registrarFontes(doc, arquivosDeFonte, conformidade.avisos);

  const pedacos = [];
  doc.on("data", (p) => pedacos.push(p));
  const pronto = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(pedacos)));
    doc.on("error", reject);
  });

  // §2.2.3 — borda da página com 1 ponto de espessura.
  doc.save()
    .lineWidth(FORMULARIO.espessuraBordaPaginaPt)
    .rect(px(0), px(0), cm(LARGURA_MAXIMA_CORPO_CM + 0.3), cm(A4.alturaCm - 2 * MARGEM_CM))
    .stroke("#000000")
    .restore();

  desenharCabecalho(doc, dados, fontes, { logoPng }, conformidade);

  // ─── Blocos, de cima para baixo, com deslocamento acumulado ───────────────────────────────
  //
  // §2.3: bloco não preenchido vira UMA linha de texto (altura mínima 0,32 cm) e "os campos
  // seguintes" são deslocados; a altura liberada vai para Descrição do Serviço e/ou Informações
  // Complementares. O acumulador abaixo é exatamente isso.
  let deslocamento = 0;

  const condensavel = {
    tomador: !dados.meta.tomadorIdentificado ? TEXTOS.tomadorNaoIdentificado : null,
    destinatario: !dados.meta.destinatarioIdentificado ? TEXTOS.destinatarioNaoIdentificado : null,
    intermediario: !dados.meta.intermediarioIdentificado ? TEXTOS.intermediarioNaoIdentificado : null,
  };

  for (const bloco of BLOCOS) {
    if (bloco.id === "cabecalho") continue;
    if (bloco.id === "canhoto" && !incluirCanhoto) continue;

    const { topo, fundo } = extensaoDoBloco(bloco);
    const alturaNatural = fundo - topo;
    const frase = condensavel[bloco.id];

    if (frase) {
      const alt = bloco.supressao.altMinima;
      const caixa = celula(doc, { esq: bloco.esq, sup: topo + deslocamento, larg: bloco.supressao.largMinima, alt });
      doc.font(fontes.tituloBold).fontSize(TIPOGRAFIA.tituloBlocoPt).fillColor(TIPOGRAFIA.cor);
      doc.text(frase, caixa.x + 2, caixa.y + 1.5, { width: caixa.w - 4, lineBreak: false, ellipsis: true });
      conformidade.blocosCondensados.push({ bloco: bloco.id, frase, notaDaNt: bloco.nota });
      deslocamento -= alturaNatural - alt;
      continue;
    }

    // Título do bloco. Nos blocos de largura 20,40 ele é a faixa inteira; nos de 5,09 ele ocupa a
    // primeira célula da linha e os campos seguem à direita — é assim que as coordenadas do
    // §2.4.5 se encaixam.
    const tituloCaixa = celula(doc, {
      esq: bloco.esq, sup: bloco.sup + deslocamento, larg: bloco.larg, alt: bloco.alt, sombreado: true,
    });
    doc.font(fontes.tituloBold).fontSize(TIPOGRAFIA.tituloBlocoPt).fillColor(TIPOGRAFIA.cor);
    doc.text(bloco.titulo, tituloCaixa.x + 2, tituloCaixa.y + 1.5, {
      width: tituloCaixa.w - 4, lineBreak: false, ellipsis: true,
    });

    for (const campo of bloco.campos) {
      if (campo.id === "quadroQrCode" || campo.id === "quadroComplementoQrCode") continue;

      let alt = campo.alt;
      // O bloco elástico (§2.3 e §2.5.3): Informações Complementares absorve tudo que sobra até o
      // canhoto — ou até onde o canhoto terminaria, quando ele é suprimido (§2.3.3).
      if (campo.id === "infoComplementares") {
        const canhoto = BLOCOS.find((b) => b.id === "canhoto");
        const limite = incluirCanhoto ? canhoto.sup : canhoto.sup + canhoto.alt;
        alt = Math.max(campo.alt, limite + deslocamento - (campo.sup + deslocamento) - 0.05);
      }

      const caixa = celula(doc, {
        esq: campo.esq, sup: campo.sup + deslocamento, larg: campo.larg, alt,
        sombreado: campo.sombreado === true,
      });

      if (!campo.semLabel) {
        escreverLabel(doc, campo.nome, caixa, {
          fonte: fontes.tituloBold,
          tamanho: bloco.labelsEmCaixaAlta7pt ? TIPOGRAFIA.tituloCampoIdentificacaoPt : TIPOGRAFIA.tituloCampoPt,
        });
      }

      if (campo.semFonteNoXml) continue; // canhoto: campos de preenchimento manual

      const { texto, ausente, descricaoPendente, motivo } = valorParaImpressao(campo, dados.valores);
      if (ausente) conformidade.camposAusentes.push(campo.id);
      if (descricaoPendente) conformidade.descricoesPendentes.push({ campo: campo.id, tag: campo.tag, motivo });
      if (CAMPOS_SEM_FONTE_NO_LEIAUTE_1_01.includes(campo.id) && ausente) {
        conformidade.camposSemFonte.push(campo.id);
      }

      const multilinha = campo.elastico === true || campo.id === "xTrib";
      escreverConteudo(doc, texto, caixa, fontes.conteudo, {
        multilinha,
        topo: campo.semLabel ? 2 : bloco.labelsEmCaixaAlta7pt ? 9 : 8,
      });
    }
  }

  if (marcaDagua === "CANCELADA") desenharMarcaDagua(doc, TEXTOS.marcaDaguaCancelada, fontes);
  if (marcaDagua === "SUBSTITUIDA") desenharMarcaDagua(doc, TEXTOS.marcaDaguaSubstituida, fontes);

  // ⚠ O QR CODE É O ÚLTIMO A SER PINTADO, E ISSO É DEFEITO CONSERTADO, NÃO PREFERÊNCIA.
  // PDF é pintor: quem vem depois cobre quem veio antes. O quadro do QR ficava desenhado ANTES do
  // laço dos blocos, e o título do bloco "DADOS DA NFS-e" (20,40 × 2,84 cm em 0,30/1,48, cinza 5%)
  // passa por cima dele inteiro — medido no content stream do PDF gerado: o fill do bloco vem
  // depois, e cobre os 1,52 × 1,52 cm do quadro. Com a biblioteca ligada, o QR sairia invisível,
  // e o `conformidade.qrCode = "presente"` continuaria dizendo que estava lá.
  // Pela mesma razão ele vem depois da marca d'água: o §2.5.1/§2.5.2 pede um carimbo diagonal
  // cinza K35 e o §2.2 pede contraste garantido para a leitura do QR — entre os dois, o que não
  // pode ceder é a leitura.
  desenharQrCode(doc, dados, fontes,
    { qrCodePng, qrModulos: qrSimbolo.modules.size, qrVersao: qrSimbolo.version }, conformidade);

  // ⚠ A marca d'água NÃO é derivada aqui, e isso é decisão, não esquecimento:
  //   • `cStat` diria a situação — mas a tabela de `cStat` está no leiaute, que não está no repo
  //     (mesmo buraco de `danfseDescricoes.js`);
  //   • `chSubstda` (presente no XML da nota) significa "EU SUBSTITUO AQUELA", não "eu fui
  //     substituída" — carimbar SUBSTITUÍDA por causa dele inverteria os dois lados do vínculo,
  //     que é exatamente o defeito que o `NotaDetailModal` já teve (CLAUDE.md da raiz).
  //   Quem sabe a situação é o ciclo da nota (`application/notas/cicloNota.js`), e quem a passa é
  //   o chamador.
  if (dados.meta.chaveSubstituida && !marcaDagua) {
    conformidade.avisos.push(
      "Esta NFS-e SUBSTITUI a chave " + dados.meta.chaveSubstituida + " (grupo `subst/chSubstda`). " +
      "Isso não a torna 'substituída' — nenhuma marca d'água foi aplicada. A marca d'água é " +
      "parâmetro do chamador, que é quem conhece o ciclo da nota."
    );
  }

  doc.end();
  const pdf = await pronto;

  // ⚠ VERIFICAÇÃO EXECUTADA, NÃO AFIRMADA: conta as páginas no PDF gerado. §2.2 exige UMA.
  const paginas = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  conformidade.paginas = paginas;
  if (paginas !== 1) {
    conformidade.avisos.push(`DANFSe saiu com ${paginas} páginas — a NT §2.2 exige uma única página.`);
  }

  return { pdf, conformidade };
}
