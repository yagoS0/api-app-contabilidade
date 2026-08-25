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

export const RECUSA_DO_IMPORT = Object.freeze({
  ARQUIVO_VAZIO: "arquivo_vazio",
  NENHUMA_TRANSACAO: "nenhuma_transacao",
});

export const FRASE_DO_IMPORT = Object.freeze({
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

  const { conta, transacoes, descartadas } = lerOfx(buffer);
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
      descartadas: descartadas.length,
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
    descartadas,
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
