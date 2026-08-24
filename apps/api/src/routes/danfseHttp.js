// OS DESFECHOS HTTP DO DANFSe — as MESMAS respostas nas duas portas.
//
// ⚠ ESTE ARQUIVO NÃO VALIDA E NÃO DECIDE NADA — só traduz para HTTP. É o mesmo desenho de
// `nfseEmissaoHttp.js`, criado pelo mesmo motivo: quando o app do cliente ganhou a porta de
// emissão, o mapa de desfechos saiu de dentro da rota do escritório para um módulo consumido pelas
// DUAS portas, para que elas não pudessem discordar na primeira correção.
//
// Quem decide continua sendo `application/nfse/danfse/danfseDaNotaDoPortal.js`.

/** O status de cada recusa nomeada. Ausência aqui ⇒ o erro SOBE (500 do handler), como antes. */
const RECUSAS = Object.freeze({
  // A nota não é desta empresa (ou não existe). Mesma resposta dos dois lados.
  DANFSE_NOTA_NAO_ENCONTRADA: { status: 404, error: "nota_nao_encontrada" },
  // O "arquivo ausente" dos precedentes (PGDAS/SITFIS) vira aqui "XML ausente", respondido com a
  // mesma honestidade: 404 dizendo QUAL é a falta.
  DANFSE_XML_INDISPONIVEL: { status: 404, error: "xml_indisponivel" },
  // ⚠⚠ 503 E NÃO 200-COM-PDF-TORTO. O QR Code é obrigatório (NT 008 §2.2 e §2.4.3) e ausência não
  // é resposta: um DANFSe sem QR Code não é um DANFSe, e servi-lo em silêncio faria o tomador
  // receber um documento inválido. ⚠ Do lado da TELA a regra é a mesma: pintar isto como "falha ao
  // baixar", ou não pintar nada, esconde justamente o que este 503 existe para dizer.
  DANFSE_SEM_QRCODE: { status: 503, error: "danfse_sem_qrcode" },
  DANFSE_XML_NAO_E_NFSE: { status: 422, error: "xml_nao_e_nfse" },
  DANFSE_XML_VAZIO: { status: 422, error: "xml_nao_e_nfse" },
  // ⚠⚠ CÓDIGO PRÓPRIO, E NÃO O `xml_nao_e_nfse` ACIMA — o conserto é OUTRO. Este é a nota que NÓS
  // emitimos e o sistema nacional RECUSOU: o que está guardado é a DPS (o pedido), porque
  // `NfseService.js:1775` grava `nfseXmlGZipB64 || rawXml`. O genérico mandaria o cliente procurar
  // defeito na captura ou no nosso extrator; a verdade é que **não existe nota** para documentar.
  // 422 pela mesma razão dos vizinhos: é fato sobre a NOTA, não falha do servidor.
  DANFSE_XML_E_O_PEDIDO: { status: 422, error: "nota_nao_autorizada" },
});

/**
 * O PDF, com os cabeçalhos que a tela e quem baixa esperam.
 *
 * ⚠ `X-Danfse-Conforme` NÃO existe, e não voltar é mais honesto que voltar: ele afirmava
 * conformidade do DOCUMENTO respondendo apenas sobre o QR Code. As pendências reais viajam em
 * `X-Danfse-Pendencias`.
 */
export function responderDanfse(res, { pdf, conformidade, nomeArquivo }) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${nomeArquivo}"`);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Danfse-Qrcode", String(conformidade.qrCode));
  res.setHeader("X-Danfse-Pendencias", String(conformidade.avisos.length));
  res.setHeader("X-Danfse-Paginas", String(conformidade.paginas));
  return res.send(pdf);
}

/**
 * A recusa, com o MOTIVO por extenso.
 *
 * ⚠ A MENSAGEM VEM DO ERRO, não daqui: ela já foi escrita onde a decisão foi tomada. Um texto
 * genérico neste ponto apagaria a diferença entre "esta nota não tem XML" e "o QR não pôde ser
 * gerado" — que é a informação inteira.
 *
 * @returns {boolean} `false` quando o erro não é uma recusa conhecida (o chamador deve relançar).
 */
export function responderErroDanfse(res, err) {
  const recusa = RECUSAS[String(err?.code || "")];
  if (!recusa) return false;
  res.status(recusa.status).json({
    ok: false,
    error: recusa.error,
    message: err?.message || null,
    ...(err?.motivo != null ? { motivo: err.motivo } : {}),
  });
  return true;
}
