// Q15.4 — Memória da última configuração de apuração por empresa.
//
// Sempre que uma apuração é salva/transmitida, a config usada (atividades
// escolhidas, folha série, regime) é gravada. Na próxima competência, o modal
// de fechamento reabre pré-preenchido com a última config. Mesmo padrão do
// AccountingHistorico (memória de D/C).
//
// ─── ⚠ A MEMÓRIA GUARDA A **FORMA**, NUNCA O VALOR ────────────────────────────────────────────
//
// A chave desta tabela é `portalClientId` — **não há competência**. Ou seja: um único registro por
// empresa, reaberto em TODA competência seguinte. Gravar o VALOR aqui significa carregar o valor de
// um mês para dentro de outro, e foi o que aconteceu em produção.
//
// Medido (12 memórias, 95 pares empresa×competência de 02/2026 a 07/2026):
//   • o pré-preenchimento veio da memória em **72** casos;
//   • dos 85 com faturamento real, **48 DIVERGIAM** do faturamento da própria competência;
//   • dos 10 SEM faturamento nenhum, **10 de 10** abriram com valor > 0 na tela.
//   • o faturamento de 07/2026 da ARAUJO (R$ 20.301,21) aparecia em fev, mar, abr, mai e jun.
//
// ⚠ E ISSO DERROTAVA, EM PRODUÇÃO, O GATE POR SOMA (`7b341aad`): com `somaAtividades > 0` a
// declaração não é lida como zerada, a caixa "Declarar SEM MOVIMENTO" não renderiza e o botão
// Calcular fica habilitado — chamada PAGA ao SERPRO declarando receita que não existe naquele mês.
// Casos vivos: IOHANNA R$ 3.680,00 (4 competências), CHAYM R$ 17.640,00 (3), PRISMA R$ 12.000,00 (2).
//
// Então: a memória guarda **atividade, anexo e MERCADO** (o que não muda de mês para mês), e o
// valor pré-preenchido passa a vir do faturamento da PRÓPRIA competência — em `getDadosFechamento`.
//
// ⚠ O MERCADO É O CAMPO QUE **SÓ EXISTE AQUI**, e perdê-lo chega na declaração.
// `NotaItem.flagExportacao` é `false` em 16.153 de 16.153 itens, porque o ÚNICO escritor desse campo
// é o parser de NF-e (`notas/dfe/DfeParser.js`, CFOP 7xxx) — a criação do item da NFS-e nunca o
// toca. A CDA MARKETING presta serviço ao EXTERIOR e as duas declarações dela
// (`65227792202606001`, `65227792202607001`) saíram com receita EXTERNA **por causa desta memória**.
// Se a limpeza levasse o mercado junto, a empresa nasceria como interna na competência seguinte e o
// erro chegaria à declaração. Por isso `mercado` está em `CAMPOS_DA_FORMA` e é o que o script de
// limpeza confere antes e depois.

import { prisma } from "../../../../infrastructure/db/prisma.js";

/**
 * O que sobrevive de uma competência para a outra: a FORMA da apuração.
 *
 * `idAtividade` é o que o contador escolhe (a RFB deriva anexo, faixa e III↔V a partir dele);
 * `mercado` diz se a receita é interna ou de exportação e **não tem outra fonte** nesta base;
 * `anexoImplicito`/`sujeitoFatorR`/`tipoReceita` viajam junto porque a tela e o payload os leem
 * direto da linha (o Fator-R decide se a folha entra no envio).
 */
export const CAMPOS_DA_FORMA = [
  "idAtividade", "descricao", "anexoImplicito", "mercado", "sujeitoFatorR", "tipoReceita",
];

/** Campos de VALOR — nunca gravados na memória (são da competência, não da empresa). */
export const CAMPOS_DE_VALOR = ["valorInterno", "valorExterno"];

/**
 * Reduz uma lista de atividades à FORMA: mantém `CAMPOS_DA_FORMA`, descarta o resto.
 *
 * ⚠ Não inventa nada: campo ausente na entrada continua ausente na saída. Uma memória antiga que
 * nunca guardou `mercado` não ganha um "INTERNO" de brinde aqui — supor mercado é exatamente o erro
 * que a declaração da CDA mostraria.
 *
 * @param {Array} lista
 * @returns {Array}
 */
export function normalizarFormaAtividades(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((a) => a && a.idAtividade != null)
    .map((a) => {
      const forma = {};
      for (const campo of CAMPOS_DA_FORMA) {
        if (a[campo] !== undefined) forma[campo] = a[campo];
      }
      return forma;
    });
}

/** Soma dos valores gravados numa lista de atividades (diagnóstico / script de limpeza). */
export function somaDaLista(lista) {
  return +(Array.isArray(lista) ? lista : []).reduce(
    (s, a) => s + Number(a?.valorInterno || 0) + Number(a?.valorExterno || 0), 0,
  ).toFixed(2);
}

/**
 * Salva (upsert) a última config de apuração da empresa.
 *
 * ⚠ `atividadesEscolhidas` é gravado SEM os valores — ver o cabeçalho deste arquivo.
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {Array}  opts.atividadesEscolhidas
 * @param {Array}  [opts.folhaMensal12]  — série de 12 meses [{ pa, valor }]
 * @param {string} [opts.regimeApuracao]
 * @param {Object} [opts.flags]
 * @param {string} [opts.userId]
 */
export async function salvarConfigMemory({
  portalClientId, atividadesEscolhidas, folhaMensal12, regimeApuracao, flags, userId,
}) {
  if (!portalClientId) return null;
  const data = {
    atividadesEscolhidas: normalizarFormaAtividades(atividadesEscolhidas),
    // ⚠ A FOLHA CONTINUA COM VALOR, de propósito: ela já é uma série de 12 meses ANTERIORES
    // carimbada por `pa` (`[{ pa, valor }]`), e o modal só reusa a célula do `pa` que bate. Não há
    // como um valor de julho aparecer como sendo de março — que é exatamente o que acontecia com a
    // atividade, que não tem competência nenhuma.
    folhaMensal12: folhaMensal12 ?? null,
    regimeApuracao: regimeApuracao ?? null,
    flags: flags ?? null,
    atualizadoEm: new Date(),
    atualizadoPor: userId ?? null,
  };
  const existing = await prisma.apuracaoConfigMemory.findUnique({ where: { portalClientId } });
  return existing
    ? prisma.apuracaoConfigMemory.update({ where: { portalClientId }, data })
    : prisma.apuracaoConfigMemory.create({ data: { ...data, portalClientId } });
}

/**
 * Lê a última config conhecida da empresa (ou null).
 *
 * ⚠ A LEITURA TAMBÉM NORMALIZA. As 12 memórias que já existem em produção foram gravadas COM
 * valores, e o script de limpeza é rodado pelo dono — quem lê não pode depender disso ter
 * acontecido. Normalizar aqui faz o valor fantasma parar de chegar à tela no primeiro deploy;
 * a limpeza só torna o banco consistente com o que o código já faz.
 *
 * @returns {Promise<{atividadesEscolhidas, folhaMensal12, regimeApuracao, flags, atualizadoEm}|null>}
 */
export async function lerConfigMemory({ portalClientId }) {
  if (!portalClientId) return null;
  const row = await prisma.apuracaoConfigMemory.findUnique({ where: { portalClientId } });
  if (!row) return null;
  return { ...row, atividadesEscolhidas: normalizarFormaAtividades(row.atividadesEscolhidas) };
}
