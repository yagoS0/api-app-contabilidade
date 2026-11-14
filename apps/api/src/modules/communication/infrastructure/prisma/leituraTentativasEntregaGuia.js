export function lerTentativasEntregaGuia(db, guia, telefone) {
  return db.envioGuiaTentativa.findMany({
    where: {
      envioGuia: { guideId: guia.id, canal: 'WHATSAPP', destino: telefone },
      status: { in: ['entregue', 'lido'] },
      OR: [{ entregueEm: { not: null } }, { lidoEm: { not: null } }],
    },
    select: { arquivoSha256: true, snapshot: true },
  });
}
