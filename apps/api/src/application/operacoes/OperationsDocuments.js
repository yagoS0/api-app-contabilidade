import { documentosPgdas, whereDasSalvo } from '../fiscal/serpro/pgdasDocumentos.js';

export async function completarDocumentosOperacao(db, { portalClientId, competencia, indiceExistente }, deps = {}) {
  const read = async () => {
    const [circular, guide] = await Promise.all([
      db.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId, competencia } } }),
      db.guide.findFirst({ where: whereDasSalvo(portalClientId, competencia) }),
    ]);
    return documentosPgdas(circular, guide);
  };
  const before = await read(), out = { extrato: { ok: before.extrato, reutilizado: before.extrato }, guia: { ok: before.das, reutilizado: before.das } };
  if (before.extrato && before.das) return out;
  if (!before.extrato) {
    try {
      const sync = deps.sync || (await import('../fiscal/serpro/SerproPgdasDeclaracaoService.js')).syncPgdasByCompetencia;
      await sync({ portalClientId, competencia, indiceExistente, somenteDocumentos: true });
      out.extrato = { ok: (await read()).extrato };
      if (!out.extrato.ok) out.extrato.skipped = true;
    } catch { out.extrato = { skipped: true, reason: 'Extrato não confirmado. Confira os documentos da empresa.' }; }
  }
  if ((await read()).das) out.guia = { ok: true, reutilizado: before.das };
  else {
    try {
      const capture = deps.capture || (await import('../fiscal/serpro/CaptureSerproGuidesService.js')).capturePgdasGuideForCompany;
      await capture({ portalClientId, competencia, somenteDocumentos: true });
      out.guia = { ok: (await read()).das };
      if (!out.guia.ok) out.guia.skipped = true;
    } catch { out.guia = { skipped: true, reason: 'DAS não confirmado. Confira os documentos da empresa.' }; }
  }
  return out;
}
