// A LIGAÇÃO DAS REGRAS COM O BANCO — sugerir conta, aprender, suspender.
//
// ⚠ A REGRA não é reimplementada aqui: quem decide é `lib/motorDeSugestao.js` (o que sugerir) e
// `lib/aprendizado.js` (o que nasce e o que se freia). Este arquivo faz três coisas: buscar o que
// eles precisam, chamá-los, e gravar o que eles mandaram.
//
// ⚠⚠ NADA AQUI CONTABILIZA. Nenhuma função deste arquivo cria `AccountingEntry`. Quem leva ao razão
// continua sendo `aplicarTransicao`, no `DeclaradoService`, com o contador clicando.

import { prisma } from "../../infrastructure/db/prisma.js";
import { decidirAprendizado, MOTIVO_DA_SUSPENSAO } from "./lib/aprendizado.js";
import { chaveDaDescricao, sugerirConta } from "./lib/motorDeSugestao.js";

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");

/**
 * ⚠⚠ O PLANO DA EMPRESA, com a precedência de sempre: GLOBAL primeiro, a da EMPRESA sobrescreve.
 *
 * É o mesmo desenho de `formaDoLancamento`. Sem isso, o reduzido `557` de uma empresa poderia ser
 * traduzido pelo `codigoCompleto` de outra — e a despesa iria para a conta errada, em silêncio.
 */
async function planoDaEmpresa(portalClientId, client) {
  const contas = await client.chartOfAccount.findMany({
    where: { OR: [{ portalClientId: null }, { portalClientId }] },
    select: { portalClientId: true, codigo: true, codigoCompleto: true, nome: true },
  });
  // ⚠ A da empresa vence a global quando o `codigo` colide — a global é o padrão, não a autoridade.
  const porCodigo = new Map();
  for (const c of contas) {
    const atual = porCodigo.get(String(c.codigo));
    if (!atual || (c.portalClientId && !atual.portalClientId)) porCodigo.set(String(c.codigo), c);
  }
  return [...porCodigo.values()];
}

/**
 * ⚠⚠ A MEMÓRIA É LIDA POR EMPRESA, IGNORANDO O USUÁRIO — e isso é decisão, não descuido.
 *
 * A chave de `AccountingHistorico` é `(createdByUserId, companyPortalClientId, text)`. A pergunta
 * que a fila faz é *"o que esta EMPRESA já lançou nesta descrição?"*, não *"o que este usuário
 * lançou"* — e `companyPortalClientId` já é o escopo multi-tenant, então ler sem filtrar o usuário
 * é seguro e é o que responde a pergunta certa. Medido: **1 usuário** em produção hoje.
 *
 * ⚠⚠ OS REGISTROS GLOBAIS (`companyPortalClientId: null`) FICAM DE FORA. São **40** com conta, e
 * eles guardam o **reduzido** — um reduzido só significa alguma coisa dentro de UM plano. Usar o
 * global de uma empresa para traduzir na outra é exatamente o erro que a tradução pelo plano existe
 * para impedir. (Medido: hoje nenhum reduzido é ambíguo entre empresas — mas isso é um fato de
 * hoje, não uma garantia.)
 */
async function memoriaDaEmpresa(portalClientId, client) {
  return client.accountingHistorico.findMany({
    where: { companyPortalClientId: portalClientId },
    select: { text: true, contaDebito: true, usageCount: true },
  });
}

async function regrasVivas(portalClientId, client) {
  return client.regraContabilizacao.findMany({
    where: { portalClientId, ativa: true, suspensaEm: null, revogadaEm: null },
  });
}

/**
 * A conta sugerida para um declarado. **SÓ LEITURA.**
 *
 * ⚠ Devolve a procedência junto, sempre. A tela precisa dizer *de onde* veio a sugestão — "uma
 * regra do fornecedor" e "você já lançou assim antes" pedem conferências diferentes.
 */
export async function sugerirContaPara({ portalClientId, declarado, client = prisma }) {
  const [regras, historico, plano] = await Promise.all([
    regrasVivas(portalClientId, client),
    memoriaDaEmpresa(portalClientId, client),
    planoDaEmpresa(portalClientId, client),
  ]);
  return sugerirConta(declarado, { regras, historico, plano });
}

/**
 * As sugestões para uma FILA inteira, com UMA busca de cada coisa.
 *
 * ⚠ Sem isto, uma fila de 229 linhas faria 229×3 consultas. O motor é puro, então a mesma leitura
 * serve a todas as linhas.
 */
export async function sugerirContaParaLote({ portalClientId, declarados = [], client = prisma }) {
  const [regras, historico, plano] = await Promise.all([
    regrasVivas(portalClientId, client),
    memoriaDaEmpresa(portalClientId, client),
    planoDaEmpresa(portalClientId, client),
  ]);
  return declarados.map((d) => ({ id: d?.id, ...sugerirConta(d, { regras, historico, plano }) }));
}

/**
 * Reavalia o aprendizado de UM fornecedor, depois de o contador confirmar (ou desfazer) algo.
 *
 * ⚠⚠ ELA NÃO CONTABILIZA E NÃO MEXE EM DECLARADO NENHUM. Ela só cria ou suspende regra.
 *
 * ⚠ Chamada **depois** da transição, nunca dentro da transação dela: o aprendizado é consequência,
 * e uma falha aqui não pode desfazer o lançamento que o contador acabou de confirmar. Por isso ela
 * **não lança** — devolve o que fez.
 */
export async function reavaliarAprendizado({
  portalClientId,
  cnpjFornecedor,
  usuarioId = null,
  agora,
  client = prisma,
}) {
  const cnpj = soDigitos(cnpjFornecedor);
  if (!cnpj) return { acao: "NADA", motivo: "sem_cnpj" };

  try {
    // ⚠ Todos os declarados DESTE fornecedor nesta empresa — é o histórico que sustenta (ou
    // derruba) a regra. `contaAplicada` é o que o contador de fato usou.
    const declarados = await client.lancamentoDeclarado.findMany({
      where: { portalClientId, cnpjFornecedor: cnpj },
      select: { id: true, estado: true, contaAplicada: true, valor: true, valorAjustado: true, regraId: true },
    });

    // ⚠ A regra existente inclui as SUSPENSAS e as inativas de propósito: sem elas, `decidirAprendizado`
    // acharia que não existe regra e proporia CRIAR uma segunda para o mesmo fornecedor.
    const regraExistente = await client.regraContabilizacao.findFirst({
      where: { portalClientId, cnpjFornecedor: cnpj, revogadaEm: null },
      orderBy: { criadaEm: "desc" },
    });

    const decisao = decidirAprendizado({ cnpjFornecedor: cnpj, declarados, regraExistente });

    if (decisao.acao === "CRIAR") {
      const regra = await client.regraContabilizacao.create({
        data: {
          portalClientId,
          cnpjFornecedor: decisao.proposta.cnpjFornecedor,
          padraoDescricao: null,
          valorMin: decisao.proposta.valorMin,
          valorMax: decisao.proposta.valorMax,
          contaDestino: decisao.proposta.contaDestino,
          tipo: "SAIDA",
          origemRegra: "APRENDIDA",
          ativa: true,
          criadaPor: usuarioId || "aprendizado",
          confirmacoesBase: decisao.proposta.confirmacoesBase,
          criadaEm: agora,
        },
      });
      return { acao: "CRIAR", regraId: regra.id, proposta: decisao.proposta };
    }

    if (decisao.acao === "SUSPENDER") {
      await client.regraContabilizacao.update({
        where: { id: regraExistente.id },
        data: { suspensaEm: agora, motivoSuspensao: decisao.motivo },
      });
      return { acao: "SUSPENDER", regraId: regraExistente.id, motivo: decisao.motivo, frase: decisao.frase };
    }

    return { acao: "NADA" };
  } catch (e) {
    // ⚠⚠ O APRENDIZADO NUNCA DERRUBA O TRABALHO DO CONTADOR. Se a tabela não existir (a migration
    // não foi aplicada — P2021) ou qualquer outra coisa falhar, a confirmação que acabou de
    // acontecer continua válida. Isto é a mesma disciplina de `listarTomadoresEmitidos`, que não
    // pode derrubar a tela de emissão.
    return { acao: "NADA", motivo: "falhou", erro: e?.code || e?.message || "erro" };
  }
}

/** As regras de uma empresa, para a tela. **SÓ LEITURA.** */
export async function listarRegras({ portalClientId, client = prisma }) {
  const regras = await client.regraContabilizacao.findMany({
    where: { portalClientId, revogadaEm: null },
    orderBy: [{ ativa: "desc" }, { criadaEm: "desc" }],
  });
  return regras.map((r) => ({
    id: r.id,
    cnpjFornecedor: r.cnpjFornecedor,
    padraoDescricao: r.padraoDescricao,
    contaDestino: r.contaDestino,
    valorMin: r.valorMin != null ? String(r.valorMin) : null,
    valorMax: r.valorMax != null ? String(r.valorMax) : null,
    origemRegra: r.origemRegra,
    ativa: r.ativa,
    suspensaEm: r.suspensaEm,
    motivoSuspensao: r.motivoSuspensao,
    // ⚠⚠ A TRILHA VIAJA. Aprendizado invisível é o que impede o contador de desligar a regra no dia
    // em que algo entrar errado — ele precisa poder ver QUAIS lançamentos a geraram.
    confirmacoesBase: r.confirmacoesBase || [],
    aplicacoes: r.aplicacoes ?? 0,
    criadaEm: r.criadaEm,
    criadaPor: r.criadaPor,
  }));
}

/**
 * O contador desliga (ou religa) uma regra, à mão.
 *
 * ⚠ Desligar à mão grava `ativa: false` — **não** `suspensaEm`. As duas colunas respondem coisas
 * diferentes: `suspensaEm` é *"o sistema se freou sozinho, e por quê"*; `ativa` é *"o contador
 * decidiu"*. Colapsá-las faria a tela não distinguir uma suspensão automática de uma escolha.
 */
export async function alternarRegra({ portalClientId, regraId, ativa, client = prisma }) {
  const regra = await client.regraContabilizacao.findFirst({ where: { id: regraId, portalClientId } });
  if (!regra) return null;
  return client.regraContabilizacao.update({
    where: { id: regra.id },
    data: {
      ativa: Boolean(ativa),
      // ⚠ Religar à mão LIMPA a suspensão automática: o contador está dizendo que conferiu. Sem
      // isso a regra ficaria `ativa: true` e `suspensaEm` preenchido — e o motor, que exige as
      // duas, continuaria a ignorá-la. O botão pareceria não fazer nada.
      ...(ativa ? { suspensaEm: null, motivoSuspensao: null } : {}),
    },
  });
}

export { MOTIVO_DA_SUSPENSAO, chaveDaDescricao };
