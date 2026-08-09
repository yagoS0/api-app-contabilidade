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

import { resolverModalidadeParcelamento, AVISO_MODALIDADE_EM_REVISAO } from "../../../lib/vocabulario";

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
 * Rótulo de uma guia de parcelamento: `PARC SN Nº 1 · 3/10`.
 *
 * ⚠ NADA AQUI É DEDUZIDO DO `tipo` DA GUIA. O fallback antigo era
 * `parcelamentoTipo || tipo`, e com a modalidade nula ele imprimia "Parc. SIMPLES" — o nome do DAS
 * do mês, exatamente a confusão que se queria evitar. Modalidade ausente vira "Parcelamento",
 * o mesmo rótulo genérico que o chip do dashboard já usa (uma parcela de INSS parcelado também cai
 * aqui, então "PARC DAS" seria trocar um erro por outro).
 *
 * ⚠ A MODALIDADE JÁ NÃO SAI CRUA — e o de-para NÃO mora aqui. Quem colapsa `PARCSN·PARCSN_ESPECIAL·
 * PERT_SN·RELP_SN` em **"PARC SN"** (e a família do MEI em **"PARC MEI"**) é
 * `resolverModalidadeParcelamento`, em `lib/vocabulario.js`, que é a camada onde o projeto já
 * traduz enum do banco para palavra do contador. Escrever a tabela aqui a esconderia dentro da
 * feature de guias — e o parcelamento é lido em mais telas que esta.
 *
 * ⚠ O CRU CONTINUA RECUPERÁVEL: `tituloTipoGuia` põe a modalidade do SERPRO no `title` da linha.
 * O colapso é de EXIBIÇÃO; o dado gravado (`Parcelamento.tipo`) não foi tocado.
 *
 * ⚠ Modalidade que o de-para não conhece aparece CRUA com "⚠" — nunca colapsada por palpite.
 *
 * Cada pedaço só aparece quando o dado existe: "parcela 3" sem o total não vira "3/?" — o total
 * ausente é ausência de informação, não um valor a preencher.
 */
export function rotuloParcelamento(guide) {
  const m = resolverModalidadeParcelamento(guide?.parcelamentoTipo);
  const modalidade = m.revisao ? `${m.rotulo} ⚠` : m.rotulo;
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
  // ⚠ É AQUI QUE O COLAPSO DEIXA DE SER DESTRUTIVO. A coluna mostra "PARC SN"; o `title` diz de
  // qual das quatro modalidades ele veio. Sem isto, "veio como RELP_SN" só se responderia abrindo
  // o banco — e PERT/RELP têm reduções de multa e juros que a família não distingue.
  //
  // O `label` do parcelamento é o texto que o contador cadastrou ("RE-PARCELAMENTO SIMPLES
  // NACIONAL DE SET/OUT/2024…") — longo demais para a coluna, útil demais para descartar.
  if (ehGuiaDeParcelamento(guide)) {
    const m = resolverModalidadeParcelamento(guide?.parcelamentoTipo);
    const linhas = [];
    if (m.cru) linhas.push(`Modalidade (SERPRO): ${m.cru}`);
    if (m.revisao) linhas.push(AVISO_MODALIDADE_EM_REVISAO);
    if (guide?.parcelamentoLabel) linhas.push(guide.parcelamentoLabel);
    return linhas.length ? linhas.join("\n") : undefined;
  }

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
