import { prisma } from "../../infrastructure/db/prisma.js";

export class ImportarOfxWhatsappError extends Error {
  constructor(codigo, mensagem, status = 422, details = undefined) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
    this.details = details;
  }
}

/** Recibo e lançamentos comitam juntos. A unique de AppSetting reserva um arquivo entre processos. */
export async function importarOfxWhatsapp({ arquivoWhatsappId, portalClientId, executar, client = prisma }) {
  const id = String(arquivoWhatsappId || "").trim();
  const companyId = String(portalClientId || "").trim();
  if (!id || !companyId) throw new ImportarOfxWhatsappError("ARQUIVO_WHATSAPP_OBRIGATORIO", "Informe o arquivo recebido pelo WhatsApp.");
  const key = `whatsapp_ofx_import:${id}`;
  const where = { id, portalClientId: companyId, estado: "DISPONIVEL", mimeType: "application/x-ofx", expiraEm: { gt: new Date() } };
  const resposta = (receipt, repetido) => {
    if (receipt?.value?.companyId !== companyId || !receipt.value.resultado?.ok) {
      throw new ImportarOfxWhatsappError("RECIBO_OFX_INDISPONIVEL", "O recibo desta importação não pôde ser confirmado.", 409);
    }
    return { ...receipt.value.resultado, arquivoWhatsappId: id, repetido };
  };
  try {
    return await client.$transaction(async (tx) => {
      const arquivo = await tx.arquivoWhatsapp.findFirst({ where, select: { id: true } });
      if (!arquivo) throw new ImportarOfxWhatsappError("ARQUIVO_WHATSAPP_INDISPONIVEL", "O arquivo OFX não está disponível nesta empresa ou seu prazo terminou.", 404);
      const existente = await tx.appSetting.findUnique({ where: { key } });
      if (existente) return resposta(existente, true);
      await tx.appSetting.create({ data: { key, value: { companyId, arquivoWhatsappId: id, resultado: null } } });
      const resultado = await executar(tx);
      if (resultado.failed || !resultado.created) {
        throw new ImportarOfxWhatsappError("OFX_WHATSAPP_LINHAS_INVALIDAS", "Nenhuma transação foi importada. Corrija as linhas indicadas e tente novamente.", 422,
          { created: [], failed: resultado.details?.failed || [] });
      }
      // Revalida disponibilidade no commit, inclusive se a retenção venceu durante o processamento.
      const marcado = await tx.arquivoWhatsapp.updateMany({ where: { ...where, expiraEm: { gt: new Date() } }, data: { importadoEm: new Date() } });
      if (marcado.count !== 1) throw new ImportarOfxWhatsappError("ARQUIVO_WHATSAPP_INDISPONIVEL", "O arquivo deixou de estar disponível; nenhuma transação foi importada.", 409);
      const recibo = await tx.appSetting.update({ where: { key }, data: { value: { companyId, arquivoWhatsappId: id, resultado } } });
      return resposta(recibo, false);
    }, { timeout: 30000 });
  } catch (err) {
    if (err?.code !== "P2002") throw err;
    // O processo concorrente terminou sua transação antes de liberar a unique. Ler só após rollback.
    const arquivo = await client.arquivoWhatsapp.findFirst({ where: { ...where, expiraEm: { gt: new Date() } }, select: { id: true } });
    if (!arquivo) throw new ImportarOfxWhatsappError("ARQUIVO_WHATSAPP_INDISPONIVEL", "O arquivo não está disponível nesta empresa.", 404);
    const recibo = await client.appSetting.findUnique({ where: { key } });
    if (!recibo) throw err; // Uma constraint contábil diferente não é uma repetição bem-sucedida.
    return resposta(recibo, true);
  }
}
