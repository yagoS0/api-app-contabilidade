// Monta um ZIP DE VERDADE para os testes.
//
// ⚠ Usa `archiver` (dependência JÁ declarada, e de ESCRITA) de propósito: quem grava o ZIP é uma
// implementação independente da nossa. Se o teste montasse o ZIP com o mesmo código que o lê, ele
// provaria apenas que os dois combinaram entre si — e não que `zipLeitura.js` entende o formato.

import archiver from "archiver";
import { createWriteStream } from "node:fs";

export function montarZip(caminho, entradas, { store = false } = {}) {
  return new Promise((resolve, reject) => {
    const saida = createWriteStream(caminho);
    // `store: true` grava SEM compressão (método 0) — o outro ramo do leitor.
    const arch = archiver("zip", store ? { store: true } : { zlib: { level: 9 } });
    saida.on("close", () => resolve(caminho));
    saida.on("error", reject);
    arch.on("error", reject);
    arch.pipe(saida);
    for (const e of entradas) {
      const buf = Buffer.isBuffer(e.conteudo)
        ? e.conteudo
        : Buffer.from(e.conteudo, e.encoding || "utf8");
      arch.append(buf, { name: e.nome });
    }
    arch.finalize();
  });
}
