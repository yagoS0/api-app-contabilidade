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
//    ⚠⚠ **E ELA AGORA TEM UM SEGUNDO PASSO — 21/08/2026.** Subir a mesma planilha RECONHECE o lote
//    (nada é reemitido ali, nunca). O que passou a existir é a RETENTATIVA, uma rota própria, que
//    reemite **só as linhas cujo desfecho prova que não existe nota**. Ver o bloco "A RETENTATIVA"
//    abaixo: a trava não foi removida, ela deixou de ser sobre o LOTE e passou a ser sobre a LINHA.
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A RETENTATIVA — E A REGRA DE SEGURANÇA QUE A TORNA POSSÍVEL
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Um lote RECONHECIDO (a mesma planilha subida de novo) podia, até 21/08/2026, apenas ser olhado:
// a idempotência devolvia o relatório antigo e não havia caminho nenhum para tentar outra vez. Isso
// está certo para o que a trava existe para impedir — reemitir o que JÁ VIROU NOTA —, e estava
// errado para o caso real que a produziu: **um lote inteiro recusado por erro de esquema (E1235),
// consertado, e impossível de reemitir**. Zero notas no mundo, e nenhuma saída.
//
// ⚠⚠ **UMA LINHA SÓ PODE SER RETENTADA SE O DESFECHO DELA PROVAR QUE NÃO EXISTE NOTA.** A lista é
// FECHADA e é de segurança — é o coração deste arquivo:
//
//   `RECUSADA_RECEITA`  a Receita ANALISOU e recusou. A recusa é anterior ao documento: não existe
//                       nota, e o número volta a ser reutilizável. ⚠ É exatamente a mesma prova em
//                       que `NfseService.issue` já se apoia para aceitar `retryInvoiceId` (lá: "só
//                       é aceito quando a falha daquela linha LIBEROU o número — camadas `NOSSA` e
//                       `RECEITA`"). Não é regra nova; é a regra que já existia, alcançando o lote.
//   `RECUSADA_NOSSA`    nós recusamos no PRÉ-VOO. Nada saiu da máquina e nenhum número foi
//                       reservado. É o mais seguro dos três.
//   `NAO_TENTADA`       ninguém encostou nela.
//
// ⚠⚠ **E OS DOIS QUE NUNCA, EM HIPÓTESE NENHUMA:**
//
//   `EMITIDA`           a nota EXISTE no mundo. Reemitir é duplicar documento fiscal, e duplicata
//                       não se desfaz: cancela-se, e cancelar é outro ato.
//   `INDETERMINADA`     o pior estado deste sistema — a nota PODE existir e ninguém sabe qual.
//                       Retentar aqui é a forma mais direta de duplicar nota em série.
//
// ⚠⚠ **O CASO PARCIAL É O QUE SEPARA UM CONSERTO DE UM DESASTRE.** Lote com 2 emitidas e 1 recusada
// reemite **só a recusada**. Um "retentar tudo" mandaria duas notas fiscais idênticas a dois
// tomadores que já as receberam. Por isso a decisão é **POR LINHA**, nunca pelo lote: não existe,
// em lugar nenhum deste arquivo, caminho que leia o status do LOTE para decidir o que reemitir.
//
// ⚠⚠ **A IDEMPOTÊNCIA NÃO FOI REMOVIDA — ELA FOI AFROUXADA EXATAMENTE ONDE PROVA AUSÊNCIA DE
// NOTA.** Subir a mesma planilha duas vezes DEPOIS de emitir com sucesso continua sendo
// reconhecido e continua não reemitindo nada: linha `EMITIDA` não é retentável, então o plano volta
// VAZIO e a rota recusa. A trava mudou de "este lote já existe" para "o desfecho desta linha prova
// que existe nota" — que é o que ela sempre quis dizer.
//
// ⚠ **DESFECHO QUE ESTE CÓDIGO NÃO CONHECE NÃO É RETENTÁVEL.** A lista é de INCLUSÃO, nunca de
// exclusão: um estado novo no banco entra como BLOQUEADO por construção, em vez de virar retentável
// por omissão. Mesma disciplina do "estado que a tela não conhece não vira `pronta`".

/** ⚠⚠ LISTA FECHADA, DE INCLUSÃO. Só o que PROVA que não existe nota. */
export const DESFECHOS_RETENTAVEIS = Object.freeze([
  DESFECHO_LINHA.NAO_TENTADA,
  DESFECHO_LINHA.RECUSADA_RECEITA,
  DESFECHO_LINHA.RECUSADA_NOSSA,
]);

/**
 * Por que cada desfecho bloqueado NÃO é retentado — em frase de gente, porque ela sai na tela.
 *
 * ⚠ O motivo viaja JUNTO da linha bloqueada. "3 linhas não serão tentadas" sem o porquê faz a
 * pessoa achar que o sistema não conseguiu alcançá-las, e a próxima coisa que ela tenta é forçar.
 */
export const MOTIVO_NAO_RETENTAVEL = Object.freeze({
  [DESFECHO_LINHA.EMITIDA]:
    "esta linha já virou nota fiscal — emitir de novo criaria uma nota duplicada",
  [DESFECHO_LINHA.INDETERMINADA]:
    "não se sabe se a nota desta linha foi emitida, e tentar outra vez pode gerar uma nota duplicada",
  [DESFECHO_LINHA.ENVIANDO]:
    "o envio desta linha não terminou, então o desfecho dela ainda é desconhecido",
});

const MOTIVO_DESFECHO_DESCONHECIDO =
  "esta linha está num estado que este sistema não reconhece, e o que não se reconhece não se retenta";

/**
 * Os dois modos do laço. ⚠ `RETOMADA` é o comportamento de sempre, e é o DEFAULT — um chamador que
 * não saiba deste parâmetro continua emitindo só o que nunca foi tentado.
 */
export const MODO = Object.freeze({
  RETOMADA: "retomada",
  RETENTATIVA: "retentativa",
});

/**
 * ⚠ Modo desconhecido cai no conjunto MAIS ESTREITO, nunca no mais largo. Erro de digitação num
 * chamador futuro não pode alargar o que se reemite.
 */
function desfechosDoModo(modo) {
  return modo === MODO.RETENTATIVA ? DESFECHOS_RETENTAVEIS : [DESFECHO_LINHA.NAO_TENTADA];
}

/**
 * ⚠⚠ POR QUE ESTA LINHA NÃO PODE SER RETENTADA — `null` quando ela pode.
 *
 * Três guardas independentes, e nenhuma delas é um `if` sobre o status do LOTE:
 *   1. o desfecho tem de estar na lista de INCLUSÃO;
 *   2. a linha nomeada em `lote.linhaIndeterminada` fica fora pelo NÚMERO — mesmo que, por qualquer
 *      razão, o desfecho dela tenha ficado gravado como outra coisa;
 *   3. a lista de inclusão já exclui `indeterminada` e `emitida` por construção.
 *
 * A 2 é redundante com a 1 em todo caminho que este código produz, e é de propósito: ela é a única
 * que continua valendo se o desfecho da linha e a coluna do lote divergirem.
 */
export function bloqueioDaRetentativa(linha, lote = null) {
  const desfecho = linha?.desfecho;
  if (!DESFECHOS_RETENTAVEIS.includes(desfecho)) {
    return MOTIVO_NAO_RETENTAVEL[desfecho] || MOTIVO_DESFECHO_DESCONHECIDO;
  }
  if (Number.isInteger(lote?.linhaIndeterminada) && linha?.numeroLinha === lote.linhaIndeterminada) {
    return MOTIVO_NAO_RETENTAVEL[DESFECHO_LINHA.INDETERMINADA];
  }
  return null;
}

/** Atalho de leitura. A regra é `bloqueioDaRetentativa`; isto é só o sinal dela. */
export function podeRetentar(linha, lote = null) {
  return bloqueioDaRetentativa(linha, lote) === null;
}

/**
 * O que uma retentativa faria com ESTE lote — puro, sem banco.
 *
 * ⚠ É a MESMA regra que o laço aplica; a rota usa este plano para dizer, ANTES do clique, quantas
 * linhas serão tentadas e quantas não serão. A tela tem o espelho dele
 * (`portal-cliente-web/.../lib/emissaoDoLote.js`), amarrado por teste: uma tela que oferecesse o
 * que o servidor recusa é o defeito que este projeto já pagou várias vezes.
 */
export function planoDeRetentativa(lote) {
  const retentaveis = [];
  const bloqueadas = [];
  for (const linha of lote?.linhas || []) {
    const motivo = bloqueioDaRetentativa(linha, lote);
    if (motivo === null) {
      retentaveis.push({ numeroLinha: linha.numeroLinha, desfecho: linha.desfecho });
      continue;
    }
    bloqueadas.push({ numeroLinha: linha.numeroLinha, desfecho: linha.desfecho, motivo });
  }
  const conta = (d) => bloqueadas.filter((b) => b.desfecho === d).length;
  return {
    quantas: retentaveis.length,
    retentaveis,
    bloqueadas,
    /** ⚠ Separadas porque os dois motivos pedem CONVERSAS diferentes com quem lê. */
    emitidas: conta(DESFECHO_LINHA.EMITIDA),
    indeterminadas: conta(DESFECHO_LINHA.INDETERMINADA),
  };
}

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
 * ⚠⚠ **RECONHECER NÃO É "NÃO HÁ NADA A FAZER", E ESTA FUNÇÃO NÃO DECIDE ISSO.** Ela devolve o lote;
 * quem responde *"dá para tentar de novo?"* é `planoDeRetentativa`, POR LINHA. O lote inteiramente
 * recusado (zero notas no mundo) é reconhecido igual ao lote inteiramente emitido — e são situações
 * opostas. Não acrescente aqui um ramo que reprocesse: reemitir tem porta própria, com o portão e a
 * regra de retentabilidade na frente.
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
 * @param {string} [p.modo]   ⚠ `MODO.RETOMADA` (default, o de sempre) | `MODO.RETENTATIVA`.
 *                            Ele muda UMA coisa: **quais desfechos entram na seleção**. Não muda o
 *                            laço, não muda a reserva atômica, não muda o que para o lote.
 */
export async function processarLoteEmissao({
  prisma,
  loteId,
  companyId,
  emitir,
  log = null,
  modo = MODO.RETOMADA,
}) {
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

  // ⚠⚠ O CONJUNTO DE DESFECHOS QUE PODEM SER TOCADOS NESTA PASSAGEM — e ele é UM SÓ, usado tanto
  // para SELECIONAR quanto para RESERVAR. Duas listas (uma na query, outra no `where` da reserva)
  // divergiriam na primeira correção, e a divergência apareceria como uma linha `emitida` sendo
  // reservada para envio.
  const desfechosSelecionados = desfechosDoModo(modo);
  const pendentes = await selecionarParaRetomada({ prisma, lote, modo });

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
    //
    // ⚠⚠ O `desfecho` NO `where` CONTINUA SENDO A TRAVA, e o `in` **não a afrouxa**: ele nomeia,
    // por extenso, o conjunto FECHADO de estados de onde uma linha pode sair para `enviando`.
    // `emitida` e `indeterminada` não estão nele em modo nenhum — nem por omissão, nem por
    // default, nem por modo desconhecido (ver `desfechosDoModo`). Trocar isto por um `updateMany`
    // sem desfecho no `where` é o que reintroduziria a nota duplicada.
    const reservada = await prisma.loteEmissaoNfseLinha.updateMany({
      where: { id: linha.id, desfecho: { in: desfechosSelecionados } },
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
        // ⚠⚠ REUSA O NÚMERO JÁ RESERVADO NA TENTATIVA ANTERIOR — **não existe inutilização na
        // NFS-e**, então cada retentativa que reservasse número novo abriria um buraco PERMANENTE
        // na numeração da empresa. Numa linha `nao_tentada` isto é sempre `null` (não há tentativa
        // anterior), e o comportamento é exatamente o de antes.
        //
        // ⚠ **E É UMA QUARTA GUARDA, não um atalho.** Quem decide se aquele número pode voltar é
        // `NfseService.issue`, e ele já recusa o reuso quando a falha anterior foi de TRANSPORTE
        // (`NFSE_NUMERO_EM_ESTADO_INDETERMINADO`) — desfecho desconhecido não libera número. Esse
        // código está em `CODIGOS_ANTES_DE_QUALQUER_ENVIO`: a linha vira recusa NOSSA e o lote
        // segue, sem nada ter saído da máquina.
        retryInvoiceId: linha.serviceInvoiceId || null,
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
export async function selecionarParaRetomada({ prisma, lote, modo = MODO.RETOMADA }) {
  const where = { loteId: lote.id, desfecho: { in: desfechosDoModo(modo) } };
  if (Number.isInteger(lote.linhaIndeterminada)) {
    // ⚠⚠ OS DOIS RAMOS EXCLUEM A LINHA INDETERMINADA, e nenhum deles é um `if` sobre ela.
    //
    //   RETOMADA    `gt` — continuar DEPOIS dela. É a regra 3, intacta.
    //   RETENTATIVA `not` — a retentativa não é uma continuação: ela volta em linhas que já foram
    //               tentadas e recusadas, inclusive ANTES do ponto de parada. Um `gt` aqui deixaria
    //               a recusa anterior à indeterminada sem saída nenhuma para sempre. O que ela NÃO
    //               pode tocar é a linha indeterminada — e é literalmente isso que o `not` diz.
    //
    // ⚠ Em qualquer dos dois, a linha indeterminada ainda estaria fora pelo DESFECHO: `indeterminada`
    // não pertence a nenhum dos conjuntos. São duas exclusões independentes, de propósito.
    where.numeroLinha =
      modo === MODO.RETENTATIVA
        ? { not: lote.linhaIndeterminada }
        : { gt: lote.linhaIndeterminada };
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
