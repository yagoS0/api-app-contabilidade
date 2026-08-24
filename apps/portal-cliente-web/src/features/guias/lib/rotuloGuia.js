// COMO UMA GUIA SE CHAMA NA TELA DO CLIENTE.
//
// ⚠⚠ EXISTE POR UM DEFEITO MEDIDO EM PRODUÇÃO (24/08/2026), relatado pelo dono: *"as guias do
// lucro presumido do PIS e COFINS não estão aparecendo no portal do cliente"*. A tela imprimia
// `texto(guia.tipo)` cru, e **a DARF consolidada do Lucro Presumido é gravada como
// `tipo: "OUTRA"`** — um documento só, com até quatro tributos dentro. O cliente do Presumido lia
// literalmente "OUTRA" na coluna Tipo, sem nenhuma menção a PIS ou COFINS.
//
// ⚠ O DADO SEMPRE CHEGOU. `toGuideResponse` (`apps/api/src/application/guides/GuideService.js`)
// já mandava `extracted.composicao`; medido nas 9 DARFs de LP em produção, **9 de 9 têm a
// composição gravada** (PIS · COFINS · IRPJ · CSLL · IRRF, conforme o mês). Não faltava captura,
// nem coluna, nem rota — faltava esta leitura. É a mesma classe do `codigosServicoNacional`: o
// campo viaja e ninguém o lê.
//
// ⚠⚠ A REGRA NÃO É NOVA E NÃO FOI INVENTADA AQUI — ela é ESPELHO de `rotuloTipoGuia`
// (`apps/web/src/features/guides/lib/rotuloGuia.js`), que o portal do CONTADOR usa desde o Lote C.
// O espelho é **amarrado por teste** (`__tests__/rotuloGuia.test.js` importa a função do outro
// portal e exige o mesmo veredito). Sem o amarre, "espelho" é intenção e não fato — e a
// divergência apareceria como o contador vendo "PIS · COFINS" e o cliente vendo "OUTRA" sobre a
// MESMA guia, que é exatamente o estado que este arquivo desfaz.
//
// ⚠ O RAMO DO PARCELAMENTO **NÃO** É ESPELHO, de propósito. Lá o rótulo é montado no front a
// partir de `parcelamentoTipo`/`numeroParcela`/`quantidadeParcelas`; aqui o backend já manda
// `parcelamentoLabel` pronto, e era assim antes desta mudança. Reescrever a montagem do contador
// neste app criaria uma segunda regra de parcelamento onde hoje há zero — e o pedido do dono era
// sobre PIS/COFINS. O que fica travado por teste é a PRECEDÊNCIA: parcelamento decide ANTES do
// tipo, senão a parcela cai na regra da DARF.

/** Nome curto do tributo de uma linha da composição ("IRRF - ALUG…" → "IRRF"). */
function tributoCurto(c) {
  if (c?.tributo) return String(c.tributo).trim();
  const den = String(c?.denominacao || "").trim();
  if (den) return (den.split(/\s*[-–—]\s*/)[0] || den).trim();
  return String(c?.codigo || "").trim() || "?";
}

function composicaoDaGuia(guia) {
  const comp = guia?.extracted?.composicao;
  return Array.isArray(comp) ? comp : [];
}

/**
 * O rótulo da coluna "Tipo".
 *
 * A ordem importa: parcelamento é decidido ANTES do `tipo`, senão a parcela — que é gravada como
 * `tipo: "SIMPLES"`, idêntica ao DAS do mês — apareceria como o DAS.
 */
export function rotuloDaGuia(guia) {
  // `parcelamentoLabel` existe para que uma parcela não apareça como "DAS" solto.
  if (guia?.parcelamentoLabel) return String(guia.parcelamentoLabel);

  const tipo = String(guia?.tipo || "");
  if (tipo.toUpperCase() === "OUTRA") {
    const nomes = [...new Set(composicaoDaGuia(guia).map(tributoCurto).filter(Boolean))];
    if (nomes.length) return nomes.join(" · ");
  }
  // ⚠ SEM COMPOSIÇÃO O ROTULO CONTINUA "OUTRA", e isso é a resposta certa, não uma falha do
  // conserto: "OUTRA" é o que está GRAVADO. Inventar "PIS · COFINS" numa guia cuja composição não
  // foi lida afirmaria ao cliente quais impostos ele está pagando — sem ninguém ter medido.
  return tipo || "-";
}

/**
 * O detalhamento por tributo, para o `title` da célula. `undefined` quando não há o que
 * acrescentar ao rótulo.
 *
 * ⚠ AQUI O CLIENTE VÊ O VALOR DE CADA TRIBUTO, e isso é informação dele: é o documento que ele vai
 * pagar. Nenhum número novo é calculado — sai da mesma `composicao` que o rótulo já lê.
 */
export function detalheDaGuia(guia) {
  if (guia?.parcelamentoLabel) return undefined;
  if (String(guia?.tipo || "").toUpperCase() !== "OUTRA") return undefined;
  const comp = composicaoDaGuia(guia);
  if (!comp.length) return undefined;
  return "Impostos contidos nesta guia:\n" + comp
    .map((c) => {
      const nome = c?.denominacao || tributoCurto(c);
      const valor = c?.total != null
        ? ` — R$ ${Number(c.total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
        : "";
      return `• ${nome}${valor}`;
    })
    .join("\n");
}
