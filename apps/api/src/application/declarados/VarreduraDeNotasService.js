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
