// A ÚNICA PORTA DE ENTRADA DE NFS-e NO BANCO.
//
// Esta função morava dentro de `adn/AdnNotasService.js` e o import manual de XML
// (`routes/portalInvoices.js`) tinha uma SEGUNDA implementação, escrita à mão. As duas discordavam
// exatamente onde mais custa — na CHAVE de deduplicação:
//
//   • a captura grava `chaveAcesso` quando o XML tem chave e deixa `idNfse` NULO;
//   • o import gravava `chaveAcesso: null` FIXO e `idNfse = numeroNfse`, e dava upsert por
//     `clientId_idNfse`.
//
// Consequência medida no diagnóstico: o upsert do import nunca encontrava a linha da captura, e
// criava uma SEGUNDA linha da mesma nota — as duas `papel:"EMIT"`, `statusEfetivo:"autorizada"`,
// e o faturamento somava a nota duas vezes.
//
// O segundo efeito é pior que o primeiro: `ConferenciaAdnService.getNossoConjunto` monta o nosso
// conjunto com `chaveAcesso || idNfse`. A linha importada entra pelo NÚMERO, o ADN responde com
// CHAVES, o diff acusa `divergente` que não existe e `salvarFechamento` TRAVA. A única defesa
// contra nota faltando passava a acusar nota que está presente.
//
// ⚠ POR ISSO A REGRA MORA AQUI, EM UM LUGAR SÓ. Reimplementá-la no consumidor foi o que produziu a
// divergência; consertar "gravando a chave também no import" manteria duas cópias da mesma regra,
// livres para divergir de novo na próxima mudança.
//
// Quem chama:
//   • `adn/AdnNotasService.js`  — captura automática (ADN Nacional), dentro da transação do lote;
//   • `routes/portalInvoices.js` — import manual de XML (uma transação por arquivo).
// Os dois usam a MESMA chave de multi-tenancy: `PortalClient.id` (`portalClientId` na captura,
// `clientId` na rota são o mesmo id — a rota o valida em `ensurePortalClientAccess`).

import { log } from "../../config.js";
import { ESTADOS } from "./CompetenciaStateMachine.js";
import { substituirItensPreservandoClassificacao } from "./notaItens.js";

// ─── Competência fechada → vira pendência (mesmo padrão Dfe) ───────────────

async function isCompetenciaFechada(tx, { portalClientId, competenciaDate }) {
  if (!competenciaDate) return false;
  const d = new Date(competenciaDate);
  const comp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const row = await tx.companyMonthlyCircular.findFirst({
    where: { portalClientId, competencia: comp },
    select: { estado: true },
  });
  return row && [ESTADOS.FECHADO, ESTADOS.CALCULADO, ESTADOS.REVISADO, ESTADOS.TRANSMITIDO, ESTADOS.CONFIRMADO].includes(row.estado);
}

/**
 * Persiste UMA NFS-e (nota, não evento) em `PortalInvoice` + `NotaItem`.
 *
 * @param {Object} tx   client Prisma (ou transação) — o chamador decide o escopo transacional
 * @param {Object} opts
 * @param {string} opts.portalClientId  `PortalClient.id` (multi-tenancy)
 * @param {string} opts.companyCnpj     CNPJ da empresa (só dígitos ou com máscara)
 * @param {Object} [opts.item]          item cru do ADN (só para a chave top-level); ausente no import
 * @param {string} opts.xmlPlain        XML já decodificado
 * @param {Object} opts.metadata        saída de `parseXmlMetadata`
 * @returns {Promise<{status:string, notaId?:string, existia?:boolean, reason?:string}>}
 */
export async function upsertNfseFromItem(tx, { portalClientId, companyCnpj, item, xmlPlain, metadata }) {
  // Chave: do item ADN OU do XML (NFS-e Nacional traz a chave DENTRO do XML, não no item top-level).
  const chaveAcesso = item?.ChaveAcesso || item?.chaveAcesso || metadata.chaveAcesso || null;
  const idNfse = metadata.numeroNfse || null;
  // Sem NENHUM identificador (nem chave nem número) não dá pra deduplicar — aí sim pula.
  // Antes descartávamos toda NFS-e sem `item.ChaveAcesso` (a maioria!) → nota sumia da apuração.
  if (!chaveAcesso && !idNfse) return { status: "skipped", reason: "sem_identificador" };

  // Papel: EMIT se prestador é a empresa; senão DEST. NFS-e quase sempre EMIT
  // (a empresa só recebe DFe de NFS-e em casos específicos).
  const cnpjEmpresa = String(companyCnpj || "").replace(/\D+/g, "");
  const cnpjPrestador = metadata.cnpjPrestador || "";
  const cnpjTomador = metadata.cnpjTomador || "";
  const papel = cnpjPrestador && cnpjPrestador === cnpjEmpresa ? "EMIT" : "DEST";

  // ── A nota é MESMO desta empresa? ────────────────────────────────────────────────────────
  // Cinturão de segurança independente de como o certificado foi resolvido. Se a empresa não é nem
  // prestadora nem tomadora, o documento não é dela — e gravar assim mesmo é o que fazia as notas
  // do escritório aparecerem na carteira do cliente (como DEST, porque o CNPJ não batia).
  //
  // Isto pega uma classe inteira, não um caso: cert do escritório, A1 errado subido na empresa
  // errada, ou qualquer futura mudança na resolução de certificado. Nenhuma delas avisa sozinha.
  //
  // Só rejeita quando HÁ CNPJ e ele não bate. Metadado sem nenhum dos dois (parser que não achou o
  // campo) não é evidência de nota alheia — aí grava, porque descartar por falta de dado
  // esconderia nota legítima, que é o erro oposto e igualmente caro.
  //
  // ⚠ O IMPORT MANUAL É MAIS ESTRITO QUE ISTO, de propósito, e continua sendo: lá o arquivo é
  // escolhido por uma pessoa, e a titularidade é conferida ANTES desta chamada (`nota_nao_pertence`,
  // que também recusa metadado sem CNPJ nenhum). Esta guarda é o piso comum, não o teto.
  if (cnpjEmpresa && (cnpjPrestador || cnpjTomador)
      && cnpjPrestador !== cnpjEmpresa && cnpjTomador !== cnpjEmpresa) {
    // ⚠ ESTA RECUSA PRECISA APARECER NO LOG, com os três CNPJs.
    //
    // A guarda está certa em princípio, mas ela é a ÚNICA coisa no fluxo capaz de fazer uma empresa
    // "ficar sem notas mesmo tendo emitido" em silêncio — o documento é lido, contado em
    // `totalDocs`, e descartado sem deixar registro. Do lado de fora isso é indistinguível de "não
    // havia nota".
    //
    // E há dois desfechos opostos que só os CNPJs distinguem:
    //   • prestador = CNPJ do ESCRITÓRIO  → recusa CORRETA (é a nota do escritório, não do cliente);
    //   • prestador = a própria empresa com outro sufixo de filial, ou CPF onde o cadastro tem CNPJ,
    //     ou CNPJ digitado errado no cadastro → recusa INDEVIDA, e a nota legítima some.
    //
    // Sem esta linha não dá para saber qual dos dois aconteceu sem reprocessar tudo.
    log.warn(
      { portalClientId, cnpjEmpresa, cnpjPrestador: cnpjPrestador || null, cnpjTomador: cnpjTomador || null, chaveAcesso, idNfse },
      "[NFS-e] documento RECUSADO: nem prestador nem tomador é a empresa",
    );
    return {
      status: "rejeitada_outro_cnpj",
      reason: `documento de ${cnpjPrestador || "?"} → ${cnpjTomador || "?"}, empresa é ${cnpjEmpresa}`,
    };
  }

  const competenciaDate = metadata.competencia || metadata.dataEmissao || null;
  const fechada = await isCompetenciaFechada(tx, { portalClientId, competenciaDate });
  const canceladaNoXml = metadata.situacao === "CANCELADA" || metadata.situacao === "2";

  // Dedup: por chaveAcesso quando houver; senão por idNfse (numeroNfse). idNfse só é escrito no
  // fallback sem-chave — evita colisão com nota DEST de mesmo número emitida por outro prestador.
  const where = chaveAcesso
    ? { clientId_chaveAcesso: { clientId: portalClientId, chaveAcesso } }
    : { clientId_idNfse: { clientId: portalClientId, idNfse } };

  // Preserva o cancelamento numa re-captura: nunca rebaixa "cancelada" → "autorizada".
  const existing = await tx.portalInvoice.findUnique({ where, select: { id: true, statusEfetivo: true } }).catch(() => null);
  const statusEfetivo = existing?.statusEfetivo === "cancelada" || canceladaNoXml ? "cancelada" : "autorizada";

  const dataToWrite = {
    type: "NFSE",
    numero: metadata.numeroNfse,
    chaveAcesso: chaveAcesso || null,
    ...(chaveAcesso ? {} : { idNfse }),
    competencia: competenciaDate,
    issueDate: metadata.dataEmissao,
    total: metadata.valorServicos,
    emitenteNome: metadata.prestadorNome,
    emitenteDoc: metadata.cnpjPrestador,
    tomadorNome: metadata.tomadorNome,
    tomadorDoc: metadata.cnpjTomador,
    xmlRaw: xmlPlain || null,
    status: canceladaNoXml ? "CANCELADA" : "EMITIDA",
    papel,
    statusEfetivo,
    // ⚠ O VÍNCULO VEM DA PRÓPRIA NOTA, e é por isso que ele sobrevive onde o evento não sobreviveu.
    // `<subst><chSubstda>` viaja dentro do XML da substituta (leiaute ANEXO_I v1.01) — o mesmo XML
    // que já guardávamos inteiro em `xmlRaw` e do qual ninguém lia este bloco. Medido: 22 notas na
    // base o carregam. Nulo em quem não substitui ninguém, que é a maioria esmagadora.
    //
    // ⚠ O import manual NÃO GRAVAVA estes dois campos — nota substituída importada perdia o
    // vínculo. Está aqui porque a extração é o que faz os dois caminhos gravarem o mesmo conjunto.
    chaveSubstituida: metadata.chaveSubstituida || null,
    motivoSubstituicao: metadata.motivoSubstituicao || null,
    competenciaPosFechamento: fechada || false,
  };

  if (fechada) {
    const created = await tx.portalInvoice.upsert({
      where,
      create: { clientId: portalClientId, ...dataToWrite },
      update: { competenciaPosFechamento: true, statusEfetivo },
    });
    const comp = competenciaDate
      ? `${new Date(competenciaDate).getUTCFullYear()}-${String(new Date(competenciaDate).getUTCMonth() + 1).padStart(2, "0")}`
      : "?";
    await tx.pendenciaPosFechamento.create({
      data: {
        portalClientId, competencia: comp, notaId: created.id,
        motivo: "nota_retroativa",
        observacoes: `NFS-e ${chaveAcesso || idNfse} chegou para ${comp} (competência já fechada).`,
      },
    }).catch(() => null);
    return { created: created.id, notaId: created.id, existia: Boolean(existing), status: "pendencia_criada" };
  }

  const upserted = await tx.portalInvoice.upsert({
    where,
    create: { clientId: portalClientId, ...dataToWrite },
    update: dataToWrite,
    select: { id: true },
  });

  // Q12.C fix: NFS-e Nacional traz 1 serviço por nota — cria/atualiza NotaItem
  // pra alimentar ClassificadorAnexos (LC116 → III/IV/V) e CalculoFiscal.
  //
  // ⚠ A recriação PRESERVA a classificação do item que não mudou (ver `notaItens.js`). Antes era
  // `deleteMany` + `create` seco, e toda recaptura apagava `tipoReceita`/`anexoResolvido`/
  // `classificadoEm` em silêncio.
  if (metadata.codigoServico) {
    await substituirItensPreservandoClassificacao(tx, {
      notaId: upserted.id,
      itens: [{
        codigoServico: metadata.codigoServico,
        descricao: metadata.descricaoServico || null,
        valor: Number(metadata.valorServicos || 0),
      }],
    });
  }
  return { status: "upserted", notaId: upserted.id, existia: Boolean(existing) };
}
