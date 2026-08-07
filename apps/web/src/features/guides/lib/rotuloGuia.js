// COMO UMA GUIA SE CHAMA NA TELA — uma leitura só, para todas as listagens.
//
// ⚠ Existe porque o nome da guia NÃO sai do `tipo`. Duas coisas diferentes se apresentam com o
// mesmo `tipo`, e as duas já apareceram com o nome errado:
//
// - a PARCELA de parcelamento é gravada como `tipo:"SIMPLES"`, idêntica ao DAS do mês (quem separa
//   as duas é o `parcelamentoId`, do lado do backend em `guides/guideContract.js`);
// - a DARF consolidada do Lucro Presumido é `tipo:"OUTRA"`, e quem diz o que ela contém é a
//   composição por tributo.
//
// A regra morava inline no JSX de UMA tabela. Toda listagem que não repetisse aquela expressão
// mostrava a parcela como se fosse o DAS — que é o erro que o `parcelamentoId` existe para desfazer.

/**
 * A guia é uma PARCELA de parcelamento?
 *
 * Espelho de `isGuiaDeParcelamento` (`apps/api/src/application/guides/guideContract.js`). O critério
 * é o vínculo, nunca o `tipo`.
 */
export function ehGuiaDeParcelamento(guide) {
  return Boolean(guide?.parcelamentoId);
}

function composicaoDaGuia(guide) {
  const comp = guide?.extracted?.composicao;
  return Array.isArray(comp) ? comp : [];
}

/** Nome curto do tributo de uma linha da composição ("IRRF - ALUG…" → "IRRF"). */
function tributoCurto(c) {
  if (c?.tributo) return String(c.tributo).trim();
  const den = String(c?.denominacao || "").trim();
  if (den) return (den.split(/\s*[-–—]\s*/)[0] || den).trim();
  return String(c?.codigo || "").trim() || "?";
}

/**
 * Rótulo de uma guia de parcelamento: `PARCSN Nº 1 · 3/10`.
 *
 * ⚠ NADA AQUI É DEDUZIDO DO `tipo` DA GUIA. O fallback antigo era
 * `parcelamentoTipo || tipo`, e com a modalidade nula ele imprimia "Parc. SIMPLES" — o nome do DAS
 * do mês, exatamente a confusão que se queria evitar. Modalidade desconhecida vira "Parcelamento",
 * o mesmo rótulo genérico que o chip do dashboard já usa (uma parcela de INSS parcelado também cai
 * aqui, então "PARC DAS" seria trocar um erro por outro).
 *
 * ⚠ A modalidade sai CRUA do banco (`PARCSN`, `PERT_SN`…). Não existe no projeto nenhuma tabela de
 * abreviação para ela; escrever uma aqui seria inventar vocabulário fiscal.
 *
 * Cada pedaço só aparece quando o dado existe: "parcela 3" sem o total não vira "3/?" — o total
 * ausente é ausência de informação, não um valor a preencher.
 */
export function rotuloParcelamento(guide) {
  const modalidade = String(guide?.parcelamentoTipo || "").trim() || "Parcelamento";
  const numero = String(guide?.parcelamentoNumero || "").trim();
  const parcela = Number(guide?.numeroParcela) || null;
  const total = Number(guide?.quantidadeParcelas) || null;

  const partes = [numero ? `${modalidade} Nº ${numero}` : modalidade];
  if (parcela && total) partes.push(`${parcela}/${total}`);
  else if (parcela) partes.push(`parcela ${parcela}`);
  return partes.join(" · ");
}

/**
 * O rótulo da coluna "Tipo" de qualquer listagem de guias.
 *
 * A ordem importa: parcelamento é decidido ANTES do `tipo`, senão a parcela cai na regra do DAS.
 */
export function rotuloTipoGuia(guide) {
  if (ehGuiaDeParcelamento(guide)) return rotuloParcelamento(guide);

  const tipo = String(guide?.tipo || "");
  if (tipo.toUpperCase() === "OUTRA") {
    const nomes = [...new Set(composicaoDaGuia(guide).map(tributoCurto).filter(Boolean))];
    if (nomes.length) return nomes.join(" · ");
  }
  return tipo || "-";
}

/** Descrição completa (tooltip). `undefined` quando não há nada a acrescentar ao rótulo. */
export function tituloTipoGuia(guide) {
  // O `label` do parcelamento é o texto que o contador cadastrou ("RE-PARCELAMENTO SIMPLES
  // NACIONAL DE SET/OUT/2024…") — longo demais para a coluna, útil demais para descartar.
  if (ehGuiaDeParcelamento(guide)) return guide?.parcelamentoLabel || undefined;

  if (String(guide?.tipo || "").toUpperCase() !== "OUTRA") return undefined;
  const comp = composicaoDaGuia(guide);
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
