// A EMISSÃO EM LOTE — SEQUENCIAL, PERSISTIDA LINHA A LINHA, E QUE PARA NO DESFECHO DESCONHECIDO.
//
// ⚠⚠ CADA ITERAÇÃO DESTE LAÇO É UM ATO FISCAL IRREVERSÍVEL. Nota emitida não se apaga: cancela-se,
// e cancelar é outro ato. Os erros aqui MULTIPLICAM — é a diferença entre este módulo e o lote de
// DANFSe, onde cada item era CPU local e nada era irreversível.
//
// ⚠⚠ NADA AQUI EMITE POR CONTA PRÓPRIA. Quem emite é `NfseService.issue`, INJETADO como `emitir`.
// Todo teste passa um dublê; nenhuma linha deste módulo foi exercida contra o sistema nacional, em
// ambiente nenhum.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AS REGRAS QUE ESTE ARQUIVO EXISTE PARA CUMPRIR
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// 1. ⚠ SEQUENCIAL, NUNCA PARALELO. É um `for...of` com `await`, e **não há parâmetro de
//    concorrência** — parâmetro é como alguém põe 2 nele daqui a seis meses. Ganhar segundos não
//    paga o risco, e `reservarNumeracao` é transacional POR NOTA.
//
// 2. ⚠⚠ FALHA DE TRANSPORTE PARA O LOTE INTEIRO, NA HORA. Camada `TRANSPORTE` significa desfecho
//    DESCONHECIDO: o pedido saiu e a resposta não voltou, então a nota PODE ter sido autorizada do
//    outro lado. O lote para, NOMEIA a linha indeterminada e **não continua sozinho**. Retentar
//    automaticamente ali é como se duplica nota fiscal em série.
//
// 3. ⚠⚠ A RETOMADA COMEÇA DEPOIS DA LINHA INDETERMINADA — NUNCA NELA. Ver `selecionarParaRetomada`:
//    é uma QUERY (`numeroLinha > linhaIndeterminada`), não um `if` que alguém possa inverter.
//
// 4. ⚠ IDEMPOTÊNCIA pela impressão digital: a mesma planilha não emite duas vezes.
//
// 5. ⚠ NUMERAÇÃO QUEIMA E O BURACO É PERMANENTE (não existe inutilização na NFS-e). O número
//    reservado é gravado na linha, e o relatório distingue os quatro desfechos possíveis dele.
//
// 6. ⚠ SÓ ENTRA O QUE ESTÁ `PRONTA`, e a conferência é refeita NO SERVIDOR.
//
// 7. ⚠ O PORTÃO VALE POR NOTA, e é conferido ANTES DA PRIMEIRA — empresa não liberada não emite
//    nenhuma, e isso se descobre antes da linha 1, não na décima.

import crypto from "node:crypto";
import { ESTADO } from "./classificarLinhaLote.js";

/** Os desfechos possíveis de uma linha. Lista FECHADA. */
export const DESFECHO_LINHA = Object.freeze({
  NAO_TENTADA: "nao_tentada",
  /** ⚠ A janela entre a reserva de numeração commitar e o POST voltar. Ver o `schema.prisma`. */
  ENVIANDO: "enviando",
  EMITIDA: "emitida",
  /** A Receita analisou e recusou (4xx com `E####`). Número liberado. */
  RECUSADA_RECEITA: "recusada_receita",
  /** Nós recusamos antes de enviar. ⚠ NENHUM número foi reservado neste caminho. */
  RECUSADA_NOSSA: "recusada_nossa",
  /** ⚠⚠ Desfecho DESCONHECIDO. A nota pode existir. Ninguém encosta nesta linha sem o contador. */
  INDETERMINADA: "indeterminada",
});

export const STATUS_LOTE = Object.freeze({
  EMITINDO: "emitindo",
  CONCLUIDO: "concluido",
  PARADO_INDETERMINADO: "parado_indeterminado",
  ERRO: "erro",
});

/**
 * ⚠⚠ OS CÓDIGOS QUE PROVAM QUE **NADA SAIU DA MÁQUINA** — lista FECHADA, e ela é de segurança.
 *
 * `NfseService.issue` pode LANÇAR, e um `throw` não é um desfecho classificado. A maioria acontece
 * no pré-voo (antes de reservar numeração e antes do POST), e nesses casos a linha é uma recusa
 * local inofensiva: o lote segue.
 *
 * ⚠ MAS NEM TODO `throw` É SEGURO. O `catch` de `issue` grava a falha com `markIssued`, e se ESSA
 * gravação falhar a exceção escapa **depois de o POST ter saído** — com a nota possivelmente
 * autorizada. Por isso o default de uma exceção desconhecida é `INDETERMINADA` + PARAR, não
 * "recusa nossa". Só o que está nesta lista é tratado como comprovadamente-não-enviado.
 */
const CODIGOS_ANTES_DE_QUALQUER_ENVIO = new Set([
  "COMPANY_NOT_FOUND",
  "COMPANY_MISSING_FIELDS",
  "NFSE_NOT_CONFIGURED",
  "NFSE_RETRY_INVOICE_NOT_FOUND",
  "NFSE_NUMERO_EM_ESTADO_INDETERMINADO",
  "NFSE_ULTIMA_NOTA_ILEGIVEL",
  "NFSE_LEITURA_ULTIMA_NOTA_FALHOU",
  "NFSE_ULTIMA_NOTA_SEM_EMPRESA",
  "NUMERO_NAO_RESERVADO",
  "SERIE_NAO_CADASTRADA",
  "SERIE_NAO_NUMERICA",
  "SERIE_FORA_DA_FAIXA",
]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A IMPRESSÃO DIGITAL
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A identidade do lote — SHA-256 sobre **o que vai ser emitido**.
 *
 * ⚠⚠ NÃO É O HASH DO ARQUIVO, e a diferença é o que faz a regra funcionar:
 *
 *   • o Excel reescreve metadados ao salvar, então a MESMA planilha sai com bytes diferentes e a
 *     segunda subida não seria reconhecida — emitiria tudo de novo;
 *   • os `ajustes` mudam o que será emitido **sem tocar no arquivo**, então dois lotes de conteúdo
 *     diferente teriam o mesmo hash — e o segundo seria recusado como duplicata.
 *
 * Duplicidade de nota fiscal é sobre o CONTEÚDO emitido. É ele que entra aqui.
 *
 * ⚠ A ORDEM ENTRA NO HASH: as mesmas notas em ordem diferente sairiam com numeração diferente, e o
 * relatório fala por número de linha.
 */
export function impressaoDigitalDoLote(companyId, linhasProntas) {
  const corpo = (linhasProntas || []).map((l) => ({
    numero: l.numero,
    doc: l.dados?.tomador?.doc ?? null,
    nome: l.dados?.tomador?.nome ?? null,
    endereco: l.dados?.tomador?.endereco ?? null,
    email: l.dados?.tomador?.email ?? null,
    descricao: l.dados?.servico?.descricao ?? null,
    valor: l.dados?.servico?.valorServicos ?? null,
    // ⚠ A competência é `Date`: normalizada para AAAA-MM-DD com acessadores LOCAIS, os mesmos de
    // `lerCompetenciaDaPlanilha`. `toISOString` converteria para UTC e, num fuso a leste, o mesmo
    // lote teria impressão digital diferente conforme a hora em que fosse subido.
    competencia: dataLocal(l.dados?.competencia),
  }));
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ companyId: String(companyId), linhas: corpo }))
    .digest("hex");
}

function dataLocal(valor) {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) return null;
  const mm = String(valor.getMonth() + 1).padStart(2, "0");
  const dd = String(valor.getDate()).padStart(2, "0");
  return `${valor.getFullYear()}-${mm}-${dd}`;
}

/**
 * As linhas que PODEM ser emitidas — e a peneira é estreita de propósito.
 *
 * ⚠⚠ SÓ `PRONTA`. `CONFERIR` **também carrega `dados`** (o classificador os monta para os dois
 * estados), e é exatamente por isso que a exclusão é explícita e tem teste: filtrar por "tem
 * `dados`" deixaria passar toda linha que a conferência rebaixou.
 */
export function linhasEmitiveis(classificacao) {
  return (classificacao?.linhas || []).filter((l) => l.estado === ESTADO.PRONTA && l.dados);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CRIAR — OU RECONHECER O QUE JÁ EXISTE
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Cria o lote, ou devolve o que já existe para a MESMA planilha.
 *
 * ⚠⚠ A SEGUNDA SUBIDA NÃO REPROCESSA — ela RECONHECE. É a regra 4, e ela não é um detalhe de
 * conveniência: emitir a mesma nota duas vezes não se desfaz. Existe o `E0014` do outro lado, mas
 * contar com ele é contar com sorte (ele depende de o número repetir, e a segunda subida reservaria
 * números NOVOS — passaria limpo).
 *
 * ⚠ Devolve o lote existente, e **não um erro**: o que a tela precisa mostrar é o relatório da
 * primeira vez. Um 409 faria a pessoa subir de novo achando que falhou.
 *
 * ⚠ O `catch` da violação de unicidade não é decoração: entre o `findFirst` e o `create` cabe uma
 * segunda requisição (duplo clique é o caso comum). Sem ele, o segundo clique viraria erro 500 numa
 * operação que, corretamente, é um no-op.
 */
export async function criarOuReconhecerLote({ prisma, companyId, linhasProntas, criadoPor = null }) {
  const impressaoDigital = impressaoDigitalDoLote(companyId, linhasProntas);

  const existente = await prisma.loteEmissaoNfse.findFirst({
    where: { companyId, impressaoDigital },
  });
  if (existente) return { lote: existente, reconhecido: true };

  const dadosDasLinhas = linhasProntas.map((l) => ({
    numeroLinha: l.numero,
    dados: l.dados,
    tomadorDoc: l.dados.tomador.doc,
    tomadorNome: l.dados.tomador.nome,
    valorServicos: l.dados.servico.valorServicos,
    competencia: l.dados.competencia ?? null,
  }));

  try {
    const lote = await prisma.loteEmissaoNfse.create({
      data: {
        companyId,
        impressaoDigital,
        totalLinhas: dadosDasLinhas.length,
        naoTentadas: dadosDasLinhas.length,
        criadoPor,
        linhas: { create: dadosDasLinhas },
      },
    });
    return { lote, reconhecido: false };
  } catch (err) {
    if (err?.code === "P2002") {
      const corrida = await prisma.loteEmissaoNfse.findFirst({ where: { companyId, impressaoDigital } });
      if (corrida) return { lote: corrida, reconhecido: true };
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O LAÇO
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Emite, em série, as linhas que ainda não foram tentadas.
 *
 * @param {object} p
 * @param {object} p.prisma
 * @param {string} p.loteId
 * @param {string} p.companyId  a `Company` LEGADA
 * @param {Function} p.emitir   ⚠ INJETADO. Em produção é `NfseService.issue`; no teste é dublê.
 * @param {object} [p.log]
 */
export async function processarLoteEmissao({ prisma, loteId, companyId, emitir, log = null }) {
  const lote = await prisma.loteEmissaoNfse.findUnique({ where: { id: loteId } });
  if (!lote || lote.companyId !== companyId) {
    const err = new Error("lote_nao_encontrado");
    err.code = "LOTE_NAO_ENCONTRADO";
    throw err;
  }

  // ⚠⚠ PRIMEIRO: toda linha em `enviando` vira INDETERMINADA. Ela é a janela entre a reserva
  // commitar e o POST voltar — encontrá-la aqui significa que o processo morreu no meio de um ato
  // fiscal, e o desfecho daquela nota não se sabe. Isto roda ANTES de qualquer seleção, senão a
  // retomada reprocessaria justamente a linha mais perigosa do lote.
  const paradoPorQuedaNoMeio = await promoverEnviandoParaIndeterminada({ prisma, lote, log });
  if (paradoPorQuedaNoMeio) return paradoPorQuedaNoMeio;

  const pendentes = await selecionarParaRetomada({ prisma, lote });

  for (const linha of pendentes) {
    // ⚠⚠ A RESERVA DA LINHA É ATÔMICA — `updateMany` COM O DESFECHO NO `where`, e o `count` é lido.
    //
    // Isto não é a mesma coisa que `update({ where: { id } })`, e a diferença é uma nota fiscal
    // duplicada: dois processamentos concorrentes do MESMO lote (duplo clique em "retomar", ou um
    // reinício com a requisição anterior ainda viva) leriam ambos a linha como `nao_tentada`, ambos
    // a marcariam `enviando`, e ambos emitiriam. Com o desfecho no `where`, só UM `updateMany`
    // afeta a linha; o outro recebe `count: 0` e PULA.
    //
    // ⚠ É esta cláusula — e não o lock da rota — que garante a não-duplicidade. O lock evita
    // trabalho concorrente; esta linha evita o ato fiscal repetido. Lock vencido é ROUBADO
    // (ver `GuideLockService`), então depender só dele seria depender de um TTL.
    const reservada = await prisma.loteEmissaoNfseLinha.updateMany({
      where: { id: linha.id, desfecho: DESFECHO_LINHA.NAO_TENTADA },
      data: { desfecho: DESFECHO_LINHA.ENVIANDO, tentadaEm: new Date() },
    });
    if (reservada.count !== 1) {
      log?.warn?.(
        { loteId, numeroLinha: linha.numeroLinha },
        "NFS-e lote: linha já reservada por outro processamento — pulando (proteção contra emissão dupla)"
      );
      continue;
    }

    let resultado;
    try {
      resultado = await emitir({
        data: { ...linha.dados, companyId },
        log,
      });
    } catch (err) {
      // ⚠⚠ EXCEÇÃO NÃO É DESFECHO. Só os códigos comprovadamente de pré-voo viram recusa local; o
      // resto PARA O LOTE como indeterminado, porque não se pode provar que nada saiu.
      if (CODIGOS_ANTES_DE_QUALQUER_ENVIO.has(err?.code)) {
        await gravarDesfecho(prisma, linha.id, {
          desfecho: DESFECHO_LINHA.RECUSADA_NOSSA,
          camada: "NOSSA",
          codigo: err.code,
          mensagem: err.message || "Recusado antes do envio.",
          correcao: err.correcao || null,
        });
        continue;
      }
      log?.error?.(
        { loteId, numeroLinha: linha.numeroLinha, err: err?.message, code: err?.code },
        "NFS-e lote: exceção não classificada — o lote PARA e a linha fica indeterminada"
      );
      return await pararPorIndeterminada({
        prisma,
        lote,
        linha,
        motivo:
          "A emissão desta linha terminou em erro não classificado, então NÃO se sabe se a nota "
          + "chegou a ser autorizada. Consulte o sistema nacional antes de qualquer nova tentativa.",
        codigo: err?.code || "EXCECAO_NAO_CLASSIFICADA",
        mensagem: err?.message || null,
        log,
      });
    }

    const numeracao = {
      rpsSerie: resultado?.nfse?.rpsSerie ?? null,
      rpsNumero: resultado?.nfse?.rpsNumero ?? null,
      serviceInvoiceId: resultado?.nfse?.id ?? null,
    };

    // ── 2. A PARADA DO TRANSPORTE ──────────────────────────────────────────────────────────────
    if (resultado?.camada === "TRANSPORTE") {
      return await pararPorIndeterminada({
        prisma,
        lote,
        linha,
        numeracao,
        motivo: resultado.correcao || null,
        codigo: resultado.codigo || null,
        mensagem: resultado.message || null,
        log,
      });
    }

    if (resultado?.status === "rejected") {
      await gravarDesfecho(prisma, linha.id, {
        desfecho: DESFECHO_LINHA.RECUSADA_RECEITA,
        camada: "RECEITA",
        codigo: resultado.codigo || null,
        mensagem: resultado.message || null,
        correcao: resultado.correcao || null,
        ...numeracao,
      });
      continue;
    }

    if (resultado?.status === "falha_envio") {
      await gravarDesfecho(prisma, linha.id, {
        desfecho: DESFECHO_LINHA.RECUSADA_NOSSA,
        camada: resultado.camada || "NOSSA",
        codigo: resultado.codigo || null,
        mensagem: resultado.message || null,
        correcao: resultado.correcao || null,
        ...numeracao,
      });
      continue;
    }

    await gravarDesfecho(prisma, linha.id, {
      desfecho: DESFECHO_LINHA.EMITIDA,
      camada: null,
      codigo: null,
      mensagem: null,
      correcao: null,
      ...numeracao,
    });
  }

  return await fecharLote({ prisma, loteId });
}

/**
 * ⚠⚠ AS LINHAS QUE A RETOMADA PODE TOCAR — E É UMA QUERY, NÃO UM `if`.
 *
 * `numeroLinha > lote.linhaIndeterminada` é ESTRITAMENTE MAIOR: a linha cujo desfecho não se sabe
 * **não está no conjunto, por construção**. Não existe ramo condicional que alguém possa inverter
 * numa correção futura, e a garantia continua valendo mesmo se um dia o processamento deixar de ser
 * em ordem crescente.
 *
 * Quem decide o que fazer com a linha indeterminada é o CONTADOR, olhando o portal nacional. Nunca
 * este código.
 */
export async function selecionarParaRetomada({ prisma, lote }) {
  const where = { loteId: lote.id, desfecho: DESFECHO_LINHA.NAO_TENTADA };
  if (Number.isInteger(lote.linhaIndeterminada)) {
    where.numeroLinha = { gt: lote.linhaIndeterminada };
  }
  return prisma.loteEmissaoNfseLinha.findMany({ where, orderBy: { numeroLinha: "asc" } });
}

/**
 * Toda linha presa em `enviando` vira `indeterminada`, e o lote fica parado.
 *
 * ⚠ É o caso do processo que morreu no meio de um ato fiscal. A linha tem número reservado (ou pode
 * ter) e uma nota possivelmente emitida; reprocessá-la é duplicar documento fiscal.
 *
 * ⚠ Marca como indeterminada a linha de MENOR número entre as presas — as demais também ficam
 * indeterminadas, mas o ponto de retomada tem de ser o mais conservador possível.
 */
async function promoverEnviandoParaIndeterminada({ prisma, lote, log }) {
  const presas = await prisma.loteEmissaoNfseLinha.findMany({
    where: { loteId: lote.id, desfecho: DESFECHO_LINHA.ENVIANDO },
    orderBy: { numeroLinha: "asc" },
  });
  if (!presas.length) return null;

  log?.error?.(
    { loteId: lote.id, linhas: presas.map((l) => l.numeroLinha) },
    "NFS-e lote: linhas presas em `enviando` — o processo caiu no meio de um envio. Desfecho DESCONHECIDO."
  );

  await prisma.loteEmissaoNfseLinha.updateMany({
    where: { loteId: lote.id, desfecho: DESFECHO_LINHA.ENVIANDO },
    data: {
      desfecho: DESFECHO_LINHA.INDETERMINADA,
      camada: "TRANSPORTE",
      codigo: "PROCESSO_INTERROMPIDO",
      mensagem:
        "O envio desta linha foi interrompido antes de a resposta do sistema nacional ser "
        + "registrada. NÃO se sabe se a nota foi autorizada.",
      correcao:
        "Consulte o Id da DPS no sistema nacional antes de qualquer nova tentativa. Se um número "
        + "foi reservado e não virou nota, ele é um buraco permanente — não existe inutilização na "
        + "NFS-e.",
    },
  });

  const primeira = presas[0];
  const atualizado = await prisma.loteEmissaoNfse.update({
    where: { id: lote.id },
    data: {
      status: STATUS_LOTE.PARADO_INDETERMINADO,
      linhaIndeterminada: primeira.numeroLinha,
      paradoEm: new Date(),
      paradoMotivo:
        "O processamento foi interrompido no meio de um envio. O desfecho daquela nota é "
        + "desconhecido e o lote não continua sozinho.",
    },
  });
  return { lote: await recontar({ prisma, loteId: lote.id }), interrompido: true, base: atualizado };
}

async function pararPorIndeterminada({ prisma, lote, linha, numeracao = {}, motivo, codigo, mensagem, log }) {
  await gravarDesfecho(prisma, linha.id, {
    desfecho: DESFECHO_LINHA.INDETERMINADA,
    camada: "TRANSPORTE",
    codigo,
    mensagem,
    correcao: motivo,
    ...numeracao,
  });

  log?.error?.(
    { loteId: lote.id, numeroLinha: linha.numeroLinha, codigo },
    "NFS-e lote: PARADO por desfecho desconhecido (camada TRANSPORTE). As linhas seguintes não foram tentadas."
  );

  await prisma.loteEmissaoNfse.update({
    where: { id: lote.id },
    data: {
      status: STATUS_LOTE.PARADO_INDETERMINADO,
      linhaIndeterminada: linha.numeroLinha,
      paradoEm: new Date(),
      paradoMotivo:
        "O pedido desta linha saiu, mas a resposta do sistema nacional não voltou — então NÃO se "
        + "sabe se a nota foi emitida. O lote parou aqui de propósito: continuar sozinho é como se "
        + "duplica nota fiscal em série.",
    },
  });

  return recontar({ prisma, loteId: lote.id });
}

function gravarDesfecho(prisma, linhaId, dados) {
  return prisma.loteEmissaoNfseLinha.update({
    where: { id: linhaId },
    data: { ...dados, tentadaEm: new Date() },
  });
}

async function fecharLote({ prisma, loteId }) {
  const atual = await recontar({ prisma, loteId });
  // ⚠ `concluido` só quando não sobrou nada por tentar. Um lote que parou por indeterminada já teve
  // o status gravado e não passa por aqui.
  await prisma.loteEmissaoNfse.update({
    where: { id: loteId },
    data: { status: atual.naoTentadas > 0 ? STATUS_LOTE.PARADO_INDETERMINADO : STATUS_LOTE.CONCLUIDO },
  });
  return recontar({ prisma, loteId });
}

/**
 * Recalcula os totais a partir das LINHAS — nunca por incremento.
 *
 * ⚠ Contador incrementado a cada iteração diverge do fato na primeira queda de processo, e aí o
 * relatório diria um número e as linhas outro. As linhas são o fato.
 */
export async function recontar({ prisma, loteId }) {
  const linhas = await prisma.loteEmissaoNfseLinha.findMany({
    where: { loteId },
    orderBy: { numeroLinha: "asc" },
  });
  const conta = (d) => linhas.filter((l) => l.desfecho === d).length;
  const totais = {
    emitidas: conta(DESFECHO_LINHA.EMITIDA),
    recusadas: conta(DESFECHO_LINHA.RECUSADA_RECEITA) + conta(DESFECHO_LINHA.RECUSADA_NOSSA),
    naoTentadas: conta(DESFECHO_LINHA.NAO_TENTADA),
  };
  const lote = await prisma.loteEmissaoNfse.update({ where: { id: loteId }, data: totais });
  return { ...lote, linhas };
}
