import PDFDocument from "pdfkit";

// Presentation of the saved parser output, never a new fiscal query or a new total.
export function gerarPdfSitfisTabela({ relatorio, empresa, consultadaEm, relatorioDe }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32 });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = 32, width = doc.page.width - 64, bottom = doc.page.height - 38;
    let page = 0;
    function header() {
      page += 1;
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#202b40")
        .text("Situação fiscal — última consulta", left, 28, { width });
      doc.font("Helvetica").fontSize(9).fillColor("#333333")
        .text(`${empresa?.razao || relatorio.contribuinte?.nome || "Empresa"} · CNPJ ${empresa?.cnpj || relatorio.contribuinte?.cnpj || "não informado"}`, { width })
        .text(`Consulta: ${consultadaEm || "não informada"} · Relatório: ${relatorioDe || relatorio.emitidoEm || "não informado"} · Página ${page}`, { width })
        .text("Apresentação dos dados salvos no aplicativo. Não substitui o documento oficial da Receita Federal.", { width });
      doc.moveDown(.7);
    }
    doc.on("pageAdded", header);
    header();
    function paragraph(text, bold = false) {
      if (doc.y > bottom - (bold ? 75 : 30)) doc.addPage();
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9)
        .text(String(text ?? ""), left, doc.y, { width }).moveDown(.4);
    }
    function lines(value, cellWidth) {
      // Wrap even long identifiers instead of clipping or shrinking text indefinitely.
      const result = [];
      for (const paragraph of String(value ?? "—").split(/\r?\n/)) {
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
          if (line && doc.widthOfString(line + " " + word) > cellWidth) { result.push(line); line = ""; }
          if (doc.widthOfString(word) <= cellWidth) line += (line ? " " : "") + word;
          else for (const char of word) {
            if (line && doc.widthOfString(line + char) > cellWidth) { result.push(line); line = ""; }
            line += char;
          }
        }
        result.push(line);
      }
      return result;
    }
    function table(columns, records) {
      const cellWidth = width / columns.length;
      const lineHeight = 11;
      function drawRow(cells, height, heading = false) {
        const y = doc.y;
        cells.forEach((cell, index) => {
          const x = left + index * cellWidth;
          doc.rect(x, y, cellWidth, height).fillAndStroke(heading ? "#e8edf5" : "#ffffff", "#c5ccd5");
          cell.forEach((line, lineIndex) => doc.fillColor("#202b40").text(line, x + 4, y + 4 + lineIndex * lineHeight,
            { width: cellWidth - 8, lineBreak: false }));
        });
        doc.y = y + height;
      }
      function tableHeader() {
        doc.font("Helvetica-Bold").fontSize(8);
        const cells = columns.map(c => lines(c, cellWidth - 8));
        drawRow(cells, Math.max(...cells.map(c => c.length)) * lineHeight + 8, true);
        doc.font("Helvetica").fontSize(8);
      }
      if (doc.y > bottom - 75) doc.addPage();
      tableHeader();
      for (const record of records) {
        const cells = columns.map(c => lines(record[c], cellWidth - 8));
        let offset = 0;
        const count = Math.max(...cells.map(c => c.length));
        if (count * lineHeight + 8 > bottom - doc.y && count * lineHeight + 8 < bottom - 150) {
          doc.addPage(); tableHeader();
        }
        while (offset < count) {
          let capacity = Math.floor((bottom - doc.y - 8) / lineHeight);
          if (capacity < 1) { doc.addPage(); tableHeader(); capacity = Math.floor((bottom - doc.y - 8) / lineHeight); }
          const take = Math.min(count - offset, capacity);
          drawRow(cells.map(c => c.slice(offset, offset + take)), take * lineHeight + 8);
          offset += take;
        }
      }
      doc.y += 10;
    }
    try {
      for (const diagnostic of relatorio.diagnosticos || []) {
        paragraph(diagnostic.orgao, true);
        if (diagnostic.semPendencia) paragraph("Sem pendência indicada no relatório salvo.");
        for (const block of diagnostic.blocos || []) {
          paragraph(block.titulo, true);
          if (block.descricao) paragraph(Array.isArray(block.descricao) ? block.descricao.join("\n") : block.descricao);
          if (block.colunas?.length && block.registros?.length) table(block.colunas, block.registros);
          if (block.colunas?.includes("Sdo. Dev. Cons.") && block.registros?.length > 1) {
            const values = block.registros.map(r => String(r["Sdo. Dev. Cons."] ?? "").trim());
            if (values.every(v => /^-?[\d.]+,\d{2}$/.test(v))) {
              const sum = values.reduce((total, v) => total + Number(v.replace(/\./g, "").replace(",", ".")), 0);
              if (Number.isFinite(sum)) paragraph(`Total calculado pelo aplicativo (${values.length} pendências): ${sum.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`);
            }
          }
          if (block.aviso) paragraph(block.aviso);
          const annotations = [...(block.anotacoes || [])];
          for (const [index, record] of (block.anotacoesPorRegistro || []).entries()) {
            for (const [label, value] of Object.entries(record || {})) {
              paragraph(`Registro ${index + 1} · ${label}: ${value}`);
              const found = annotations.indexOf(value);
              if (found >= 0) annotations.splice(found, 1);
            }
          }
          if (annotations.length) paragraph(`Notificação de lançamento: ${annotations.join(" · ")}`);
          if (block.naoInterpretado?.length) {
            paragraph("Trecho sem alinhamento confiável — dados originais preservados:");
            paragraph(block.naoInterpretado.join("\n"));
          }
        }
      }
      if (relatorio.naoInterpretado?.length) paragraph(relatorio.naoInterpretado.join("\n"));
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}
