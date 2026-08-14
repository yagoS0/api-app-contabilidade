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
// para despejar XML em Courier 8pt). Nenhuma dependência nova foi acrescentada — ver
// `conformidade.dependenciaFaltante` para o QR Code.

import PDFDocument from "pdfkit";
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

function desenharQrCode(doc, dados, fontes, opcoes, conformidade) {
  const bloco = BLOCOS.find((b) => b.id === "identificacao");
  const quadro = bloco.campos.find((c) => c.id === "quadroQrCode");
  const complemento = bloco.campos.find((c) => c.id === "quadroComplementoQrCode");

  const caixa = celula(doc, quadro);
  const url = urlDeConsulta(dados.meta.chave);
  conformidade.conteudoDoQrCode = url;

  if (opcoes.qrCodePng) {
    doc.image(opcoes.qrCodePng, caixa.x + 1, caixa.y + 1, { fit: [caixa.w - 2, caixa.h - 2] });
    conformidade.qrCode = "presente";
  } else {
    // ⚠ O QR Code é OBRIGATÓRIO (§2.2 e §2.4.3). Sem ele o documento NÃO é um DANFSe conforme —
    // e um retângulo branco em silêncio se pareceria com um QR que não imprimiu. A marca é
    // deliberadamente feia para que ninguém confunda o resultado com um documento válido.
    doc.save().rect(caixa.x, caixa.y, caixa.w, caixa.h).fill("#FFF2F2").restore();
    doc.save().lineWidth(0.5).rect(caixa.x, caixa.y, caixa.w, caixa.h).stroke("#000000").restore();
    doc.font(fontes.tituloBold).fontSize(5).fillColor("#CC0000");
    doc.text("QR CODE\nAUSENTE\n(dependência\nnão instalada)", caixa.x + 1, caixa.y + 6, {
      width: caixa.w - 2, align: "center",
    });
    doc.fillColor(TIPOGRAFIA.cor);
    conformidade.qrCode = "ausente";
  }

  const compCaixa = celula(doc, complemento);
  doc.font(fontes.conteudo).fontSize(TIPOGRAFIA.complementoQrCodePt).fillColor(TIPOGRAFIA.cor);
  doc.text(QR_CODE.textoComplementar, compCaixa.x + 2, compCaixa.y + 2, {
    width: compCaixa.w - 4, height: compCaixa.h - 3, align: "center", ellipsis: true,
  });
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
 * @param {Buffer|string} [params.qrCodePng]  PNG do QR Code já renderizado. **Obrigatório** para
 *   produzir um DANFSe conforme — este módulo NÃO gera o QR (ver `dependenciaFaltante`).
 * @param {boolean} [params.permitirSemQrCode=false]  Escape explícito para conferência de layout.
 * @param {"CANCELADA"|"SUBSTITUIDA"|null} [params.marcaDagua]
 * @param {boolean} [params.incluirCanhoto=false]  Bloco opcional (nota 11).
 * @param {string} [params.logoPng]
 * @param {{arial,arialBold,msSansSerif}} [params.fontes]
 * @returns {Promise<{pdf: Buffer, conformidade: object}>}
 */
export async function gerarDanfse(params = {}) {
  const {
    xml,
    qrCodePng = null,
    permitirSemQrCode = false,
    marcaDagua = null,
    incluirCanhoto = false,
    logoPng = null,
    fontes: arquivosDeFonte = null,
  } = params;

  if (!qrCodePng && !permitirSemQrCode) {
    // ⚠ RECUSA, no molde de `dpsCodigos.js`: o que não se sabe fazer não sai por aproximação.
    // O QR Code é obrigatório na NT §2.2/§2.4.3 e o projeto NÃO TEM biblioteca para gerá-lo.
    const erro = new Error(
      "DANFSe exige QR Code (NT 008 §2.2 e §2.4.3) e este projeto não tem biblioteca de QR Code. " +
      "Passe `qrCodePng` com a imagem já renderizada, ou `permitirSemQrCode: true` para conferir " +
      "layout — o documento resultante NÃO é um DANFSe válido."
    );
    erro.code = "DANFSE_SEM_QRCODE";
    throw erro;
  }

  const dados = lerNfse(xml);

  const conformidade = {
    fonte: FONTE,
    avisos: [...dados.avisos],
    qrCode: null,
    conteudoDoQrCode: null,
    camposAusentes: [],
    camposSemFonte: [],
    descricoesPendentes: [],
    municipiosNaoResolvidos: dados.meta.municipiosNaoResolvidos,
    blocosCondensados: [],
    paginas: null,
    dependenciaFaltante: qrCodePng
      ? null
      : {
          para: "QR Code (NT 008 §2.4.3, obrigatório)",
          conteudoQueSeriaCodificado: urlDeConsulta(dados.meta.chave),
          observacao:
            "Nenhuma biblioteca de QR Code existe no projeto. A escolha da dependência é do dono " +
            "(o projeto proíbe dependência nova sem necessidade clara — aqui a necessidade é clara, " +
            "a escolha não).",
        },
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
  desenharQrCode(doc, dados, fontes, { qrCodePng }, conformidade);

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
