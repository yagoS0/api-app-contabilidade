// A VARREDURA — as notas recebidas viram fila de despesa.
//
// > Pedido do dono (24/08/2026): *"as notas são informações de despesas, devemos poder usar as
// > notas recebidas para gerar lançamento."*
//
// ⚠⚠ ELA NÃO CRIA LANÇAMENTO NENHUM. Cria DECLARADOS em `AGUARDANDO_PAGAMENTO`: a nota diz que
// despesa é e de quem, e quem diz quando o dinheiro saiu é o pagamento. Ver o `CLAUDE.md` deste
// diretório.
//
// ⚠ A REGRA é `lib/notaViraDeclarado.js` (pura) e a SITUAÇÃO da nota é `notas/cicloNota.js` (a
// mesma da tela). Este arquivo só busca, orquestra e relata.
//
// ⚠⚠ IDEMPOTENTE. A captura de notas roda sozinha, então varrer de novo é o caso NORMAL. Nota que
// já virou declarado volta contada como `jaExistiam`, **sem que nada seja tocado** — nem o estado,
// nem a conta, nem a decisão que o contador já tomou sobre ela.

import { prisma } from "../../infrastructure/db/prisma.js";
import { derivarCiclo, montarIndiceDeCiclo } from "../notas/cicloNota.js";
import { criarDeclarado } from "./DeclaradoService.js";
import { separarNotas } from "./lib/notaViraDeclarado.js";

/**
 * ⚠ As colunas que a regra lê, e só elas. `select` explícito porque coluna fora dele volta
 * `undefined` **sem erro nenhum** — a armadilha do `legacyCompanySelect`, que já mordeu três vezes
 * nesta base. Aqui o efeito seria a nota inteira cair em "sem valor" ou "sem emitente".
 */
const SELECT_DA_NOTA = Object.freeze({
  id: true,
  type: true,
  papel: true,
  total: true,
  issueDate: true,
  competencia: true,
  emitenteNome: true,
  emitenteDoc: true,
  xDescServ: true,
  statusEfetivo: true,
  chaveAcesso: true,
  chaveSubstituida: true,
  motivoSubstituicao: true,
});

/**
 * Varre as notas recebidas de UMA empresa e enfileira as que viram despesa.
 *
 * @param {object} args
 * @param {string} args.portalClientId
 * @param {Date}   [args.dataPiso] ⚠⚠ notas anteriores ficam FORA. Sem piso a primeira varredura
 *   produz a base inteira de uma vez — 1.897 NFS-e recebidas hoje —, e isso não é fila, é muro.
 * @param {string} args.criadoPor quem disparou
 * @param {Date}   [args.agora] injetado
 */
export async function varrerNotasDaEmpresa({
  portalClientId,
  dataPiso = null,
  criadoPor,
  agora = null,
  client = prisma,
}) {
  const where = { clientId: String(portalClientId), papel: "DEST" };
  // ⚠ O corte por data acontece TAMBÉM na query, não só na regra: sem ele carregaríamos as 1.897
  // notas na memória para descartar 1.595. A regra mantém o corte porque ela é a autoridade — e é
  // ela que NOMEIA o motivo quando alguém a chama com um lote já filtrado por outro caminho.
  if (dataPiso instanceof Date && !Number.isNaN(dataPiso.getTime())) {
    where.issueDate = { gte: dataPiso };
  }

  const notas = await client.portalInvoice.findMany({
    where,
    select: SELECT_DA_NOTA,
    orderBy: { issueDate: "asc" },
  });

  if (!notas.length) {
    return { varridas: 0, criados: 0, jaExistiam: 0, fora: [], recusados: [] };
  }

  // ⚠⚠ A SITUAÇÃO VEM DO CICLO. O que ele acrescenta a `statusEfetivo` é REAL: aquela coluna só
  // guarda `autorizada|cancelada`, então SUBSTITUIÇÃO não cabe nela — e uma das evidências do ciclo
  // é outra nota DA MESMA LISTA declarando substituir esta (`chaveSubstituida`), que é o caminho
  // que salva os casos em que o evento se perdeu. Por isso `relacionadas` recebe o lote inteiro.
  const eventos = await client.portalInvoiceEvent.findMany({
    where: { invoiceId: { in: notas.map((n) => n.id) } },
  });

  // ⚠⚠ `montarIndiceDeCiclo` DEVOLVE UM ARRAY de `{...nota, ciclo}`, apesar do nome. Tratá-lo como
  // Map (`.get(id)`) devolve `undefined` SEM ERRO, e o código cai num fallback que perde
  // exatamente o contexto que o ciclo existe para dar — a nota substituída sairia rotulada
  // "cancelada". Foi o que aconteceu aqui até um teste pegar.
  const cicloPorNota = new Map(
    montarIndiceDeCiclo({ notas, eventos, relacionadas: notas }).map((n) => [n.id, n.ciclo]),
  );

  const { viram, fora } = separarNotas(notas, (n) => ({
    situacao: (cicloPorNota.get(n.id) || derivarCiclo({ nota: n }))?.situacao,
    dataPiso,
  }));

  let criados = 0;
  let jaExistiam = 0;
  const recusados = [];

  // ⚠ SEQUENCIAL, e sem parâmetro de concorrência. Parâmetro é como alguém põe 20 nele depois — e
  // a corrida entre duas varreduras é justamente o que o `@@unique` do dedupe existe para pegar.
  for (const { nota, dados } of viram) {
    try {
      const r = await criarDeclarado({ ...dados, portalClientId, criadoPor, agora, client });
      if (r.jaExistia) jaExistiam += 1;
      else criados += 1;
    } catch (e) {
      // ⚠ UMA NOTA RECUSADA NÃO DERRUBA O LOTE, e não some: ela vira linha nomeada no relatório.
      // Abortar tudo por causa de uma faria o contador perder as outras 228 sem saber por quê.
      recusados.push({ notaId: nota.id, codigo: e?.codigo || "erro", motivo: e?.frase || String(e?.message || e) });
    }
  }

  return { varridas: notas.length, criados, jaExistiam, fora, recusados };
}


// -------------------------------------------------------------------------------------------------
// ⚠⚠ A VARREDURA AUTOMÁTICA — decisão do dono, 01/09/2026.
//
// > *"aquela parte onde diz «trazer notas» — elas devem ser trazidas automaticamente, como tem na
// > aba de notas fiscais deve aparecer ali."*
//
// ⚠⚠ MEDIDO ANTES DE CONSTRUIR: `varrerNotasDaEmpresa` tinha **um único chamador**, a rota. Nenhum
// worker a chamava. As notas chegavam sozinhas à base (o `dfeNotasWorker` captura de hora em hora)
// e paravam ali — virar FILA dependia de alguém abrir a Conferência e clicar em «Trazer notas».
//
// ⚠⚠ **O PROBLEMA QUE ISTO TEVE DE RESOLVER É A DATA-PISO.** Ela é obrigatória de propósito: sem
// piso, a primeira varredura despeja a base inteira na fila (1.897 NFS-e recebidas hoje) — não é
// fila, é muro. E um piso escolhido pelo SISTEMA faria o sistema decidir o tamanho do trabalho que o
// contador vai encontrar na tela, que é exatamente o que a rota recusa com `data_piso_obrigatoria`.
//
// A saída não foi afrouxar a regra: foi **guardar a escolha**. O contador escolhe a data uma vez, e
// ela vira decisão permanente. Como a varredura é idempotente (nota que já virou declarado volta
// como `jaExistiam`, sem nada ser tocado), repetir o mesmo piso é seguro por construção — não há
// cursor a manter, e nada se perde se um ciclo falhar.
//
// ⚠⚠ **EMPRESA SEM ESCOLHA NÃO É VARRIDA SOZINHA.** Não é lacuna: ninguém decidiu o piso dela.
// -------------------------------------------------------------------------------------------------

/**
 * ⚠ Tabela nova degrada, nunca derruba a tela — P2021 (tabela ausente) e P2022 (coluna ausente) são
 * o estado de um banco que ainda não recebeu a migration. A Conferência inteira cairia por causa de
 * um bloco informativo.
 *
 * ⚠⚠ E o desconhecido PROPAGA: engolir todo erro faria "o banco está fora" virar "esta empresa não
 * tem varredura automática", que é uma afirmação sobre a empresa.
 */
function ausenciaDeEsquema(e) {
  return e?.code === "P2021" || e?.code === "P2022";
}

export async function lerVarreduraAutomatica({ portalClientId, client = prisma }) {
  try {
    const r = await client.varreduraAutomaticaDeNotas.findFirst({
      where: { portalClientId: String(portalClientId) },
    });
    // ⚠ `ligada: false` com `indisponivel: false` é uma RESPOSTA ("ninguém ligou"); com
    // `indisponivel: true` é "não sei olhar". A tela desenha as duas de formas diferentes.
    return { ligada: Boolean(r), config: r || null, indisponivel: false };
  } catch (e) {
    if (ausenciaDeEsquema(e)) return { ligada: false, config: null, indisponivel: true };
    throw e;
  }
}

/**
 * ⚠⚠ LIGAR É GUARDAR A ESCOLHA DO CONTADOR — a data-piso, dita por ele, virando permanente.
 *
 * ⚠ `upsert`: religar com outra data é o caminho normal (o contador pode querer alcançar mais
 * atrás). A data NOVA vence, e as marcas de tentativa/resultado são zeradas — elas descrevem a
 * decisão anterior, e mantê-las faria a tela dizer "trouxe 12 notas" sobre um piso que não vale mais.
 */
export async function ligarVarreduraAutomatica({ portalClientId, dataPiso, usuarioId = null, client = prisma }) {
  if (!(dataPiso instanceof Date) || Number.isNaN(dataPiso.getTime())) {
    throw new Error("data_piso_invalida");
  }
  const chave = String(portalClientId);
  return client.varreduraAutomaticaDeNotas.upsert({
    where: { portalClientId: chave },
    create: { portalClientId: chave, dataPiso, ligadaPor: usuarioId ? String(usuarioId) : null },
    update: {
      dataPiso,
      ligadaPor: usuarioId ? String(usuarioId) : null,
      ultimaTentativaEm: null,
      ultimoResultadoEm: null,
      ultimoCriados: null,
      ultimoErro: null,
    },
  });
}

/**
 * ⚠⚠ DESLIGAR APAGA A LINHA — não há coluna `ativa`, e isso é escolha.
 *
 * Uma linha desligada guardaria uma data-piso que ninguém mais aplica, e a próxima pessoa a ligaria
 * de volta sem reescolher — herdando uma decisão tomada em outro contexto, sem saber. Religar é
 * escolher a data de novo, que é o ato inteiro.
 * ⚠ Nada do que a varredura já criou é tocado: a fila é fato consumado, e apagá-la desfaria
 * decisões do contador sobre notas que já estão lá.
 */
export async function desligarVarreduraAutomatica({ portalClientId, client = prisma }) {
  const r = await client.varreduraAutomaticaDeNotas.deleteMany({
    where: { portalClientId: String(portalClientId) },
  });
  return { desligadas: r.count };
}

/**
 * ⚠⚠ AS EMPRESAS QUE PEDIRAM A VARREDURA AUTOMÁTICA — e o resultado de cada uma.
 *
 * Chamada pelo worker de captura, logo depois de as notas chegarem: é o mesmo ciclo em que a nota
 * entra na base, e por isso ela aparece na fila no mesmo dia em que existe.
 *
 * ⚠⚠ **UMA EMPRESA NUNCA DERRUBA AS OUTRAS.** Falha vira `ultimoErro` GRAVADO — e o erro fica à
 * vista até uma varredura dar certo. Falha silenciosa aqui é como a captura ficou 29 dias parada em
 * produção sem ninguém perceber.
 * ⚠ `ultimaTentativaEm` é escrita SEMPRE, deu certo ou não: "olhei e não veio nada" e "ninguém
 * olhou" são respostas diferentes, e a tela precisa das duas.
 *
 * @param {object} args
 * @param {(a: object) => Promise<object>} [args.varrer] injetável — o teste não precisa do banco de notas.
 */
export async function varrerEmpresasComVarreduraAutomatica({
  agora = null,
  client = prisma,
  varrer = varrerNotasDaEmpresa,
  apenasPortalClientId = null,
} = {}) {
  const quando = agora instanceof Date ? agora : new Date();
  let configs = [];
  try {
    configs = await client.varreduraAutomaticaDeNotas.findMany({
      where: apenasPortalClientId ? { portalClientId: String(apenasPortalClientId) } : {},
      orderBy: { ultimaTentativaEm: "asc" },
    });
  } catch (e) {
    if (ausenciaDeEsquema(e)) return { varridas: 0, empresas: [], indisponivel: true };
    throw e;
  }

  const empresas = [];
  for (const c of configs) {
    let resultado = null;
    let erro = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      resultado = await varrer({
        portalClientId: c.portalClientId,
        dataPiso: c.dataPiso,
        // ⚠⚠ QUEM CRIOU FOI O SISTEMA, e a auditoria diz isso. Carimbar o contador que ligou a
        // varredura atribuiria a ele um ato que ele não praticou naquele instante — a mesma
        // distinção de `PRESUMIDO_POR_REGRA` contra `DECLARADO_PELO_CONTADOR`.
        criadoPor: "sistema:varredura_automatica",
        agora: quando,
        client,
      });
    } catch (e) {
      erro = e?.message || "falha desconhecida";
    }

    const criados = Number(resultado?.criados || 0);
    try {
      // eslint-disable-next-line no-await-in-loop
      await client.varreduraAutomaticaDeNotas.updateMany({
        where: { portalClientId: c.portalClientId },
        data: {
          ultimaTentativaEm: quando,
          // ⚠ Só marca RESULTADO quando alguma nota virou fila. Zero é "olhei e não veio nada".
          ...(criados > 0 ? { ultimoResultadoEm: quando, ultimoCriados: criados } : {}),
          ultimoErro: erro,
        },
      });
    } catch (e) {
      // ⚠ Não pode derrubar o ciclo: o trabalho já foi feito, e perder o registro dele é ruim —
      // perder a varredura das empresas seguintes é pior.
      erro = erro || e?.message || null;
    }

    empresas.push({ portalClientId: c.portalClientId, criados, erro });
  }

  return { varridas: empresas.length, empresas, indisponivel: false };
}
