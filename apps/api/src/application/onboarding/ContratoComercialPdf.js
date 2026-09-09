import PDFDocument from "pdfkit";
export async function gerarContratoPdf(contrato) {
  const doc = new PDFDocument({
    size: "A4",
    margins: {
      top: 48,
      left: 48,
      right: 48,
      bottom: 48
    },
    info: {
      Title: "Contrato de serviços — ALTAN"
    }
  });
  const chunks = [],
    pronto = new Promise((resolve, reject) => {
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
  doc.font("Helvetica").fontSize(9).fillColor("#555555").text(`ALTAN · ${contrato.status} · Documento ${contrato.id}`, {
    paragraphGap: 12
  });
  doc.fillColor("#111111").fontSize(11).text(contrato.texto, {
    lineGap: 3,
    paragraphGap: 6
  });
  doc.end();
  return pronto;
}
