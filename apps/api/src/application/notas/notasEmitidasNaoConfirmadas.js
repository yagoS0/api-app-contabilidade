// A NOTA QUE NÓS EMITIMOS E QUE O ADN AINDA NÃO TROUXE DE VOLTA.
//
// ─── O PEDIDO DO DONO (19/08/2026) ───────────────────────────────────────────────────────────
//
// > *"as notas que aparecem para o cliente são apenas as notas que vêm da consulta ADN, porém ao
// > emitir uma nota, ela deve aparecer para o cliente, e depois que consultar o ADN aí fica
// > confirmada na tela; deve ficar mais clarinha e, quando confirmada ADN, ela fica viva como as
// > outras."*
//
// ─── O SINTOMA, MEDIDO ───────────────────────────────────────────────────────────────────────
//
// A lista do cliente é `routes/portalInvoices.js` (`GET /`), que lê **`PortalInvoice`** — a
// PROJEÇÃO do ADN. A emissão (`NfseService.issue`, `NfseService.js:1445-1466` e `:1507-1515`)
// grava **`ServiceInvoice`** e **nunca** um `PortalInvoice`. Entre emitir e a próxima captura, a
// nota simplesmente não existe para o cliente.
//
// ─── ⚠ POR QUE UNIÃO NA LEITURA, E NÃO GRAVAR `PortalInvoice` NA EMISSÃO ─────────────────────
//
// `PortalInvoice` é a projeção de um sistema EXTERNO, e ela tem donos declarados
// (`notas/ingestaoNfse.js`, "A ÚNICA PORTA DE ENTRADA DE NFS-e NO BANCO", mais o motor legado
// `sync/InvoiceSyncEngine.js`). Escrever ali na emissão criaria uma quarta escrita, com uma linha
// que a captura não sabe que existe — e o encontro das duas é exatamente onde este projeto já
// mediu duplicata: o import manual gravava `chaveAcesso: null` fixo, o upsert da captura nunca
// achava a linha, e **o faturamento somava a nota duas vezes** (cabeçalho de `ingestaoNfse.js`).
// Pior: a linha escrita à mão não teria o `xmlRaw` do sistema nacional, e é dele que saem os
// campos fiscais, o DANFSe e a série/nDPS da próxima emissão.
//
// Na LEITURA, a duplicata é reversível: um dedup errado mostra ou esconde uma linha, e a correção
// é uma linha de código. Na ESCRITA ela é permanente e contamina o dinheiro.
//
// ⚠ ESTE MÓDULO NÃO ESCREVE NADA. Ele só lê `ServiceInvoice` e decide, em memória, quais das
// linhas emitidas por nós **ainda não têm par** em `PortalInvoice`.
//
// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A CHAVE DA DEDUPLICAÇÃO — e por que ela IDENTIFICA
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// São TRÊS provas independentes, aplicadas em ordem. Cada uma é SUFICIENTE sozinha; nenhuma
// produz falso positivo; juntas cobrem inclusive a nota SEM CHAVE.
//
// **1. `chaveAcesso`** — o identificador do documento.
//    • ADN  : `ingestaoNfse.js:70` — `item.ChaveAcesso ?? metadata.chaveAcesso` (do XML).
//    • nossa: `NfseService.js:1510` — `response.chaveAcesso || response.numeroNfse || null`.
//    ⚠ O `|| response.numeroNfse` é um FALLBACK, e ele torna esta prova INCOMPLETA (a coluna pode
//    guardar um número onde deveria haver chave) — mas **não a torna insegura**: a chave da NFS-e
//    Nacional tem 50 dígitos e um `nNFSe` tem poucos, então um número nunca casa com uma chave
//    alheia. Prova forte, cobertura parcial. Por isso existem as outras duas.
//
// **2. A TUPLA DO E0014 — `(série, nDPS)`.** É a prova COMPLETA, e a única que funciona sem chave
//    nenhuma dos dois lados.
//    • nossa: `ServiceInvoice.rpsSerie` + `rpsNumero`, RESERVADOS transacionalmente
//      (`nfseNumeracao.js`) e protegidos por `@@unique([companyId, rpsSerie, rpsNumero])`. Eles
//      existem em **toda** linha nossa, sempre — a reserva acontece antes de qualquer envio.
//    • ADN  : `lerSerieENumeroDaDps(PortalInvoice.xmlRaw)` (`nfse/nfseUltimaNota.js`), que lê
//      `NFSe/infNFSe/DPS/infDPS/{serie,nDPS}` **por caminho**, nunca por nome de tag.
//    • São literalmente os MESMOS números: `buildDpsXml` escreve `<serie>` e `<nDPS>` a partir da
//      numeração reservada (`NfseService.js:526`, `:776-777`), e o sistema nacional devolve a DPS
//      **dentro** da NFS-e — é por isso que `nfseUltimaNota.js` consegue lê-los das notas
//      capturadas.
//    • ⚠ POR QUE ELA IDENTIFICA, e não só "parece": a RN **E0014** rejeita uma DPS cujo conjunto
//      *Série + Número + Código do Município Emissor + CNPJ/CPF* já exista. Aqui o escopo já fixa
//      os dois últimos — uma `PortalClient` ↔ uma `Company` (`PortalClient.companyId` é `@unique`)
//      ↔ um CNPJ (`Company.cnpj` é `@unique`) ↔ um `cLocEmi`. Dentro desse escopo, `(série, nDPS)`
//      é única **pela regra do próprio sistema nacional**, não por convenção nossa.
//    • ⚠ Só vale com `papel: "EMIT"`: a numeração de uma nota RECEBIDA é do prestador dela.
//    • Cobertura: exige `xmlRaw` na linha do ADN. Medido em produção
//      (`scripts/diag-cobertura-xml-notas.mjs`, citado em `schema.prisma`): **EMIT 14.946 = 100%**.
//
// **3. `numeroNfse` (`nNFSe`)** — a rede de segurança quando o XML não pôde ser lido.
//    • ADN  : `PortalInvoice.numero` = `metadata.numeroNfse`.
//    • nossa: `ServiceInvoice.numeroNfse` = `response.numeroNfse`.
//    É o contador do município/SEFIN para AQUELE emitente; no escopo `papel: EMIT` de uma empresa
//    ele não se repete. Ausente enquanto a nota não tiver desfecho — daí ser a terceira.
//
// ⚠⚠ **AUSÊNCIA NÃO VIRA IGUALDADE.** Cada prova só é aplicada quando os DOIS lados têm o valor.
// Chave nula dos dois lados **não** é "são a mesma"; número nulo dos dois lados **não** é "são a
// mesma". É a mesma disciplina de `ingestaoNfse.js` ("sem NENHUM identificador não dá pra
// deduplicar") e do índice único do Postgres, onde NULL nunca é igual a NULL.
//
// ⚠ O RESÍDUO INDECIDÍVEL, dito em voz alta: uma linha do ADN sem `chaveAcesso`, sem `numero` e
// sem `xmlRaw` legível não casa com nada — e a nossa linha continuaria aparecendo como *não
// confirmada* ao lado dela. Nenhum dos dois lados foi inventado, e é por isso que este caso fica
// como está em vez de virar um palpite: adivinhar "devem ser a mesma" apagaria uma nota real.
// Hoje ele não é alcançável (a captura RECUSA documento sem chave E sem número, e grava `xmlRaw`
// sempre que grava a linha).

import { prisma } from "../../infrastructure/db/prisma.js";
import { lerSerieENumeroDaDps } from "../nfse/nfseUltimaNota.js";

/**
 * Status de `ServiceInvoice` que NÃO são "esta nota foi emitida".
 *
 * ⚠ `pending` está aqui por dois motivos, e o primeiro basta: ele é o valor gravado **na reserva
 * do número**, antes de o pedido sair da máquina (`NfseService.js:1465`). Uma linha `pending` pode
 * ser uma emissão em voo, ou um 202 cujo desfecho ninguém conhece — e "a nota existe" é
 * exatamente o que não se sabe. `rejected` (recusa fiscal) e `falha_envio` (erro nosso / queda de
 * rede) não geraram nota nenhuma. Ver `application/nfse/desfechoEmissao.js`.
 */
const STATUS_SEM_NOTA = new Set(["pending", "rejected", "falha_envio"]);

/** Teto de linhas lidas. Não é filtro: é a defesa contra uma empresa com captura parada há meses. */
export const TETO_EMITIDAS = 200;

/**
 * A série no MESMO formato dos dois lados: 5 dígitos, só o número.
 *
 * ⚠ NÃO reusa `normalizarSerie` de propósito — aquela LANÇA quando a série está fora da faixa
 * E0010, e é isso que ela existe para fazer **na emissão**. Aqui a pergunta é outra: "estas duas
 * linhas falam da mesma nota?". Recusar a comparação por causa de uma série inválida faria a nota
 * aparecer duas vezes justamente no caso em que o cadastro está torto. A FORMA de saída é a
 * mesma (`String(Number(d)).padStart(5,"0")`), que é também a de `lerSerieENumeroDaDps`.
 */
function serieComparavel(valor) {
  const digitos = String(valor ?? "").replace(/\D+/g, "");
  if (!digitos) return null;
  const n = Number(digitos);
  return Number.isSafeInteger(n) ? String(n).padStart(5, "0") : null;
}

function numeroComparavel(valor) {
  const digitos = String(valor ?? "").replace(/\D+/g, "");
  if (!digitos) return null;
  const n = Number(digitos);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function textoComparavel(valor) {
  const t = String(valor ?? "").trim();
  return t || null;
}

/**
 * As três provas de identidade de uma linha, do lado que for.
 * @returns {{chave: string|null, tupla: string|null, numero: string|null}} — `null` onde o lado
 *   não tem o dado. **Nunca** uma string vazia: ausência não pode casar com ausência.
 */
export function identidadeDaNota({ chaveAcesso, serie, numeroDps, numeroNfse }) {
  const s = serieComparavel(serie);
  const n = numeroComparavel(numeroDps);
  return {
    chave: textoComparavel(chaveAcesso),
    tupla: s && n ? `${s}/${n}` : null,
    numero: textoComparavel(numeroNfse ? String(numeroNfse).trim() : null),
  };
}

/** A identidade de uma linha nossa (`ServiceInvoice`). */
export function identidadeDaEmissao(si) {
  return identidadeDaNota({
    chaveAcesso: si?.chaveAcesso,
    serie: si?.rpsSerie,
    numeroDps: si?.rpsNumero,
    numeroNfse: si?.numeroNfse,
  });
}

/**
 * A identidade de uma linha do ADN (`PortalInvoice`).
 * ⚠ A tupla sai do `xmlRaw` — não há coluna com a série/nDPS de uma NFS-e capturada
 * (tabela em `nfse/nfseUltimaNota.js`).
 */
export function identidadeDaProjecao(pi) {
  const { serie, numero } = lerSerieENumeroDaDps(pi?.xmlRaw);
  return identidadeDaNota({
    chaveAcesso: pi?.chaveAcesso,
    serie,
    numeroDps: numero,
    numeroNfse: pi?.numero,
  });
}

/**
 * Esta emissão já chegou pelo ADN?
 *
 * ⚠ As três provas em OU, cada uma exigindo o valor **dos dois lados**. Uma só que case basta:
 * elas são independentes, e nenhuma delas casa por acaso (a justificativa de cada uma está no
 * cabeçalho deste arquivo).
 */
export function mesmaNota(idEmissao, idProjecao) {
  if (idEmissao.chave && idProjecao.chave && idEmissao.chave === idProjecao.chave) return true;
  if (idEmissao.tupla && idProjecao.tupla && idEmissao.tupla === idProjecao.tupla) return true;
  if (idEmissao.numero && idProjecao.numero && idEmissao.numero === idProjecao.numero) return true;
  return false;
}

/**
 * As notas que ESTA empresa emitiu por aqui e que a projeção do ADN ainda não tem.
 *
 * @param {Object} params
 * @param {string} params.legacyCompanyId  `Company.id` — o mundo em que `ServiceInvoice` vive
 * @param {string} params.portalClientId   `PortalClient.id` — o mundo de `PortalInvoice`
 * @param {Object} [params.client=prisma]
 * @returns {Promise<Array>} linhas de `ServiceInvoice` sem par, mais recentes primeiro
 */
export async function lerEmitidasNaoConfirmadas({
  legacyCompanyId,
  portalClientId,
  client = prisma,
} = {}) {
  if (!legacyCompanyId || !portalClientId) return [];

  const emitidas = await client.serviceInvoice.findMany({
    where: { companyId: String(legacyCompanyId), status: { notIn: [...STATUS_SEM_NOTA] } },
    orderBy: { createdAt: "desc" },
    take: TETO_EMITIDAS,
    select: {
      id: true, chaveAcesso: true, numeroNfse: true, rpsSerie: true, rpsNumero: true,
      tomadorDoc: true, tomadorNome: true, valorServicos: true, competencia: true,
      status: true, createdAt: true, updatedAt: true,
    },
  });
  if (!emitidas.length) return [];

  // ⚠ A JANELA DO OUTRO LADO. Só interessam as notas que a empresa EMITIU (`papel: "EMIT"`): a
  // numeração de uma nota recebida é do prestador dela, e compará-las faria a tupla do E0014
  // atravessar CNPJs. `xmlRaw` entra no `select` porque é de onde sai a série/nDPS — e ele já é
  // carregado pela listagem de qualquer forma.
  const projecao = await client.portalInvoice.findMany({
    where: { clientId: String(portalClientId), type: "NFSE", papel: "EMIT" },
    orderBy: { createdAt: "desc" },
    take: TETO_EMITIDAS * 4,
    select: { id: true, chaveAcesso: true, numero: true, xmlRaw: true },
  });

  const identidadesDoAdn = projecao.map(identidadeDaProjecao);

  return emitidas.filter((si) => {
    const id = identidadeDaEmissao(si);
    return !identidadesDoAdn.some((idAdn) => mesmaNota(id, idAdn));
  });
}
