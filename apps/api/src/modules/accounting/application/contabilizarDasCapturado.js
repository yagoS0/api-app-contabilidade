// Contrato interno da captura já autorizada: não consulta SERPRO nem repara provisões.
// Preserva a circular original e o resultado do gerador, inclusive ok:true sem lançamentos.
// Falha de circular propaga; composição/acréscimos são best-effort; falha do gerador é parcial.
export async function contabilizarDasCapturado({
  portalClient, normalizedCompetencia, mapped, resolvedServiceId, procuradorCnpj, now,
  somenteDocumentos,
}, {
  lerCircularDasCapturado, gravarCircularDasCapturado, lerComposicaoDas,
  gravarAcrescimosDasCapturado, gerarLancamentosDasCapturado,
}) {
  const circular = somenteDocumentos
    ? await lerCircularDasCapturado({ portalClientId: portalClient.id, competencia: normalizedCompetencia })
    : await gravarCircularDasCapturado({
      portalClient, normalizedCompetencia, mapped, resolvedServiceId, procuradorCnpj, now,
    });

  // Frente B: grava o split principal/juros/multa do DAS na circular (dado do PDF, antes descartado).
  // Guarda de sanidade: só grava se o total parseado bate com o total do DAS (layout do PDF não
  // validado no offline — se não bater, não grava e a provisão segue no total/dasTotal).
  try {
    if (!somenteDocumentos && mapped.pdfBuffer?.length && mapped.parsed.valor != null) {
      const comp = await lerComposicaoDas(mapped.pdfBuffer);
      if (comp?.totais && Math.abs((Number(comp.totais.total) || 0) - Number(mapped.parsed.valor)) < 0.02) {
        await gravarAcrescimosDasCapturado({
          portalClientId: portalClient.id,
          competencia: normalizedCompetencia,
          valores: { DAS: { principal: comp.totais.principal, juros: comp.totais.juros, multa: comp.totais.multa } },
        });
      }
    }
  } catch { /* best-effort: nunca derruba a captura do DAS */ }

  let accounting = null;
  try {
    // ⚠ `fonteValor: GUIA` — aqui o `dasTotal` vem do DOCUMENTO DE ARRECADAÇÃO, que depois do
    // vencimento chega recalculado com juros e multa. É exatamente o caso que a guarda de
    // recálculo do `AccountingEntryGeneratorService` existe para proteger: a provisão continua
    // valendo o principal, e o valor novo fica só sinalizado no lançamento e na circular.
    // (É o default do serviço; explícito porque é aqui que a guarda PRECISA morder.)
    accounting = somenteDocumentos ? { skipped: true, somenteDocumentos: true } : await gerarLancamentosDasCapturado({
      portalClientId: portalClient.id,
      competencia: normalizedCompetencia,
      now,
    });
  } catch (err) {
    accounting = {
      ok: false,
      error: err?.code || "ACCOUNTING_GENERATION_FAILED",
      reason: err?.message || "Falha ao gerar lançamentos a partir da Circular.",
    };
  }

  return { circular, accounting };
}
