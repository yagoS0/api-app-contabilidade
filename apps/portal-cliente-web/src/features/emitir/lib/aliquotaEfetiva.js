// A ALÍQUOTA EFETIVA DO SIMPLES QUE VAI NA NOTA (`pTotTribSN`) — a regra de qual número oferecer e
// de onde ele veio. Sem tela e sem rede.
//
// ⚠⚠ A CONTA É **DAS ÷ RECEITA DA COMPETÊNCIA**. O INSS NÃO ENTRA — decisão do dono, 18/08/2026:
// *"a alíquota efetiva do Simples, ou seja apenas a DAS, o INSS não entraria."*
//
// E o motivo é o NOME DO CAMPO, não preferência: `pTotTribSN` é "total de tributos do **Simples
// Nacional**". O INSS recolhido em guia separada (o CPP do Anexo IV) não está dentro do DAS, logo
// não é tributo do Simples. Somá-lo declararia na nota uma carga que não é a do regime — e esse
// percentual vai IMPRESSO para o tomador por força da Lei 12.741/2012.
//
// ⚠ A ROTA DEVOLVE AS DUAS CONTAS, E SÓ UMA SERVE. `GET /client/companies/:id/aliquotas`
// (`apps/api/src/routes/client/index.js`) responde, por competência:
//     deReceita = dasExtrato / faturamento × 100   ← ESTA
//     efetiva   = impostosPagos / faturamento × 100 ← inclui INSS; NÃO usar aqui
// Medido em produção: onde não há INSS à parte as duas coincidem (6,00%); onde há, divergem em
// mais de um ponto (6,00% × 7,26%; 6,00% × 7,83%; 6,24% × 7,01%).
//
// ⚠⚠ **`efetiva` FICOU SEM CONSUMIDOR EM 30/08/2026** — o painel passou a ler a alíquota pelo que
// foi LANÇADO (`deLancamentos.aliquotaComFolha`), por ordem do dono. **A DISTINÇÃO abaixo continua
// valendo inteira**: o que mudou foi de onde o painel tira o "tudo", não o fato de ele querer tudo.
// ⚠ **ESTA TELA NÃO MUDOU**: a nota segue em `deReceita`, só o DAS. Não "alinhe" as duas.
// ⚠ Por que `efetiva` caiu: ela é refém de qual guia alguém marcou como paga — na ERISANGELA de
// 07/2026 a única guia paga era o INSS de R$ 178,31 e o card anunciou **0,77%** de carga
// tributária. Ver `application/accounting/lib/impostosSobreReceita.js`.
//
// ⚠ E `efetiva` NÃO É UM CAMPO ERRADO — ela está CERTA onde era usada, e isto está escrito aqui
// para que ninguém a "conserte". Decisão do dono, 18/08/2026: *"no painel isso está correto, pois ali
// temos a alíquota efetiva total, com todos os impostos; no caso da nota precisamos preencher
// apenas com a alíquota do Simples Nacional."*
//
// São DUAS PERGUNTAS DIFERENTES, e cada tela responde a sua:
//   • PAINEL (app do cliente, `AliquotaScreen`) — *quanto esta empresa paga de imposto?* ⇒ tudo,
//     INSS incluso. É gestão, não documento fiscal.
//   • NOTA (este arquivo) — *quanto desta nota é tributo do Simples?* ⇒ só o DAS.
// Trocar uma pela outra estraga a tela de destino nos dois sentidos.
//
// ⚠⚠ ZERO FABRICADO É O RISCO PRINCIPAL. O backend calcula `d > 0 ? n/d*100 : 0` — sem receita, ou
// sem extrato do PGDAS-D capturado, a resposta é `0`, que é **indistinguível** de uma alíquota de
// zero por cento. Numa nota fiscal, 0% é uma AFIRMAÇÃO sobre a carga tributária, não uma ausência.
// Por isso nada aqui lê `deReceita` sem antes conferir os DOIS insumos crus (`dasExtrato > 0` e
// `faturamento > 0`); sem eles, o campo fica VAZIO e a tela diz por quê. É a mesma disciplina do
// `somaOuTraco` de `lib/format.js` e da folha ausente no planejamento tributário.

/** De onde veio o número que está no campo. */
export const ORIGEM_ALIQUOTA = {
  AUSENTE: "ausente",
  SUGERIDA: "sugerida",
  DIGITADA: "digitada",
};

/** Uma linha da série tem os insumos crus que provam que o percentual não é fabricado? */
function linhaTemProva(linha) {
  // ⚠ O PERCENTUAL TAMBÉM PRECISA SER LEGÍVEL — não basta conferir os dois insumos. Sem a
  // terceira condição, uma linha COM receita e COM DAS mas sem `deReceita` produzia
  // `Number(undefined)` = **NaN**: o campo da nota escrevia literalmente "NaN" e
  // `textoDaProcedencia` afirmava a origem normalmente, como se o número fosse bom. É o oposto
  // do que o cabeçalho promete ("sem os dois não há de onde tirar" ⇒ campo vazio e motivo).
  //
  // NÃO É ALCANÇÁVEL PELA ROTA DE HOJE: `client/index.js:704` calcula `deReceita` na MESMA
  // expressão que os insumos, então ela nunca vem ausente. A guarda entra por isso mesmo — custa
  // uma linha e sobrevive a uma mudança no backend que ninguém vai lembrar de conferir aqui.
  return (
    Number(linha?.dasExtrato) > 0
    && Number(linha?.faturamento) > 0
    && percentualLegivel(linha?.deReceita)
  );
}

/**
 * O percentual foi LIDO, ou está ausente?
 *
 * ⚠⚠ `Number.isFinite(Number(x))` NÃO SERVE SOZINHO, e a primeira versão desta guarda errou nisso:
 * **`Number(null)` é `0`**, que é finito — então `deReceita: null` passava e a nota declarava 0%.
 * É exatamente a armadilha que o projeto já registra no `apps/web/CLAUDE.md`: o `fatorR` devolvia
 * `0` por causa de `Number(null) || 0`, elegendo o Anexo V sobre um número que ninguém digitou.
 * Ausente, nulo e vazio são AUSENTES; `0` só vale quando alguém escreveu zero.
 */
function percentualLegivel(v) {
  if (v === null || v === undefined || v === "") return false;
  return Number.isFinite(Number(v));
}

/**
 * Escolhe a linha a oferecer.
 *
 * @param serie   o `data` de `GET /aliquotas` (mais recente primeiro, mas não se confia na ordem)
 * @param competenciaDaNota  'YYYY-MM' — a competência que a nota vai declarar
 *
 * @returns {{ valor: number|null, competencia: string|null, exata: boolean, motivo: string|null }}
 *   `valor` em PERCENTUAL (6.0 = 6%), nunca `0` fabricado. `exata` diz se a linha é a da própria
 *   competência da nota ou uma anterior.
 */
export function escolherAliquotaEfetiva(serie, competenciaDaNota) {
  const linhas = (Array.isArray(serie) ? serie : []).filter(linhaTemProva);
  if (!linhas.length) {
    return {
      valor: null,
      competencia: null,
      exata: false,
      // ⚠⚠ TENTEI TIRAR O "PGDAS-D" DAQUI E O TESTE RECUSOU — e o comentário dele é o argumento:
      // *"O texto CITA o PGDAS-D — dentro do MOTIVO, que é o certo. O que ele não pode é AFIRMAR
      // procedência."* A distinção é essa: a sigla no motivo diz POR QUE não há número; a sigla
      // numa afirmação de origem ("DAS de 07/2026 sobre a receita") é que seria inventar dono para
      // um número que não existe. Não confundir com o corte do CNAE, que descrevia a nossa dedução.
      motivo:
        "nenhuma competência recente tem, ao mesmo tempo, receita apurada e extrato do PGDAS-D — "
        + "sem os dois não há de onde tirar a alíquota efetiva",
    };
  }

  const alvo = String(competenciaDaNota || "").slice(0, 7);
  const daNota = linhas.find((l) => l.competencia === alvo);
  if (daNota) {
    return {
      valor: Number(daNota.deReceita),
      competencia: daNota.competencia,
      exata: true,
      motivo: null,
    };
  }

  // ⚠ A ÚLTIMA APURADA, E ELA DIZ QUAL FOI. Ao emitir, a competência corrente quase nunca está
  // apurada — o DAS do mês só existe depois do PGDAS-D. Usar a última é o certo; usá-la SEM DIZER
  // que é de outro mês seria apresentar o número do mês passado como se fosse o deste.
  // ⚠ Não se extrapola, não se projeta, não se repete o número anterior fingindo ser o do mês.
  const maisRecente = linhas
    .slice()
    .sort((a, b) => String(b.competencia).localeCompare(String(a.competencia)))[0];

  return {
    valor: Number(maisRecente.deReceita),
    competencia: maisRecente.competencia,
    exata: false,
    motivo: null,
  };
}

/** 'YYYY-MM' → 'MM/AAAA'. Local para o rótulo não depender da tela. */
function mmAaaa(competencia) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ""));
  return m ? `${m[2]}/${m[1]}` : String(competencia || "");
}

/**
 * A PROCEDÊNCIA, em uma frase — e ela vai PARA A TELA, ao lado do número.
 *
 * ⚠ "6,00%" e "6,00% — DAS de 07/2026 sobre a receita da competência" são duas coisas diferentes.
 * A primeira é um número que apareceu sozinho; a segunda dá o que conferir. Mesma disciplina do
 * planejamento tributário, que imprime a origem de cada campo no PDF.
 */
export function textoDaProcedencia(escolha, competenciaDaNota) {
  if (!escolha || escolha.valor === null) {
    return `Não preenchemos: ${escolha?.motivo || "sem dado para esta empresa"}.`;
  }
  const base = `DAS de ${mmAaaa(escolha.competencia)} sobre a receita da mesma competência (extrato do PGDAS-D)`;
  if (escolha.exata) return `${base}.`;
  return (
    `${base}. ⚠ É a última competência apurada — a da nota `
    + `(${mmAaaa(competenciaDaNota)}) ainda não tem extrato do PGDAS-D. Confira antes de emitir.`
  );
}

/**
 * A JANELA DE COMPETÊNCIAS a pedir à rota, terminando no mês da nota.
 *
 * ⚠ Seis meses, não doze: a rota faz **um `aggregate` por competência, em série**
 * (`for (const comp of list) await prisma.portalInvoice.aggregate(...)`), então cada mês a mais é
 * uma ida ao banco a mais numa tela que o cliente abre para emitir. Seis cobre com folga a defasagem
 * normal do PGDAS-D (o extrato do mês M aparece em M+1).
 */
export function janelaDaConsulta(competenciaDaNota, { meses = 6 } = {}) {
  const m = /^(\d{4})-(\d{2})/.exec(String(competenciaDaNota || ""));
  const hoje = new Date();
  const ano = m ? Number(m[1]) : hoje.getFullYear();
  const mes = m ? Number(m[2]) : hoje.getMonth() + 1;
  const fim = new Date(ano, mes - 1, 1);
  const inicio = new Date(ano, mes - meses, 1);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { from: fmt(inicio), to: fmt(fim) };
}
