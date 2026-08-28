// O QUE VAI NO LOTE DE DANFSe — a página marcada, ou a competência inteira.
//
// ⚠⚠ ESTE MÓDULO EXISTE POR UMA CAPACIDADE QUE QUASE SE PERDEU. Até 27/08/2026 o botão baixava **o
// filtro inteiro** — até 200 notas de uma vez. Ele saiu a pedido do dono (*"tire o botão de baixar
// em lote, deixe o usuário selecionar as notas que ele quer"*), e a seleção que entrou no lugar é
// **por página**: a lista mostra 25 por vez, então quem tem 120 notas no mês passou a conseguir
// baixar 25.
//
// ⚠ **O pedido era sobre ESCOLHER, não sobre baixar menos.** Trocar "baixe tudo" por "escolha o que
// quiser, até 25" atende a letra e desfaz a capacidade. Por isso as duas coisas convivem: o
// cabeçalho marca a PÁGINA, e havendo mais notas no mês aparece a segunda oferta, nomeada.
//
// ## ⚠⚠ E OS DOIS ESCOPOS NÃO PROMETEM A MESMA COISA
//
// Na PÁGINA, a tela sabe exatamente quais notas geram DANFSe (`podeGerarDanfse` decide, e o que não
// gera nem pode ser marcado): *"Baixar 3 DANFSe"* é uma promessa que se cumpre.
//
// Na COMPETÊNCIA, quem escolhe é o servidor, pelo MESMO `where` da listagem — e ali entram notas que
// **não geram DANFSe** (NF-e, nota ainda não confirmada pelo ADN, nota sem o XML guardado). Elas
// saem NOMEADAS no `RELATORIO.txt` dentro do zip, mas o número de notas **não é** o número de PDFs.
// Por isso o rótulo deste escopo fala em NOTAS, nunca em DANFSe: prometer "Baixar 120 DANFSe" e
// entregar 113 é o defeito que a barra inteira existe para não cometer.

/**
 * Os dois escopos. Lista FECHADA.
 *
 * ⚠ O nome carrega `_DO_LOTE` porque `ESCOPO` JÁ EXISTE nesta feature — é o de
 * `lib/impedimento.js` (NOTA × AÇÃO), e a `NotasPage` importa os dois. Duas constantes com o mesmo
 * nome no mesmo arquivo não compilam; duas com o mesmo nome em arquivos diferentes compilam e
 * confundem, que é pior.
 */
export const ESCOPO_DO_LOTE = Object.freeze({
  /** As linhas marcadas na página. A tela sabe quais são, e o número é exato. */
  PAGINA: "pagina",
  /** Todas as notas do filtro — quem resolve é o servidor. ⚠ O número é de NOTAS, não de DANFSe. */
  COMPETENCIA: "competencia",
});

/**
 * Vale oferecer "todas as notas desta competência"?
 *
 * ⚠ SÓ QUANDO HÁ MAIS DO QUE A PÁGINA MOSTRA. Com tudo numa página só, a oferta seria o mesmo que o
 * cabeçalho já faz — e uma segunda porta para o mesmo ato é ruído que ensina a não ler a barra.
 *
 * ⚠⚠ ACIMA DO TETO A OFERTA APARECE, DESABILITADA, COM O MOTIVO. Botão que some esconde que a ação
 * existe; o servidor recusaria com `lote_muito_grande` de qualquer jeito, e descobrir isso depois de
 * clicar é pior do que ler antes. A saída (estreitar a competência, ou baixar pela página) vai na
 * mesma frase, porque recusa sem caminho é beco sem saída.
 *
 * @param {number} total quantas notas o filtro encontrou (o `total` da resposta, não `data.length`)
 * @param {number} notasNaPagina quantas linhas a página está mostrando
 * @param {number} teto o `LOTE_MAXIMO` do servidor
 */
export function ofertaDeTodaACompetencia({ total, notasNaPagina, teto } = {}) {
  // ⚠⚠ `Number.isFinite(Number(null))` é **`true`** — `Number(null)` dá `0`, e zero é finito. A
  // primeira versão desta guarda usava exatamente isso e deixava passar `notasNaPagina: null`, o que
  // fazia a oferta aparecer comparando 120 contra "zero na página". É a família do
  // `Number(null) === 0` que este projeto já pagou no Fator R e na alíquota do cliente, e foi o
  // TESTE que a pegou aqui também. Por isso as duas contagens têm de ser NÚMERO de verdade.
  if (typeof total !== "number" || typeof notasNaPagina !== "number") return null;
  const n = total;
  const naPagina = notasNaPagina;
  if (!Number.isFinite(n) || !Number.isFinite(naPagina)) return null;
  if (n <= 0 || n <= naPagina) return null;

  const limite = Number(teto);
  const acimaDoTeto = Number.isFinite(limite) && limite > 0 && n > limite;
  return {
    total: n,
    acimaDoTeto,
    rotulo: `Selecionar todas as ${n} notas desta competência`,
    motivo: acimaDoTeto
      ? `São ${n} notas, e o lote gera no máximo ${limite} por vez. Escolha uma competência mais `
        + "estreita, ou marque as notas página a página."
      : null,
  };
}

/**
 * O que vai ao servidor.
 *
 * ⚠⚠ NO ESCOPO DA COMPETÊNCIA NÃO VAI LISTA DE IDS — e é isso, e não um parâmetro novo, que faz o
 * servidor cair no filtro inteiro. Mandar os 120 ids exigiria buscar todas as páginas só para
 * remontar o que o `where` já sabe, e a lista poderia envelhecer entre a busca e o clique.
 *
 * ⚠ A COMPETÊNCIA VIAJA NOS DOIS. Ela é o recorte da tela; sem ela, o lote da página traria o
 * escopo certo por acaso (os ids bastam) e o da competência traria o histórico inteiro.
 */
export function pedidoDoLote({ escopo, ids, competencia } = {}) {
  const comp = competencia || undefined;
  if (escopo === ESCOPO_DO_LOTE.COMPETENCIA) return { competencia: comp };
  const lista = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return { competencia: comp, ids: lista };
}

/**
 * O rótulo do botão.
 *
 * ⚠⚠ SÓ O ESCOPO DA PÁGINA FALA EM "DANFSe". Ver o cabeçalho: na competência o número é de NOTAS, e
 * algumas delas não geram PDF nenhum.
 */
export function rotuloDoBotao({ escopo, quantas, total } = {}) {
  if (escopo === ESCOPO_DO_LOTE.COMPETENCIA) {
    const n = Number(total);
    return Number.isFinite(n) && n > 0
      ? `Baixar os DANFSe destas ${n} notas`
      : "Baixar os DANFSe desta competência";
  }
  const q = Number(quantas);
  if (!Number.isFinite(q) || q <= 0) return "Baixar DANFSe";
  return `Baixar ${q} DANFSe`;
}

/**
 * A frase que acompanha o escopo.
 *
 * ⚠ Na competência ela é OBRIGATÓRIA: sem dizer que o número é de notas, a pessoa conta os PDFs do
 * zip contra o rótulo e conclui que faltou arquivo. Na página não há nada a ressalvar — todas as
 * marcadas geram —, e uma frase ali seria a legenda que descreve uma ausência, que o dono mandou
 * cortar.
 */
export function avisoDoEscopo(escopo) {
  if (escopo !== ESCOPO_DO_LOTE.COMPETENCIA) return null;
  return "Este número é de NOTAS. As que não geram DANFSe (NF-e, nota ainda não confirmada, nota sem "
    + "o XML guardado) saem nomeadas no RELATORIO.txt, dentro do arquivo.";
}
