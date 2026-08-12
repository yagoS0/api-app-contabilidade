// A RECAPTURA CORRIGE A NOTA — ELA NÃO PODE DESFAZER A CLASSIFICAÇÃO.
//
// Os dois caminhos de ingestão (NFS-e/ADN e NF-e/SEFAZ) reescreviam os itens da nota com
// `deleteMany` + recriação. Isso apaga, em silêncio, tudo o que a classificação escreveu no item:
// `tipoReceita`, `anexoResolvido`, `classificadoEm`, `sujeitoFatorR` — e zera `flagExportacao`.
// Classificar hoje e recapturar amanhã desfazia o trabalho, sem erro, sem log, sem aviso na tela.
// Urgente porque a classificação retroativa da base está para rodar (`tipoReceita` é nulo em
// 16.153 de 16.153 itens em produção).
//
// ─── O CRITÉRIO DE CASAMENTO, e por que este e não outro ────────────────────────────────────────
//
// Assinatura = **`codigoServico | ncm | cfop | valor`** (valor normalizado a 2 casas).
//
// • **Os três códigos entram porque são EXATAMENTE o que classifica.** `ClassificadorService.
//   classifyItem` só olha `codigoServico`, `ncm` e `cfop` (ProdutoServico → RegraClassificacao
//   EMPRESA → GLOBAL → capítulo LC116). Item cujos três códigos são os mesmos recebe, por
//   construção, a mesma classificação — carregá-la adiante não afirma nada de novo.
// • **`valor` entra porque nota corrigida com valor diferente É OUTRO ITEM.** Ele não muda o
//   resultado do classificador, mas é o sinal mais visível de que o documento mudou de verdade
//   entre as capturas; carregar classificação por cima de um valor novo seria decidir por conta
//   própria que a correção não importa. Com o valor na chave, o item alterado nasce
//   `tipoReceita: null` e volta para a fila do classificador — que é o comportamento desejado.
// • **`descricao` NÃO entra.** É texto livre, não classifica nada, e uma diferença de espaço em
//   branco entre duas capturas derrubaria a classificação de itens idênticos.
// • **Itens de assinatura repetida** (duas linhas iguais na mesma nota) são indistinguíveis entre
//   si por definição — casam por ordem de chegada (FIFO dentro do grupo). Qualquer um serve.
//
// Custo de errar, nas duas direções: perder o casamento custa uma reclassificação (o classificador
// varre `tipoReceita: null` sozinho, e as regras aprendidas por `AprendizadoService` sobrevivem em
// `RegraClassificacao`); carregar classificação para um item que mudou de verdade colocaria receita
// no anexo errado, e ninguém veria. Por isso a chave é ESTREITA de propósito.
//
// ⚠ Hoje **nenhum caminho manual escreve classificação item a item** — os únicos escritores são
// `ClassificadorService` (v2) e `ClassificadorAnexos` (legado), os dois em lote e determinísticos.
// Se um dia existir marcação manual por item, este módulo é o que a protege.

const CAMPOS_DE_CLASSIFICACAO = {
  tipoReceita: true,
  anexoResolvido: true,
  classificadoEm: true,
  sujeitoFatorR: true,
  flagExportacao: true,
};

function valorNormalizado(valor) {
  if (valor === null || valor === undefined) return "0.00";
  // Prisma Decimal, string ou number — todos passam por toString sem perder casa decimal.
  const n = Number(typeof valor === "object" && valor?.toString ? valor.toString() : valor);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

/** Assinatura estável de um item de nota. Ver o cabeçalho para o porquê de cada campo. */
export function assinaturaItem(item) {
  return [
    item?.codigoServico ?? "",
    item?.ncm ?? "",
    item?.cfop ?? "",
    valorNormalizado(item?.valor),
  ].join("|");
}

/**
 * Substitui os itens de uma nota preservando a classificação dos que não mudaram.
 *
 * @param {Object} tx        client Prisma (ou transação)
 * @param {Object} opts
 * @param {string} opts.notaId
 * @param {Array}  opts.itens  itens NOVOS (já parseados da captura/import)
 * @returns {Promise<{criados:number, preservados:number}>}
 */
export async function substituirItensPreservandoClassificacao(tx, { notaId, itens }) {
  const novos = Array.isArray(itens) ? itens : [];
  if (!novos.length) return { criados: 0, preservados: 0 };

  const antigos = await tx.notaItem.findMany({
    where: { notaId },
    select: {
      codigoServico: true, ncm: true, cfop: true, valor: true,
      ...CAMPOS_DE_CLASSIFICACAO,
    },
  });

  // Fila por assinatura: itens de assinatura repetida casam por ordem de chegada.
  const porAssinatura = new Map();
  for (const antigo of antigos) {
    const chave = assinaturaItem(antigo);
    if (!porAssinatura.has(chave)) porAssinatura.set(chave, []);
    porAssinatura.get(chave).push(antigo);
  }

  let preservados = 0;
  const paraCriar = novos.map((it) => {
    const fila = porAssinatura.get(assinaturaItem(it));
    const antigo = fila && fila.length ? fila.shift() : null;
    if (antigo) preservados += 1;
    return {
      notaId,
      codigoServico: it.codigoServico || null,
      ncm: it.ncm || null,
      cfop: it.cfop || null,
      descricao: it.descricao || null,
      valor: it.valor || 0,
      flagST: Boolean(it.flagST),
      flagMonofasico: Boolean(it.flagMonofasico),
      // ⚠ `flagExportacao` é o único campo preservado por OU, e o motivo é a assinatura:
      // dentro de uma assinatura igual o CFOP é o mesmo, então o valor derivado pelo parser de
      // NF-e (CFOP 7xxx) é necessariamente o mesmo dos dois lados — o OU só recupera um `true`
      // que NENHUM caminho de ingestão escreve (a criação do item de NFS-e nunca toca o campo).
      // Ver `apps/api/CLAUDE.md`, "o MERCADO é o campo que só existe aqui".
      flagExportacao: Boolean(it.flagExportacao) || Boolean(antigo?.flagExportacao),
      tipoReceita: antigo?.tipoReceita ?? null,
      anexoResolvido: antigo?.anexoResolvido ?? null,
      classificadoEm: antigo?.classificadoEm ?? null,
      sujeitoFatorR: antigo?.sujeitoFatorR ?? false,
    };
  });

  await tx.notaItem.deleteMany({ where: { notaId } });
  await tx.notaItem.createMany({ data: paraCriar });
  return { criados: paraCriar.length, preservados };
}
