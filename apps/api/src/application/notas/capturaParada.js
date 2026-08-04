// "A captura desta empresa parou?" — o sinal que faltava.
//
// O QUE ACONTECEU
// O cursor NSU travou na ARAUJO BARRETO e a captura passou a devolver `ok:true, totalDocs:0` todo
// dia. Essa é EXATAMENTE a resposta de uma empresa que legitimamente não emitiu nada. Nada na tela,
// no log ou no banco distinguia as duas — e a nota ficou 29 dias fora do sistema.
//
// ⚠ NÃO DÁ PARA PROVAR ISSO SOZINHO. Só o ADN sabe se existe nota que não temos; quem responde essa
// pergunta é `ConferenciaAdnService`, contra a fonte autoritativa. O que dá para fazer aqui é
// SUSPEITAR cedo, e a suspeita honesta é: *esta empresa está calada por mais tempo do que ela
// jamais ficou*.
//
// POR QUE O LIMIAR É O HISTÓRICO DELA, E NÃO UM NÚMERO FIXO
// Qualquer constante ("30 dias") erra nos dois sentidos: alarme falso na empresa que emite duas
// vezes por ano, e silêncio na que emite toda semana. Comparando com o MAIOR intervalo já observado
// para a própria empresa, o limiar se calibra sozinho e a regra fica explicável em uma frase.

import { prisma } from "../../infrastructure/db/prisma.js";

const DIA_MS = 24 * 60 * 60 * 1000;
// Piso para não transformar quem emite todo dia em alarme por dois dias de feriado.
const PISO_DIAS = 10;
// Sem histórico não há intervalo típico, e chutar um seria inventar. Abaixo disto, não opinamos.
const MINIMO_DOCUMENTOS = 3;
const JANELA_MESES = 12;

const dias = (ms) => Math.floor(ms / DIA_MS);

/**
 * @param {string[]} portalIds
 * @returns {Promise<Map<string, {
 *   ultimaTentativaEm: Date|null, ultimoDocumentoEm: Date|null,
 *   diasSemDocumento: number|null, maiorIntervaloDias: number|null, suspeita: boolean
 * }>>}
 */
export async function capturaParadaPorEmpresa(portalIds) {
  const ids = [...new Set((portalIds || []).filter(Boolean))];
  const mapa = new Map();
  if (!ids.length) return mapa;

  const desde = new Date(Date.now() - JANELA_MESES * 30 * DIA_MS);
  const [notas, estados] = await Promise.all([
    // Só EMIT: nota recebida chega quando o fornecedor emite, não diz nada sobre a atividade DESTA
    // empresa — e é justamente o faturamento dela que não pode faltar.
    prisma.portalInvoice.findMany({
      where: { clientId: { in: ids }, papel: "EMIT", issueDate: { gte: desde } },
      select: { clientId: true, issueDate: true },
      orderBy: { issueDate: "asc" },
    }),
    prisma.portalSyncState.findMany({
      where: { clientId: { in: ids } },
      select: { clientId: true, adnLastAttemptAt: true, adnLastSyncAt: true },
    }),
  ]);

  const porEmpresa = new Map();
  for (const n of notas) {
    if (!n.issueDate) continue;
    if (!porEmpresa.has(n.clientId)) porEmpresa.set(n.clientId, []);
    porEmpresa.get(n.clientId).push(new Date(n.issueDate).getTime());
  }
  const estadoPorId = new Map(estados.map((e) => [e.clientId, e]));

  const agora = Date.now();
  for (const id of ids) {
    const datas = porEmpresa.get(id) || [];
    const st = estadoPorId.get(id) || {};
    const ultimo = datas.length ? datas[datas.length - 1] : null;

    let maiorIntervalo = null;
    for (let i = 1; i < datas.length; i++) {
      const gap = dias(datas[i] - datas[i - 1]);
      if (maiorIntervalo == null || gap > maiorIntervalo) maiorIntervalo = gap;
    }

    const diasSemDocumento = ultimo == null ? null : dias(agora - ultimo);
    const limite = Math.max(maiorIntervalo ?? 0, PISO_DIAS);
    const suspeita = Boolean(
      datas.length >= MINIMO_DOCUMENTOS
      && diasSemDocumento != null
      && diasSemDocumento > limite,
    );

    mapa.set(id, {
      // ⚠ Os DOIS carimbos aparecem de propósito. "Olhamos hoje e não veio nada" e "ninguém olhou
      // há um mês" são problemas diferentes, com donos diferentes — e eram o mesmo campo antes.
      ultimaTentativaEm: st.adnLastAttemptAt || null,
      ultimoDocumentoEm: ultimo == null ? null : new Date(ultimo),
      diasSemDocumento,
      maiorIntervaloDias: maiorIntervalo,
      suspeita,
    });
  }

  return mapa;
}
