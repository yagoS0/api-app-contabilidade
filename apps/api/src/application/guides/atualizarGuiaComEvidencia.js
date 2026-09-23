// Compare-and-swap: documento e comprovante dividem o JSON, mas não podem apagar
// uma alteração concorrente. Releia e mescle novamente se outro escritor vencer.
export async function atualizarGuiaComEvidencia(db, guideId, construirDados, { include } = {}) {
  for (let tentativa = 0; tentativa < 4; tentativa += 1) {
    const atual = await db.guide.findUnique({ where: { id: String(guideId) } });
    if (!atual) throw Object.assign(new Error("Guia não encontrada."), { code: "guide_not_found" });
    const alterada = await db.guide.updateMany({
      where: { id: String(guideId), updatedAt: atual.updatedAt },
      data: construirDados(atual),
    });
    if (alterada.count === 1) return db.guide.findUnique({ where: { id: String(guideId) }, ...(include ? { include } : {}) });
  }
  throw Object.assign(new Error("A guia mudou durante a atualização. Confira e tente novamente."), { code: "GUIA_ALTERADA", status: 409 });
}
