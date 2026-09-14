import { createHash } from "node:crypto";

// Limite próprio de 5 MB para o compositor. MIME declarado sozinho não prova formato.
export function validarAnexoManual(arquivo, legenda = "") {
  const b = arquivo?.buffer;
  const pdf = b?.subarray(0, 5).toString() === "%PDF-";
  const png = b?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = b?.[0] === 255 && b?.[1] === 216 && b?.[2] === 255;
  const mime = pdf ? "application/pdf" : png ? "image/png" : jpg ? "image/jpeg" : null;
  if (!Buffer.isBuffer(b) || !b.length || b.length > 5 * 1024 * 1024 || !mime || arquivo.mimetype !== mime) {
    throw Object.assign(new Error("Envie um PDF ou imagem JPEG/PNG de até 5 MB."), { code: "ANEXO_INVALIDO", status: 400 });
  }
  if (typeof legenda !== "string" || legenda.length > 1024) throw Object.assign(new Error("A legenda pode ter até 1.024 caracteres."), { code: "LEGENDA_INVALIDA", status: 400 });
  const nome = String(arquivo.originalname || "anexo").split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180) || "anexo";
  return { tipo: pdf ? "document" : "image", mimeType: mime, nomeArquivo: nome, conteudo: b, legenda: legenda.trim(), sha256: createHash("sha256").update(b).digest("hex") };
}
