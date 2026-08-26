// Q14.2.c — Aprendizado a partir de resolução de pendência.
//
// Quando contador resolve uma FilaPendencia(ITEM_SEM_REGRA) escolhendo um TipoReceita, cria uma
// RegraClassificacao (escopo EMPRESA ou GLOBAL) e/ou um ProdutoServico nomeado, e reclassifica as
// notas que estavam paradas.
//
// ⚠⚠ O ESCOPO GLOBAL EXISTE POR CAUSA DA ESCALA, e é a diferença entre O(1) e O(n).
//
// Até 26/08/2026 este serviço só sabia gravar escopo **EMPRESA**. Isso quer dizer que o MESMO
// código de serviço era decidido **uma vez por cliente**: com mil empresas na carteira, mil
// pendências idênticas e mil regras idênticas, para uma pergunta que tem uma resposta só — porque
// **o código de serviço não muda de significado conforme o cliente**. É trabalho O(n) onde o
// problema é O(1), e a hora é humana.
//
// Hoje o contador escolhe o escopo. Resolvendo como GLOBAL:
//   · a regra nasce sem `portalClientId` e vale para a carteira inteira, inclusive para cliente
//     que ainda não existe — que é o caso que mais economiza hora;
//   · as pendências IRMÃS (mesmo código, outras empresas) são fechadas junto, com
//     `acaoResolucao: "RESOLVIDA_POR_REGRA_GLOBAL"` — ⚠ marca PRÓPRIA, porque fechar a pendência
//     de outra empresa sem dizer que foi uma decisão global a tornaria indistinguível de uma que
//     alguém revisou uma a uma;
//   · só as empresas afetadas são reclassificadas, não a carteira toda.
//
// ⚠ O DEFAULT CONTINUA `EMPRESA`. Um default GLOBAL faria toda resolução já feita passar a valer
// para a carteira inteira — mudança silenciosa de alcance num dado fiscal. Quem quer o alcance
// maior pede por ele.

import { prisma } from "../../../../infrastructure/db/prisma.js";
import { classificarItensV2 } from "./ClassificadorService.js";

/**
 * ⚠ A PRIORIDADE DECIDE QUEM VENCE, e `ClassificadorService.indexRegras` a respeita de verdade
 * (`r.prioridade > existing.prioridade`) — não é "a última escrita vence".
 *
 *   EMPRESA (100)  >  GLOBAL de APRENDIZADO (50)  >  item do seed (10)  >  capítulo do seed (5)
 *
 * O 50 é deliberado e fica no meio: acima do seed, porque uma decisão do contador **corrige** o
 * de-para que veio no código; abaixo de EMPRESA, porque uma empresa que já tinha exceção própria
 * não pode perdê-la quando alguém resolve o mesmo código globalmente.
 */
export const PRIORIDADE_GLOBAL_APRENDIZADO = 50;

/** Marca de que a pendência foi fechada por uma decisão GLOBAL tomada em OUTRA empresa. */
export const ACAO_RESOLVIDA_POR_REGRA_GLOBAL = "RESOLVIDA_POR_REGRA_GLOBAL";

const ESCOPOS_VALIDOS = new Set(["EMPRESA", "GLOBAL"]);

const TIPOS_RECEITA_VALIDOS = new Set([
  "REVENDA_MERCADORIA",
  "INDUSTRIALIZACAO",
  "SERVICO_ANEXO_III",
  "SERVICO_ANEXO_IV",
  "SERVICO_ANEXO_V",
  "SERVICO_FATOR_R",
]);

/**
 * Resolve uma pendência ITEM_SEM_REGRA.
 *
 * @param {Object} opts
 * @param {string} opts.pendenciaId
 * @param {string} opts.tipoReceita — TipoReceita escolhido pelo contador
 * @param {boolean} [opts.criarRegra=true] — se true, cria RegraClassificacao
 * @param {"EMPRESA"|"GLOBAL"} [opts.escopo="EMPRESA"] — ⚠ GLOBAL vale para a carteira inteira,
 *        inclusive para cliente que ainda não existe. O default é EMPRESA de propósito.
 * @param {string} [opts.nomeProduto] — se preenchido, também cria ProdutoServico nomeado
 * @param {string} opts.userId
 * @returns {Promise<{ok, regraCriada, produtoCriado, reclassificacao, irmas}>}
 */
export async function resolverPendenciaItemSemRegra({
  pendenciaId, tipoReceita, criarRegra = true, escopo = "EMPRESA", nomeProduto, userId,
}) {
  if (!TIPOS_RECEITA_VALIDOS.has(tipoReceita)) {
    throw new Error(`tipoReceita inválido: ${tipoReceita}`);
  }
  // ⚠ Escopo desconhecido RECUSA, nunca cai em EMPRESA "por segurança": um typo (`"global"`,
  // `"GLOBAIS"`) viraria uma resolução de alcance menor que o pedido, e o contador acharia que
  // decidiu para a carteira quando decidiu para uma empresa. Falha barulhenta.
  if (!ESCOPOS_VALIDOS.has(escopo)) throw new Error(`escopo inválido: ${escopo}`);
  const ehGlobal = escopo === "GLOBAL";
  const pend = await prisma.filaPendencia.findUnique({ where: { id: pendenciaId } });
  if (!pend) throw new Error("pendencia_not_found");
  if (pend.resolvida) throw new Error("pendencia_ja_resolvida");
  if (pend.tipo !== "ITEM_SEM_REGRA") throw new Error("tipo_pendencia_invalido");

  const codigo = pend.detalhes?.codigo;
  const tipoCodigoRaw = pend.detalhes?.tipoCodigo;
  if (!codigo) throw new Error("pendencia_sem_codigo");

  // Normaliza tipoCodigo (pendência guarda "LC116/CTRIBNAC" — escolhe LC116 por default)
  const tipoCodigo = String(tipoCodigoRaw || "").includes("LC")
    ? "LC116"
    : String(tipoCodigoRaw || "").includes("NCM")
      ? "NCM"
      : String(tipoCodigoRaw || "").includes("CFOP")
        ? "CFOP"
        : "LC116";

  let regraCriada = null;
  let produtoCriado = null;

  if (criarRegra) {
    // Idempotente: se já existir regra do MESMO escopo pro mesmo código, atualiza.
    // ⚠ `portalClientId` é `null` no GLOBAL — é ele que faz a regra valer para a carteira inteira.
    const existing = await prisma.regraClassificacao.findFirst({
      where: {
        escopo,
        portalClientId: ehGlobal ? null : pend.portalClientId,
        tipoCodigo, codigo,
        vigenciaFim: null,
      },
    });
    if (existing) {
      // ⚠⚠ SOBRESCREVER UMA REGRA QUE VEIO NO SEED É LEGÍTIMO — o contador é a autoridade fiscal,
      // e o de-para embarcado é ponto de partida. Mas NÃO PODE SER SILENCIOSO: sem registrar o
      // valor anterior, quem depois vir o banco discordar do `RegraClassificacaoSeeds.js` não tem
      // como saber se foi decisão ou defeito. Fica na descrição, com a fonte antiga.
      const mudou = existing.tipoReceita !== tipoReceita;
      const nota = mudou
        ? `Sobrepõe ${existing.tipoReceita} (fonte ${existing.fonte}) por decisão na pendência ${pendenciaId.slice(0, 8)}`
        : `Reconfirmado na pendência ${pendenciaId.slice(0, 8)}`;
      regraCriada = await prisma.regraClassificacao.update({
        where: { id: existing.id },
        data: {
          tipoReceita,
          fonte: "APRENDIZADO",
          createdByUserId: userId,
          descricao: nota,
          // ⚠ A prioridade SOBE para a de aprendizado quando a regra passa a ser do contador. Sem
          // isto, uma regra de seed sobrescrita continuaria com prioridade 10 e perderia para
          // qualquer outra regra de 50 — o valor certo com o peso errado.
          ...(ehGlobal ? { prioridade: PRIORIDADE_GLOBAL_APRENDIZADO } : {}),
        },
      });
    } else {
      regraCriada = await prisma.regraClassificacao.create({
        data: {
          escopo,
          portalClientId: ehGlobal ? null : pend.portalClientId,
          tipoCodigo, codigo, tipoReceita,
          // EMPRESA (100) continua batendo GLOBAL (50) — quem já tinha exceção própria não a perde.
          prioridade: ehGlobal ? PRIORIDADE_GLOBAL_APRENDIZADO : 100,
          fonte: "APRENDIZADO",
          descricao: `Aprendido em resolução de pendência ${pendenciaId.slice(0, 8)}`,
          createdByUserId: userId,
        },
      });
    }
  }

  if (nomeProduto && nomeProduto.trim()) {
    produtoCriado = await prisma.produtoServico.create({
      data: {
        portalClientId: pend.portalClientId,
        nome: nomeProduto.trim(),
        tipoReceita,
        codigoServico: tipoCodigo === "LC116" ? codigo : null,
        ncm: tipoCodigo === "NCM" ? codigo : null,
        cfop: tipoCodigo === "CFOP" ? codigo : null,
        origem: "APRENDIDO_DA_NOTA",
        createdByUserId: userId,
      },
    });
  }

  // Marca pendência como resolvida
  await prisma.filaPendencia.update({
    where: { id: pendenciaId },
    data: {
      resolvida: true,
      resolvidaEm: new Date(),
      resolvidaPor: userId || null,
      acaoResolucao: criarRegra ? (nomeProduto ? "CRIOU_PRODUTO" : "CRIOU_REGRA") : "REENQUADROU",
    },
  });

  // ─── AS PENDÊNCIAS IRMÃS ────────────────────────────────────────────────────────────────────
  //
  // ⚠⚠ É AQUI QUE A HORA HUMANA É ECONOMIZADA, e é o único ponto deste arquivo que toca dado de
  // OUTRA empresa. Com escopo GLOBAL a pergunta "o que é o código X?" passou a ter resposta para
  // a carteira inteira — deixar as pendências das outras empresas abertas faria o contador
  // responder de novo o que já respondeu, que é exatamente o O(n) que o escopo existe para matar.
  let irmas = { fechadas: 0, empresas: [] };
  if (ehGlobal && criarRegra) {
    const abertas = await prisma.filaPendencia.findMany({
      where: {
        tipo: "ITEM_SEM_REGRA",
        resolvida: false,
        id: { not: pendenciaId },
        // ⚠ MESMO CÓDIGO — a chave da decisão. `detalhes` é Json, então a comparação é por path.
        detalhes: { path: ["codigo"], equals: codigo },
      },
      select: { id: true, portalClientId: true },
    });
    if (abertas.length) {
      await prisma.filaPendencia.updateMany({
        where: { id: { in: abertas.map((a) => a.id) } },
        data: {
          resolvida: true,
          resolvidaEm: new Date(),
          resolvidaPor: userId || null,
          // ⚠ MARCA PRÓPRIA, e não `CRIOU_REGRA`: ninguém revisou estas uma a uma. Colapsá-las na
          // ação normal faria uma pendência fechada por tabela parecer conferida por uma pessoa —
          // e é essa diferença que alguém vai querer auditar quando a classificação for contestada.
          acaoResolucao: ACAO_RESOLVIDA_POR_REGRA_GLOBAL,
        },
      });
      irmas = { fechadas: abertas.length, empresas: [...new Set(abertas.map((a) => a.portalClientId))] };
    }
  }

  // ─── RECLASSIFICAÇÃO ────────────────────────────────────────────────────────────────────────
  //
  // ⚠ SÓ AS EMPRESAS AFETADAS, nunca a carteira inteira: com mil clientes, reclassificar todos a
  // cada pendência resolvida transformaria uma decisão barata numa varredura completa.
  //
  // ⚠ LIMITE DECLARADO: as afetadas saem das PENDÊNCIAS, e uma empresa que tenha notas com este
  // código mas nunca teve pendência (porque o classificador ainda não passou por ela) **não entra
  // aqui** — ela é pega na próxima execução do classificador. Isso não perde nada: a regra já está
  // gravada, e é ela que decide quando a vez daquela empresa chegar.
  let reclassificacao = null;
  if (criarRegra || produtoCriado) {
    const alvos = [pend.portalClientId, ...irmas.empresas];
    const resultados = [];
    for (const alvo of [...new Set(alvos)]) {
      resultados.push({ portalClientId: alvo, resultado: await classificarItensV2({ portalClientId: alvo, force: true }) });
    }
    // Compatibilidade: o caso EMPRESA continua devolvendo o objeto único que os chamadores leem.
    reclassificacao = resultados.length === 1 ? resultados[0].resultado : resultados;
  }

  return {
    ok: true,
    escopo,
    regraCriada: regraCriada
      ? { id: regraCriada.id, tipoReceita: regraCriada.tipoReceita, escopo: regraCriada.escopo }
      : null,
    produtoCriado: produtoCriado ? { id: produtoCriado.id, nome: produtoCriado.nome } : null,
    reclassificacao,
    /** Quantas decisões idênticas deixaram de ser pedidas ao contador. */
    irmas,
  };
}

/**
 * Resolve uma pendência DIVERGENCIA_CADASTRO.
 * Contador escolhe se quer atualizar o cadastro (mudar CNAE/regime) ou ignorar.
 */
export async function resolverPendenciaDivergencia({ pendenciaId, acao, userId }) {
  const pend = await prisma.filaPendencia.findUnique({ where: { id: pendenciaId } });
  if (!pend) throw new Error("pendencia_not_found");
  if (pend.resolvida) throw new Error("pendencia_ja_resolvida");
  if (pend.tipo !== "DIVERGENCIA_CADASTRO") throw new Error("tipo_pendencia_invalido");

  await prisma.filaPendencia.update({
    where: { id: pendenciaId },
    data: {
      resolvida: true,
      resolvidaEm: new Date(),
      resolvidaPor: userId || null,
      acaoResolucao: acao === "atualizar_cadastro" ? "REENQUADROU" : "IGNOROU",
    },
  });
  return { ok: true };
}

export { TIPOS_RECEITA_VALIDOS };
