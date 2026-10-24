// UMA INGESTÃO DE NF-e SÓ — a captura da SEFAZ e o import de arquivo gravam pela MESMA função.
//
// ⚠ ESTE ARQUIVO É EXTRAÇÃO, NÃO IMPLEMENTAÇÃO NOVA. O corpo abaixo saiu inteiro de
// `notas/dfe/DfeSyncService.js` (onde se chamava `upsertNotaFromParsed`), pelo mesmo motivo que
// `ingestaoNfse.js` saiu de `AdnNotasService`: quando o import escreveu a própria persistência de
// NFS-e, ele dedupicou por uma chave diferente da captura, o upsert nunca encontrava a linha da
// captura, nascia uma SEGUNDA linha da mesma nota — e **o faturamento somou a nota duas vezes**.
// Está registrado em `apps/api/CLAUDE.md`, seção "NFS-e: UMA ingestão só". Não repita o defeito no
// documento onde ele custa mais: a NF-e de VENDA é a receita.
//
// O que cada caminho faz A MAIS continua sendo dele:
//   • captura DFe  → cursor NSU, backoff, janela de 1 h da SEFAZ, manifestação;
//   • import ZIP   → titularidade (`nota_nao_pertence`), papel medido, contagem por arquivo.
// O que os dois compartilham é ISTO: a linha em `PortalInvoice` e os itens.

import { prepararDocumentoNota, bloquearDocumentosDaEmpresa } from "./persistirDocumentoNota.js";
import { situacaoDoPeriodo, registrarPendenciaDoPeriodo } from "./pendenciasDoPeriodo.js";
import { substituirItensPreservandoClassificacao } from "./notaItens.js";
import { provaDaCapturaDfe } from './dfe/provenienciaDfe.js';

/**
 * Decide se a competência da nota está FECHADA. Se sim, não atualiza base —
 * cria PendenciaPosFechamento e marca a nota com competenciaPosFechamento=true.
 */
export async function isCompetenciaFechada(tx, { portalClientId, competenciaDate }) {
  if (!competenciaDate) return false;
  return (await situacaoDoPeriodo(tx, { portalClientId, competencia: competenciaDate })).exigeRevisao;
}

/**
 * Grava (ou atualiza) UMA NF-e a partir do `parsed` do `DfeParser`.
 *
 * @returns {{status:"upserted"|"pendencia_criada", created:string, notaId:string, existia:boolean}}
 *          ou {{skipped:true, reason:"no_chave"}}
 *
 * ⚠ `existia` foi ACRESCENTADO na extração, e é o único campo novo. Sem ele o import não tem como
 * dizer "importadas X · duplicadas Y" — e o relatório desse import é requisito, não enfeite: o lote
 * do Fisco Fácil pode vir legitimamente vazio, e sem os contadores o dono não distingue
 * "não veio nada" de "deu erro". A captura ignora o campo; nada mudou para ela.
 */
export async function upsertNfeFromParsed(tx, { portalClientId, parsed, items, capturaDfe }) {
  if (!parsed.chaveAcesso) return { skipped: true, reason: "no_chave" };

  await bloquearDocumentosDaEmpresa(tx, portalClientId);
  // Confere competência fechada
  let fechada = await isCompetenciaFechada(tx, {
    portalClientId, competenciaDate: parsed.competencia,
  });

  // Preserva o cancelamento: o cancelamento de NF-e chega num EVENTO separado (applyEvent grava
  // statusEfetivo="cancelada"). O resumo/nota da NF-e traz statusEfetivo hardcoded "autorizada";
  // sem isso, uma re-captura da nota reverteria o cancelamento.
  const wKey = { clientId_chaveAcesso: { clientId: portalClientId, chaveAcesso: parsed.chaveAcesso } };
  // Import/capture callers supply a transaction; serialize the same fiscal identity before reading evidence.
  if (typeof tx.$queryRaw === 'function') {
    const identity = `${portalClientId}:${parsed.chaveAcesso}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${identity}))::text AS lock_result`;
  }
  const existente = await tx.portalInvoice.findUnique({ where: wKey });
  if (existente?.competencia) fechada = fechada || await isCompetenciaFechada(tx, { portalClientId, competenciaDate: existente.competencia });
  const existia = Boolean(existente);
  const portal = tx.portalClient?.findUnique
    ? await tx.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true } }) : null;
  const provenienciaDfe = provaDaCapturaDfe(capturaDfe, { clientId: portalClientId,
    cnpj: portal?.cnpj, chave: parsed.chaveAcesso, xml: parsed.xmlRaw || parsed.xmlResumo });
  // Never accept a proof nested in parsed (the importer's shared DTO).
  const { documentoPreservado, ...documento } = prepararDocumentoNota(existente,
    { ...parsed, clientId: portalClientId, provenienciaDfe }, portal?.cnpj);
  const statusEfetivo = existente?.statusEfetivo === "cancelada" ? "cancelada" : (parsed.statusEfetivo || null);

  const dataToWrite = {
    ...documento,

    type: parsed.type,
    numero: parsed.numero || null,
    serie: parsed.serie || null,
    chaveAcesso: parsed.chaveAcesso,
    competencia: parsed.competencia,
    issueDate: parsed.issueDate,
    status: parsed.status,
    total: parsed.total,
    emitenteNome: parsed.emitenteNome || null,
    emitenteDoc: parsed.emitenteDoc || null,
    tomadorNome: parsed.tomadorNome || null,
    tomadorDoc: parsed.tomadorDoc || null,

    papel: parsed.papel || null,
    statusEfetivo,
    competenciaPosFechamento: fechada,
  };

  if (fechada) {
    const mudou = !existente || existente.statusEfetivo !== statusEfetivo;
    // Não atualiza base — cria a nota mas só registra a pendência.
    const created = await tx.portalInvoice.upsert({
      where: wKey,
      create: { clientId: portalClientId, ...dataToWrite },
      update: { ...(mudou ? { competenciaPosFechamento: true } : {}), statusEfetivo },
    });
    if (mudou) {
      await registrarPendenciaDoPeriodo(tx, { portalClientId, competencia: parsed.competencia,
        chaveAcesso: parsed.chaveAcesso, notaId: created.id, papel: parsed.papel, valor: parsed.total,
        evento: existente ? 'evento_retroativo' : 'nota_retroativa' });
    }
    return { created: created.id, notaId: created.id, existia, status: mudou ? "pendencia_criada" : "upserted" };
  }

  const nota = await tx.portalInvoice.upsert({
    where: wKey,
    create: { clientId: portalClientId, ...dataToWrite },
    update: documentoPreservado ? { ...documento, statusEfetivo } : { ...dataToWrite, issueDate: existente ? existente.issueDate : dataToWrite.issueDate, competencia: existente ? existente.competencia : dataToWrite.competencia },
  });

  // Substitui itens (full overwrite): mais simples + idempotente. Volume é pequeno.
  //
  // ⚠ O "full overwrite" ERA LITERAL — `deleteMany` + `createMany` apagava `tipoReceita`,
  // `anexoResolvido`, `classificadoEm` e `sujeitoFatorR` de todo item, em silêncio. A recaptura
  // corrige a nota; ela não pode desfazer a classificação. O casamento item-antigo × item-novo e o
  // motivo do critério estão em `./notaItens.js`.
  if (!documentoPreservado && items && items.length > 0) {
    await substituirItensPreservandoClassificacao(tx, { notaId: nota.id, itens: items });
  }
  return { created: nota.id, notaId: nota.id, existia, status: "upserted" };
}
