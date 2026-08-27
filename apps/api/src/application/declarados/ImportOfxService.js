// O IMPORT DE EXTRATO OFX DO CLIENTE.
//
// > Pergunta do dono (24/08/2026): *"temos alguma proteção caso o cliente queira importar vários,
// > sendo mesmo?"*
//
// **Não tínhamos.** Medido: o import do escritório não guarda hash de arquivo, `fitId` **não
// existe** em `AccountingEntry`, e o lote é `OFX-${Date.now()}` — duas subidas do mesmo arquivo
// produzem dois conjuntos completos de lançamentos. (Não mordeu porque ninguém usou: produção tem
// **0** lançamentos de origem OFX.) Este caminho nasce com a proteção.
//
// ## ⚠⚠ A SOBREPOSIÇÃO É O CASO NORMAL
//
// O cliente baixa 01–31/jan, depois 15/jan–15/fev. Isso é o comportamento esperado de quem usa
// internet banking, não engano. Por isso a proteção **não** recusa arquivo repetido: ela deduplica
// **transação a transação**, e o `@@unique(portalClientId, hashDedupe)` é quem decide.
//
// ## As três camadas
//
//   1. **`FITID`** — o identificador do próprio banco (`lib/dedupeOfx.js`).
//   2. **Impressão digital com ordinal** — quando o banco não manda `FITID`. ⚠ Duas tarifas iguais
//      no mesmo dia são legítimas, e o ordinal posicional é o que as preserva.
//   3. **Hash do arquivo** — ⚠ **INFORMATIVO, nunca bloqueio**: permite dizer *"você já subiu este
//      arquivo em 12/08"* em vez de um "0 novas" indistinguível de um período já importado.

import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { lerOfx } from "../accounting/lib/ofx.js";
import { DeclaradoRecusado, RECUSA_DO_SERVICO, criarDeclarado } from "./DeclaradoService.js";
import { ORIGEM_PAGAMENTO } from "./lib/estadosDeclarado.js";
import { anomaliasDoExtrato, identidadesDoExtrato } from "./lib/dedupeOfx.js";

/** ⚠ Heurística, não norma — ver a guarda em `importarOfxDoCliente`. */
export const MAXIMO_DE_TRANSACOES = 10000;

/** ⚠ Quantos exemplos de descarte voltam no relatório. A CONTAGEM é sempre a real. */
export const LIMITE_DE_EXEMPLOS = 50;

export const RECUSA_DO_IMPORT = Object.freeze({
  ARQUIVO_VAZIO: "arquivo_vazio",
  NENHUMA_TRANSACAO: "nenhuma_transacao",
  /** ⚠⚠ O extrato traz mais transações do que um extrato de verdade traria. */
  EXTRATO_GRANDE_DEMAIS: "extrato_grande_demais",
});

export const FRASE_DO_IMPORT = Object.freeze({
  [RECUSA_DO_IMPORT.EXTRATO_GRANDE_DEMAIS]:
    `Este extrato tem mais de ${MAXIMO_DE_TRANSACOES.toLocaleString("pt-BR")} transações. Divida o período e envie em partes.`,
  [RECUSA_DO_IMPORT.ARQUIVO_VAZIO]: "O arquivo enviado está vazio.",
  [RECUSA_DO_IMPORT.NENHUMA_TRANSACAO]:
    "Não foi possível ler nenhuma transação neste arquivo. Confira se ele é o extrato em formato OFX que o banco disponibiliza.",
});

/**
 * ⚠⚠ A COMPETÊNCIA DE UM DÉBITO DE EXTRATO SAI DA DATA DA TRANSAÇÃO — e isso NÃO é invenção
 * nossa: é o que o import de OFX do ESCRITÓRIO já faz, medido em `accountingEntries.js`
 * (`const competencia = ${dataDate.getUTCFullYear()}-${mês}`).
 *
 * ⚠ E é diferente do caso da NOTA, onde deduzir é proibido: a nota **tem** competência própria, e
 * sobrescrevê-la seria descartar dado real. O extrato não tem nenhuma — derivar é a única leitura
 * possível, e o contador pode trocá-la.
 *
 * ⚠ UTC, o mesmo critério de `utils/dataCivil.js`: converter para o fuso do processo faria a
 * transação do dia 1º cair no mês anterior.
 */
const competenciaDaTransacao = (d) =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 7) : null;

const recusar = (codigo) => {
  throw new DeclaradoRecusado(codigo, FRASE_DO_IMPORT[codigo] || "");
};

/**
 * Importa um extrato OFX para a fila de conferência.
 *
 * @param {Buffer} args.buffer o arquivo
 * @param {Date}   args.agora ⚠ injetado — este serviço não lê o relógio
 */
export async function importarOfxDoCliente({
  portalClientId,
  buffer,
  nomeArquivo = null,
  criadoPor,
  agora,
  client = prisma,
}) {
  if (!buffer?.length) recusar(RECUSA_DO_IMPORT.ARQUIVO_VAZIO);

  const { conta, transacoes, descartadas: todasDescartadas } = lerOfx(buffer);

  // ⚠⚠ O TETO DE TRANSAÇÕES — achado por auditoria em 25/08/2026, e MEDIDO: um arquivo de 10 MB
  // (o limite do multer) cabe **154.201 débitos**. A gravação é sequencial de propósito (é o
  // `@@unique` do banco que resolve corrida), então isso seriam ~150 mil INSERTs segurando uma
  // conexão do pool, num processo sem timeout de requisição.
  //
  // ⚠ Quem pode fazer isso é o piso MAIS BAIXO do sistema — qualquer membro ativo do lado do
  // cliente. E o estrago não fica na empresa dele: derruba a API para a carteira inteira.
  //
  // ⚠ O número é heurística, não norma: um extrato mensal de empresa tem dezenas a centenas de
  // linhas. 10 mil é folgado o bastante para um ano inteiro de conta movimentada e apertado o
  // bastante para não travar o processo. Recusa NOMEADA — o cliente sabe o que fazer (dividir o
  // período), em vez de ver a API cair.
  if (transacoes.length > MAXIMO_DE_TRANSACOES) {
    recusar(RECUSA_DO_IMPORT.EXTRATO_GRANDE_DEMAIS);
  }

  // ⚠⚠ E `descartadas` NÃO VOLTA INTEIRA. Medido: 145.634 blocos inválidos viram **22,9 MB de
  // JSON** — gravados numa coluna Jsonb E serializados na resposta. O relatório existe para o
  // cliente saber O QUE não entrou; para isso bastam a CONTAGEM e uma amostra. Mesma disciplina do
  // `LIMITE_NOTAS_SEM_COMPETENCIA` da auditoria de notas.
  const descartadas = todasDescartadas.slice(0, LIMITE_DE_EXEMPLOS);
  // ⚠ "Nenhuma transação" recusa; "todas descartadas" NÃO — no segundo caso há o que relatar, e
  // engolir isso num erro genérico esconderia justamente o motivo de cada descarte.
  if (!transacoes.length && !descartadas.length) recusar(RECUSA_DO_IMPORT.NENHUMA_TRANSACAO);

  const hashArquivo = crypto.createHash("sha256").update(buffer).digest("hex");

  // ⚠ INFORMATIVO. Achar não bloqueia nada — só permite a frase honesta na tela.
  const anterior = await client.ofxImport.findFirst({
    where: { portalClientId: String(portalClientId), hashArquivo },
    orderBy: { criadoEm: "desc" },
    select: { id: true, criadoEm: true, criados: true, jaImportadas: true },
  });

  const identidades = identidadesDoExtrato(transacoes, conta);
  const anomalias = anomaliasDoExtrato(identidades, conta);

  // ⚠⚠ SÓ DÉBITO ENTRA. Esta fila é de DESPESA: a forma do lançamento de ENTRADA não foi medida
  // (`formaDoLancamento.js` só sabe `D despesa / C caixa`), e criar item de fila que ninguém
  // consegue resolver é beco sem saída. Os créditos são CONTADOS e nomeados, nunca sumidos.
  const debitos = identidades.filter((i) => i.transacao.sinal === "DEBITO");
  const foraDoEscopo = identidades.length - debitos.length;

  const registro = await client.ofxImport.create({
    data: {
      portalClientId: String(portalClientId),
      hashArquivo,
      nomeArquivo: nomeArquivo ? String(nomeArquivo) : null,
      contaBancaria: conta?.acctId || null,
      bancoId: conta?.bankId || null,
      transacoesLidas: transacoes.length,
      criados: 0,
      jaImportadas: 0,
      descartadas: todasDescartadas.length,
      foraDoEscopo,
      detalhe: { anomalias, descartadas },
      criadoPor: String(criadoPor || ""),
      ...(agora instanceof Date && !Number.isNaN(agora.getTime()) ? { criadoEm: agora } : {}),
    },
    select: { id: true },
  });

  let criados = 0;
  let jaImportadas = 0;
  const recusadas = [];

  // ⚠ SEQUENCIAL, sem parâmetro de concorrência — parâmetro é como alguém põe 20 nele depois, e a
  // corrida entre dois uploads é justamente o que o `@@unique` existe para pegar.
  for (const { transacao: t, hashDedupe, chave } of debitos) {
    try {
      const r = await criarDeclarado({
        portalClientId,
        origem: "OFX_CLIENTE",
        tipo: "SAIDA",
        valor: t.valor,
        competencia: competenciaDaTransacao(t.data),
        descricaoOriginal: t.historico || `Débito de ${t.valor}`,
        // ⚠⚠ O DÉBITO DO EXTRATO **É** O PAGAMENTO — ele traz a data em que o dinheiro saiu, então
        // o declarado nasce `A_CONFERIR`, não `AGUARDANDO_PAGAMENTO`. E a procedência é PROVA.
        dataPagamento: t.data,
        origemPagamento: ORIGEM_PAGAMENTO.OFX,
        ofxImportId: registro.id,
        fitId: t.fitId,
        contaBancariaRef: conta?.acctId || null,
        hashDedupe,
        criadoPor,
        agora,
        client,
      });
      if (r.jaExistia) jaImportadas += 1;
      else criados += 1;
    } catch (e) {
      // ⚠ Uma transação recusada não derruba o extrato, e não some: vira linha nomeada.
      recusadas.push({
        fitId: t.fitId,
        historico: t.historico,
        chave,
        codigo: e?.codigo || "erro",
        motivo: e?.frase || String(e?.message || e),
      });
    }
  }

  await client.ofxImport.update({
    where: { id: registro.id },
    data: { criados, jaImportadas, detalhe: { anomalias, descartadas, recusadas } },
  });

  return {
    importId: registro.id,
    conta,
    transacoesLidas: transacoes.length,
    criados,
    jaImportadas,
    // ⚠⚠ `descartadas` É ARRAY TRUNCADO EM 50; SEUS IRMÃOS SÃO NÚMEROS. A contagem REAL ia para a
    // coluna (`data.descartadas = todasDescartadas.length`) e **não voltava** — quem escrevesse
    // `descartadas.length` na tela diria "50" num arquivo com 145 mil blocos inválidos.
    //
    // ⚠ Conserto ADITIVO: `descartadas` continua sendo a AMOSTRA, com o mesmo nome e o mesmo
    // conteúdo. Renomeá-la quebraria quem já a lê. O que entra é a verdade que faltava.
    descartadas,
    descartadasTotal: todasDescartadas.length,
    // ⚠ E a tela precisa saber que a amostra é amostra: sem isto ela não tem como distinguir
    // "descartou 50" de "descartou 50 dos 145.634".
    descartadasTruncadas: todasDescartadas.length > descartadas.length,
    foraDoEscopo,
    recusadas,
    anomalias,
    // ⚠ A frase honesta que só o hash permite: sem isto, um extrato já importado por inteiro e um
    // arquivo repetido dão exatamente a mesma resposta ("0 novas").
    arquivoJaImportado: anterior
      ? { em: anterior.criadoEm, criadosNaquela: anterior.criados, jaImportadasNaquela: anterior.jaImportadas }
      : null,
  };
}

export { RECUSA_DO_SERVICO };
