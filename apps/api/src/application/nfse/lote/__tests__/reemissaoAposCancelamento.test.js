// ⚠⚠ REEMITIR DEPOIS DE CANCELAR — a única exceção à trava de linha EMITIDA (31/08/2026)
//
// > Dono, com o caso na mão: emitiu o lote, cancelou as notas (evento `e101101` ACEITO), subiu a
// > MESMA planilha para reemitir — e a idempotência devolveu o lote antigo, com as notas
// > canceladas, e `nada_a_retentar`. *"eu subi a mesma planilha."*
//
// ⚠⚠ O QUE ESTA SUÍTE PROTEGE é o EQUILÍBRIO: a linha cuja nota foi cancelada REABRE, e todas as
// outras travas continuam mordendo — a emitida VÁLIDA nunca reemite (nota duplicada), a
// indeterminada nunca reemite, e a reemissão reserva número NOVO (o velho está ocupado pela
// cancelada, que continua existindo: não há inutilização na NFS-e).

import {
  criarOuReconhecerLote,
  processarLoteEmissao,
  bloqueioDaRetentativa,
  planoDeRetentativa,
  marcarNotasCanceladas,
  DESFECHO_LINHA,
  MODO,
  STATUS_LOTE,
} from "../emissaoLote.js";
import { ESTADO } from "../classificarLinhaLote.js";

// O mesmo dublê em memória de `emissaoLote.test.js`, com `serviceInvoice` acrescentado — é ele
// que responde "esta nota foi cancelada?".
function prismaFalso({ canceladas = [] } = {}) {
  const lotes = new Map();
  const linhas = new Map();
  let seq = 0;
  const uid = () => `id-${++seq}`;
  const setCanceladas = new Set(canceladas);

  return {
    _linhas: linhas,
    _cancelar: (id) => setCanceladas.add(id),
    serviceInvoice: {
      async findMany({ where }) {
        const ids = where?.id?.in || [];
        return ids
          .filter((id) => setCanceladas.has(id) && where.status === "cancelled")
          .map((id) => ({ id }));
      },
    },
    loteEmissaoNfse: {
      async create({ data }) {
        const id = uid();
        const lote = {
          id, companyId: data.companyId, impressaoDigital: data.impressaoDigital,
          status: STATUS_LOTE.EMITINDO, totalLinhas: data.totalLinhas,
          emitidas: 0, recusadas: 0, naoTentadas: data.naoTentadas ?? 0,
          linhaIndeterminada: null, paradoEm: null, paradoMotivo: null, criadoPor: null,
        };
        lotes.set(id, lote);
        for (const l of data.linhas?.create || []) {
          const lid = uid();
          linhas.set(lid, { id: lid, loteId: id, desfecho: DESFECHO_LINHA.NAO_TENTADA, ...l });
        }
        return { ...lote };
      },
      async findUnique({ where }) { const l = lotes.get(where.id); return l ? { ...l } : null; },
      async findFirst() { return null; },
      async update({ where, data }) { const l = lotes.get(where.id); Object.assign(l, data); return { ...l }; },
    },
    loteEmissaoNfseLinha: {
      async findMany({ where, orderBy }) {
        let out = [...linhas.values()].filter((l) => l.loteId === where.loteId);
        if (where.desfecho?.in) out = out.filter((l) => where.desfecho.in.includes(l.desfecho));
        else if (where.desfecho) out = out.filter((l) => l.desfecho === where.desfecho);
        if (where.numeroLinha?.gt !== undefined) out = out.filter((l) => l.numeroLinha > where.numeroLinha.gt);
        if (where.numeroLinha?.not !== undefined) out = out.filter((l) => l.numeroLinha !== where.numeroLinha.not);
        if (orderBy?.numeroLinha === "asc") out.sort((a, b) => a.numeroLinha - b.numeroLinha);
        return out.map((l) => ({ ...l }));
      },
      async update({ where, data }) { const l = linhas.get(where.id); Object.assign(l, data); return { ...l }; },
      async updateMany({ where, data }) {
        let n = 0;
        for (const [, l] of linhas) {
          if (where.id !== undefined && l.id !== where.id) continue;
          if (where.loteId !== undefined && l.loteId !== where.loteId) continue;
          if (where.desfecho?.in !== undefined) {
            if (!where.desfecho.in.includes(l.desfecho)) continue;
          } else if (where.desfecho !== undefined && l.desfecho !== where.desfecho) continue;
          Object.assign(l, data); n += 1;
        }
        return { count: n };
      },
    },
  };
}

const COMPANY = "company-legada-1";

function linhaPronta(numero) {
  return {
    numero,
    estado: ESTADO.PRONTA,
    dados: {
      tomador: {
        doc: "39254243000191", nome: `TOMADOR ${numero}`, email: null,
        endereco: { cMun: "3304557", CEP: "20031005", xLgr: "Av. Rio Branco", nro: "1", xCpl: null, xBairro: "Centro" },
      },
      servico: { descricao: "Consultoria", valorServicos: 1500 },
      competencia: new Date(2026, 6, 31),
    },
  };
}

const emitiuOk = (n) => ({
  status: "issued", message: "ok",
  nfse: { id: `si-${n}`, rpsSerie: "00001", rpsNumero: String(n) },
});

/** Emite um lote de 2 linhas inteiro e devolve { prisma, lote } com as duas EMITIDAS. */
async function loteEmitido() {
  const prisma = prismaFalso();
  const { lote } = await criarOuReconhecerLote({
    prisma, companyId: COMPANY, linhasProntas: [linhaPronta(2), linhaPronta(3)],
  });
  let n = 0;
  const emitir = jest.fn(async () => emitiuOk(++n + 10));
  const final = await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir });
  expect(final.linhas.every((l) => l.desfecho === DESFECHO_LINHA.EMITIDA)).toBe(true);
  return { prisma, lote: final };
}

describe("⚠⚠ a regra pura — a marca reabre, a ausência dela não", () => {
  it("linha EMITIDA com `notaCancelada: true` volta a ser retentável", () => {
    expect(bloqueioDaRetentativa({ desfecho: DESFECHO_LINHA.EMITIDA, notaCancelada: true })).toBeNull();
  });

  it("⚠⚠ linha EMITIDA SEM a marca continua bloqueada — é a trava da nota duplicada", () => {
    for (const linha of [
      { desfecho: DESFECHO_LINHA.EMITIDA },
      { desfecho: DESFECHO_LINHA.EMITIDA, notaCancelada: false },
      // ⚠ truthy NÃO basta: `=== true`, como toda marca de permissão desta casa.
      { desfecho: DESFECHO_LINHA.EMITIDA, notaCancelada: "sim" },
    ]) {
      expect(bloqueioDaRetentativa(linha)).toMatch(/nota duplicada/);
    }
  });

  it("⚠ a marca NÃO reabre a indeterminada — cancelamento provado é de nota que se sabe existir", () => {
    expect(bloqueioDaRetentativa({ desfecho: DESFECHO_LINHA.INDETERMINADA, notaCancelada: true }))
      .toMatch(/não se sabe/);
  });

  it("⚠ e a linha nomeada como indeterminada no LOTE fica fora mesmo cancelada", () => {
    const linha = { desfecho: DESFECHO_LINHA.EMITIDA, notaCancelada: true, numeroLinha: 2 };
    expect(bloqueioDaRetentativa(linha, { linhaIndeterminada: 2 })).not.toBeNull();
  });
});

describe("⚠⚠ o ciclo inteiro: emitir → cancelar → reemitir a MESMA planilha", () => {
  it("o plano do lote com uma nota cancelada oferece SÓ ela", async () => {
    const { prisma, lote } = await loteEmitido();
    const daLinha2 = lote.linhas.find((l) => l.numeroLinha === 2);
    prisma._cancelar(daLinha2.serviceInvoiceId);

    const marcado = await marcarNotasCanceladas({ prisma, lote });
    const plano = planoDeRetentativa(marcado);
    expect(plano.quantas).toBe(1);
    expect(plano.retentaveis?.[0]?.numeroLinha ?? plano.quantas).toBeTruthy();
    // ⚠ A linha 3, cuja nota está VÁLIDA, continua bloqueada com o motivo da duplicata.
    expect(plano.bloqueadas.some((b) => b.numeroLinha === 3 && /duplicada/.test(b.motivo))).toBe(true);
  });

  it("⚠⚠ a retentativa REEMITE a cancelada com número NOVO, e não toca na válida", async () => {
    const { prisma, lote } = await loteEmitido();
    const daLinha2 = lote.linhas.find((l) => l.numeroLinha === 2);
    prisma._cancelar(daLinha2.serviceInvoiceId);

    const emitir = jest.fn(async () => emitiuOk(99));
    const final = await processarLoteEmissao({
      prisma, loteId: lote.id, companyId: COMPANY, emitir, modo: MODO.RETENTATIVA,
    });

    // Uma emissão só — a da linha cancelada.
    expect(emitir).toHaveBeenCalledTimes(1);
    // ⚠⚠ NÚMERO NOVO: `retryInvoiceId` nulo. O número velho está ocupado pela nota cancelada, que
    // continua existindo — reusar sobrescreveria o registro de um documento fiscal.
    expect(emitir.mock.calls[0][0].retryInvoiceId).toBeNull();

    const linha2 = final.linhas.find((l) => l.numeroLinha === 2);
    expect(linha2.desfecho).toBe(DESFECHO_LINHA.EMITIDA);
    expect(linha2.serviceInvoiceId).toBe("si-99");
    // A linha 3 ficou exatamente como estava.
    const linha3 = final.linhas.find((l) => l.numeroLinha === 3);
    expect(linha3.serviceInvoiceId).not.toBe("si-99");
  });

  it("⚠⚠ SEM cancelamento nenhum, a retentativa continua vazia — a idempotência de sempre", async () => {
    const { prisma, lote } = await loteEmitido();
    const emitir = jest.fn(async () => emitiuOk(99));
    await processarLoteEmissao({
      prisma, loteId: lote.id, companyId: COMPANY, emitir, modo: MODO.RETENTATIVA,
    });
    expect(emitir).not.toHaveBeenCalled();
  });

  it("⚠⚠ em modo RETOMADA a cancelada NÃO entra — reemitir é decisão explícita, nunca efeito colateral", async () => {
    const { prisma, lote } = await loteEmitido();
    const daLinha2 = lote.linhas.find((l) => l.numeroLinha === 2);
    prisma._cancelar(daLinha2.serviceInvoiceId);
    const emitir = jest.fn(async () => emitiuOk(99));
    await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir });
    expect(emitir).not.toHaveBeenCalled();
  });
});
