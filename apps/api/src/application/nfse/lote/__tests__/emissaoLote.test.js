// O LAÇO DA EMISSÃO EM LOTE — sequencial, persistido, e parando no desfecho desconhecido.
//
// ⚠⚠ NADA AQUI EMITE. `emitir` é um DUBLÊ em todos os casos; `NfseService` não é sequer importado.
// O caminho mais perigoso do sistema (a camada TRANSPORTE, que para o lote) é exercido AQUI — senão
// ele seria o único que ninguém vê antes de acontecer com nota fiscal de verdade.

import {
  criarOuReconhecerLote,
  processarLoteEmissao,
  selecionarParaRetomada,
  impressaoDigitalDoLote,
  linhasEmitiveis,
  bloqueioDaRetentativa,
  planoDeRetentativa,
  podeRetentar,
  DESFECHOS_RETENTAVEIS,
  DESFECHO_LINHA,
  MODO,
  STATUS_LOTE,
} from "../emissaoLote.js";
import { ESTADO } from "../classificarLinhaLote.js";

// ─── UM PRISMA DE MENTIRA, EM MEMÓRIA ────────────────────────────────────────────────────────
//
// ⚠ Ele guarda estado de verdade (as linhas mudam de desfecho e persistem entre chamadas), porque é
// exatamente a PERSISTÊNCIA que este módulo existe para garantir. Um mock que só conta chamadas não
// provaria que a retomada evita a linha indeterminada.
function prismaFalso() {
  const lotes = new Map();
  const linhas = new Map();
  let seq = 0;
  const uid = () => `id-${++seq}`;

  return {
    _lotes: lotes,
    _linhas: linhas,
    loteEmissaoNfse: {
      async create({ data }) {
        const id = uid();
        const lote = {
          id,
          companyId: data.companyId,
          impressaoDigital: data.impressaoDigital,
          status: STATUS_LOTE.EMITINDO,
          totalLinhas: data.totalLinhas,
          emitidas: 0,
          recusadas: 0,
          naoTentadas: data.naoTentadas ?? 0,
          linhaIndeterminada: null,
          paradoEm: null,
          paradoMotivo: null,
          criadoPor: data.criadoPor ?? null,
        };
        for (const [, outro] of lotes) {
          if (outro.companyId === lote.companyId && outro.impressaoDigital === lote.impressaoDigital) {
            const err = new Error("unique"); err.code = "P2002"; throw err;
          }
        }
        lotes.set(id, lote);
        for (const l of data.linhas?.create || []) {
          const lid = uid();
          linhas.set(lid, { id: lid, loteId: id, desfecho: DESFECHO_LINHA.NAO_TENTADA, ...l });
        }
        return { ...lote };
      },
      async findUnique({ where }) {
        const l = lotes.get(where.id);
        return l ? { ...l } : null;
      },
      async findFirst({ where }) {
        for (const [, l] of lotes) {
          if (l.companyId === where.companyId && l.impressaoDigital === where.impressaoDigital) return { ...l };
        }
        return null;
      },
      async update({ where, data }) {
        const l = lotes.get(where.id);
        Object.assign(l, data);
        return { ...l };
      },
    },
    loteEmissaoNfseLinha: {
      async findMany({ where, orderBy }) {
        let out = [...linhas.values()].filter((l) => l.loteId === where.loteId);
        // ⚠ `desfecho` chega como valor cru OU como `{ in: [...] }` — o segundo é o conjunto FECHADO
        // de estados de onde a linha pode sair para `enviando`. O dublê tem de honrar os dois, senão
        // o teste da retentativa mediria uma query que o Prisma real não executaria.
        if (where.desfecho?.in) out = out.filter((l) => where.desfecho.in.includes(l.desfecho));
        else if (where.desfecho) out = out.filter((l) => l.desfecho === where.desfecho);
        if (where.numeroLinha?.gt !== undefined) out = out.filter((l) => l.numeroLinha > where.numeroLinha.gt);
        if (where.numeroLinha?.not !== undefined) out = out.filter((l) => l.numeroLinha !== where.numeroLinha.not);
        if (orderBy?.numeroLinha === "asc") out.sort((a, b) => a.numeroLinha - b.numeroLinha);
        return out.map((l) => ({ ...l }));
      },
      async update({ where, data }) {
        const l = linhas.get(where.id);
        Object.assign(l, data);
        return { ...l };
      },
      async updateMany({ where, data }) {
        let n = 0;
        for (const [, l] of linhas) {
          // ⚠ o `where` por `id` + `desfecho` é a RESERVA ATÔMICA da linha — o mock precisa
          // respeitá-la, senão o teste da emissão dupla não mediria nada.
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

function linhaPronta(numero, extra = {}) {
  return {
    numero,
    estado: ESTADO.PRONTA,
    dados: {
      tomador: {
        doc: "39254243000191",
        nome: `TOMADOR ${numero}`,
        email: null,
        endereco: { cMun: "3304557", CEP: "20031005", xLgr: "Av. Rio Branco", nro: "1", xCpl: null, xBairro: "Centro" },
      },
      servico: { descricao: "Consultoria", valorServicos: 1500 },
      competencia: new Date(2026, 6, 31),
      ...extra,
    },
  };
}

/** O desfecho de SUCESSO, na forma que `NfseService.issue` devolve. */
const emitiuOk = (n) => ({
  status: "issued",
  message: "ok",
  nfse: { id: `si-${n}`, rpsSerie: "00001", rpsNumero: String(n) },
});

/** ⚠⚠ A camada TRANSPORTE — 502, desfecho DESCONHECIDO. É ela que para o lote. */
const transporte = (n) => ({
  status: "falha_envio",
  camada: "TRANSPORTE",
  codigo: "ETIMEDOUT",
  message: "Falha de comunicação com o sistema nacional.",
  correcao: "Não se sabe se a DPS chegou a ser processada.",
  numeroReutilizavel: false,
  nfse: { id: `si-${n}`, rpsSerie: "00001", rpsNumero: String(n) },
});

async function montar(prisma, quantidade) {
  const prontas = Array.from({ length: quantidade }, (_, i) => linhaPronta(i + 2));
  const { lote } = await criarOuReconhecerLote({ prisma, companyId: COMPANY, linhasProntas: prontas });
  return lote;
}

describe("só entra o que está PRONTA", () => {
  it("⚠⚠ `conferir` NÃO entra, mesmo trazendo `dados`", () => {
    const conferir = { ...linhaPronta(3), estado: ESTADO.CONFERIR };
    const escolhidas = linhasEmitiveis({
      linhas: [linhaPronta(2), conferir, { numero: 4, estado: ESTADO.PENDENTE, dados: null }],
    });
    expect(escolhidas.map((l) => l.numero)).toEqual([2]);
  });
});

describe("a impressão digital", () => {
  it("a mesma planilha dá a mesma impressão; conteúdo diferente dá outra", () => {
    const a = impressaoDigitalDoLote(COMPANY, [linhaPronta(2)]);
    const b = impressaoDigitalDoLote(COMPANY, [linhaPronta(2)]);
    expect(a).toBe(b);
    const c = impressaoDigitalDoLote(COMPANY, [
      linhaPronta(2, { servico: { descricao: "Outro", valorServicos: 99 } }),
    ]);
    expect(c).not.toBe(a);
  });

  it("⚠ a empresa entra na impressão — a mesma planilha em outra empresa é outro lote", () => {
    expect(impressaoDigitalDoLote("empresa-A", [linhaPronta(2)]))
      .not.toBe(impressaoDigitalDoLote("empresa-B", [linhaPronta(2)]));
  });

  it("⚠⚠ subir a MESMA planilha duas vezes RECONHECE em vez de criar outro lote", async () => {
    const prisma = prismaFalso();
    const prontas = [linhaPronta(2), linhaPronta(3)];
    const um = await criarOuReconhecerLote({ prisma, companyId: COMPANY, linhasProntas: prontas });
    const dois = await criarOuReconhecerLote({ prisma, companyId: COMPANY, linhasProntas: prontas });
    expect(um.reconhecido).toBe(false);
    expect(dois.reconhecido).toBe(true);
    expect(dois.lote.id).toBe(um.lote.id);
    expect(prisma._lotes.size).toBe(1);
  });
});

describe("o laço", () => {
  it("emite em SÉRIE e grava o desfecho de cada linha", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 3);
    const ordem = [];
    const emitir = jest.fn(async ({ data }) => {
      ordem.push(data.tomador.nome);
      return emitiuOk(ordem.length);
    });

    const final = await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir });

    expect(emitir).toHaveBeenCalledTimes(3);
    expect(ordem).toEqual(["TOMADOR 2", "TOMADOR 3", "TOMADOR 4"]);
    expect(final.status).toBe(STATUS_LOTE.CONCLUIDO);
    expect(final.emitidas).toBe(3);
    expect(final.linhas.every((l) => l.desfecho === DESFECHO_LINHA.EMITIDA)).toBe(true);
    expect(final.linhas[0].rpsNumero).toBe("1");
  });

  it("⚠ o `companyId` vem do LOTE, nunca dos dados da linha", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 1);
    const emitir = jest.fn(async () => emitiuOk(1));
    await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir });
    expect(emitir.mock.calls[0][0].data.companyId).toBe(COMPANY);
  });

  it("recusa da RECEITA não para o lote — é fato daquela nota", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 3);
    const emitir = jest.fn()
      .mockResolvedValueOnce(emitiuOk(1))
      .mockResolvedValueOnce({
        status: "rejected", camada: "RECEITA", codigo: "E0014",
        message: "já existe", nfse: { id: "si-2", rpsSerie: "00001", rpsNumero: "2" },
      })
      .mockResolvedValueOnce(emitiuOk(3));

    const final = await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir });

    expect(emitir).toHaveBeenCalledTimes(3);
    expect(final.status).toBe(STATUS_LOTE.CONCLUIDO);
    expect(final.emitidas).toBe(2);
    expect(final.recusadas).toBe(1);
    expect(final.linhas[1].desfecho).toBe(DESFECHO_LINHA.RECUSADA_RECEITA);
    expect(final.linhas[1].codigo).toBe("E0014");
  });

  // ⚠⚠ O CAMINHO MAIS PERIGOSO DO SISTEMA, E É POR ISSO QUE ELE TEM O TESTE MAIS DETALHADO.
  it("⚠⚠ TRANSPORTE para o lote NA HORA, nomeia a linha e NÃO tenta as seguintes", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 5);
    const emitir = jest.fn()
      .mockResolvedValueOnce(emitiuOk(1))
      .mockResolvedValueOnce(transporte(2))
      .mockResolvedValue(emitiuOk(99));

    const final = await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir });

    // parou na segunda: as três seguintes NUNCA foram tentadas
    expect(emitir).toHaveBeenCalledTimes(2);
    expect(final.status).toBe(STATUS_LOTE.PARADO_INDETERMINADO);
    expect(final.linhaIndeterminada).toBe(3); // a linha 3 do Excel é a 2ª do lote
    expect(final.linhas[1].desfecho).toBe(DESFECHO_LINHA.INDETERMINADA);
    expect(final.linhas[1].camada).toBe("TRANSPORTE");
    // ⚠ o número reservado fica REGISTRADO: é informação fiscal, não detalhe técnico
    expect(final.linhas[1].rpsNumero).toBe("2");
    // ⚠ as seguintes continuam `nao_tentada` — que é a verdade: ninguém encostou nelas
    expect(final.linhas.slice(2).every((l) => l.desfecho === DESFECHO_LINHA.NAO_TENTADA)).toBe(true);
    expect(final.naoTentadas).toBe(3);
  });

  it("⚠ recusa NOSSA não queima número — `rpsNumero` fica NULO", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 2);
    const emitir = jest.fn()
      .mockResolvedValueOnce({
        status: "falha_envio", camada: "NOSSA", codigo: "MISSING_TOMADOR_ADDRESS",
        message: "endereço incompleto", numeroReutilizavel: true, nfse: null,
      })
      .mockResolvedValueOnce(emitiuOk(1));

    const final = await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir });

    expect(final.status).toBe(STATUS_LOTE.CONCLUIDO);
    expect(final.linhas[0].desfecho).toBe(DESFECHO_LINHA.RECUSADA_NOSSA);
    expect(final.linhas[0].rpsNumero).toBeNull();
    expect(final.linhas[0].camada).toBe("NOSSA");
  });

  it("⚠⚠ exceção NÃO classificada PARA o lote — não se prova que nada saiu", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 3);
    const emitir = jest.fn()
      .mockResolvedValueOnce(emitiuOk(1))
      .mockRejectedValueOnce(Object.assign(new Error("banco caiu ao gravar"), { code: "P1001" }))
      .mockResolvedValue(emitiuOk(99));

    const final = await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir });

    expect(emitir).toHaveBeenCalledTimes(2);
    expect(final.status).toBe(STATUS_LOTE.PARADO_INDETERMINADO);
    expect(final.linhas[1].desfecho).toBe(DESFECHO_LINHA.INDETERMINADA);
  });

  it("⚠ exceção de PRÉ-VOO (nada saiu) é recusa daquela linha e o lote SEGUE", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 3);
    const emitir = jest.fn()
      .mockResolvedValueOnce(emitiuOk(1))
      .mockRejectedValueOnce(Object.assign(new Error("sem série"), { code: "SERIE_NAO_CADASTRADA" }))
      .mockResolvedValueOnce(emitiuOk(3));

    const final = await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir });

    expect(emitir).toHaveBeenCalledTimes(3);
    expect(final.status).toBe(STATUS_LOTE.CONCLUIDO);
    expect(final.linhas[1].desfecho).toBe(DESFECHO_LINHA.RECUSADA_NOSSA);
  });
});

describe("⚠⚠ a retomada NUNCA toca a linha indeterminada", () => {
  it("a seleção começa DEPOIS dela — e é query, não `if`", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 5);
    const emitir = jest.fn()
      .mockResolvedValueOnce(emitiuOk(1))
      .mockResolvedValueOnce(transporte(2))
      .mockResolvedValue(emitiuOk(99));
    await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir });

    const parado = await prisma.loteEmissaoNfse.findUnique({ where: { id: lote.id } });
    const aRetomar = await selecionarParaRetomada({ prisma, lote: parado });

    // a linha 3 (a indeterminada) está FORA; a retomada começa na 4
    expect(aRetomar.map((l) => l.numeroLinha)).toEqual([4, 5, 6]);
  });

  it("retomar emite só as seguintes, e a indeterminada continua indeterminada", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 5);
    const primeiro = jest.fn()
      .mockResolvedValueOnce(emitiuOk(1))
      .mockResolvedValueOnce(transporte(2))
      .mockResolvedValue(emitiuOk(99));
    await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir: primeiro });

    const segundo = jest.fn(async () => emitiuOk(9));
    const final = await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir: segundo });

    expect(segundo).toHaveBeenCalledTimes(3);
    const nomes = segundo.mock.calls.map((c) => c[0].data.tomador.nome);
    expect(nomes).toEqual(["TOMADOR 4", "TOMADOR 5", "TOMADOR 6"]);
    expect(nomes).not.toContain("TOMADOR 3");
    expect(final.linhas[1].desfecho).toBe(DESFECHO_LINHA.INDETERMINADA);
    expect(final.emitidas).toBe(4);
  });
});

// ⚠⚠ O TESTE QUE PROTEGE CONTRA A DUPLICAÇÃO POR CONCORRÊNCIA.
//
// Duplo clique em "retomar", ou um reinício com a requisição anterior ainda viva, faz DOIS
// processamentos do MESMO lote correrem juntos. Sem a reserva atômica da linha (`updateMany` com o
// desfecho no `where`), os dois leem `nao_tentada`, os dois marcam `enviando` e os DOIS emitem.
describe("⚠⚠ dois processamentos concorrentes do mesmo lote não emitem a mesma linha duas vezes", () => {
  it("cada linha é emitida UMA vez só", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 4);

    const emitidos = [];
    const emitir = jest.fn(async ({ data }) => {
      emitidos.push(data.tomador.nome);
      // cede o event loop no meio do envio — é aqui que o outro laço se intercala
      await new Promise((r) => setImmediate(r));
      return emitiuOk(emitidos.length);
    });

    await Promise.all([
      processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir }),
      processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir }),
    ]);

    // ⚠ 4 linhas ⇒ no MÁXIMO 4 emissões, e nenhum tomador repetido
    expect(emitidos.length).toBeLessThanOrEqual(4);
    expect(new Set(emitidos).size).toBe(emitidos.length);
  });
});

describe("⚠⚠ a janela `enviando` — o processo que morreu no meio de um ato fiscal", () => {
  it("linha presa em `enviando` vira INDETERMINADA e o lote para, sem reemitir", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 4);
    // simula a queda: a 2ª linha ficou marcada `enviando` e nada mais aconteceu
    const alvo = [...prisma._linhas.values()].find((l) => l.numeroLinha === 3);
    alvo.desfecho = DESFECHO_LINHA.ENVIANDO;

    const emitir = jest.fn(async () => emitiuOk(1));
    const final = await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir });

    // ⚠ NINGUÉM foi emitido: o lote parou antes de tentar qualquer linha
    expect(emitir).not.toHaveBeenCalled();
    expect(final.lote?.status ?? final.status).toBe(STATUS_LOTE.PARADO_INDETERMINADO);
    const linhas = await prisma.loteEmissaoNfseLinha.findMany({ where: { loteId: lote.id }, orderBy: { numeroLinha: "asc" } });
    expect(linhas[1].desfecho).toBe(DESFECHO_LINHA.INDETERMINADA);
    expect(linhas[1].codigo).toBe("PROCESSO_INTERROMPIDO");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A RETENTATIVA — E A REGRA QUE SEPARA UM CONSERTO DE UM DESASTRE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Caso real, 21/08/2026: lote de 3 notas RECUSADO pela Receita por erro de esquema (`E1235`). O
// erro do XML foi consertado e está em produção; subir a mesma planilha respondia "já havia sido
// emitida" — com **0 emitidas e 3 recusadas**, ou seja, nenhuma nota no mundo e nenhuma saída.
//
// ⚠⚠ Todo teste daqui mede a regra pelo desfecho da LINHA, nunca pelo status do lote — é a
// distinção que impede um "retentar tudo" de reemitir nota que já existe.

describe("⚠⚠ a regra de retentabilidade — só o desfecho que PROVA que não existe nota", () => {
  it("os três retentáveis são exatamente `nao_tentada`, `recusada_receita` e `recusada_nossa`", () => {
    expect([...DESFECHOS_RETENTAVEIS].sort()).toEqual(
      [
        DESFECHO_LINHA.NAO_TENTADA,
        DESFECHO_LINHA.RECUSADA_NOSSA,
        DESFECHO_LINHA.RECUSADA_RECEITA,
      ].sort()
    );
  });

  it("⚠⚠ `EMITIDA` NUNCA — a nota existe no mundo", () => {
    expect(podeRetentar({ numeroLinha: 2, desfecho: DESFECHO_LINHA.EMITIDA })).toBe(false);
    expect(bloqueioDaRetentativa({ numeroLinha: 2, desfecho: DESFECHO_LINHA.EMITIDA })).toMatch(/duplicada/i);
  });

  it("⚠⚠ `INDETERMINADA` NUNCA — pode existir nota e ninguém sabe qual", () => {
    expect(podeRetentar({ numeroLinha: 2, desfecho: DESFECHO_LINHA.INDETERMINADA })).toBe(false);
    expect(bloqueioDaRetentativa({ numeroLinha: 2, desfecho: DESFECHO_LINHA.INDETERMINADA })).toMatch(/duplicada/i);
  });

  it("⚠ `enviando` também não — o envio não terminou", () => {
    expect(podeRetentar({ numeroLinha: 2, desfecho: DESFECHO_LINHA.ENVIANDO })).toBe(false);
  });

  it("⚠⚠ desfecho DESCONHECIDO não é retentável — a lista é de INCLUSÃO", () => {
    // Um estado novo no banco tem de entrar BLOQUEADO por construção. Se esta expectativa virar
    // `true` um dia, o que mudou foi a direção da lista — e aí um estado que ninguém analisou
    // passa a reemitir nota fiscal.
    expect(podeRetentar({ numeroLinha: 2, desfecho: "estado_que_ainda_nao_existe" })).toBe(false);
    expect(podeRetentar({ numeroLinha: 2, desfecho: undefined })).toBe(false);
  });

  it("⚠ a linha NOMEADA em `linhaIndeterminada` fica fora pelo NÚMERO, mesmo com desfecho retentável", () => {
    // Guarda redundante de propósito: é a única que continua valendo se o desfecho da linha e a
    // coluna do lote divergirem.
    const lote = { linhaIndeterminada: 4, linhas: [] };
    expect(podeRetentar({ numeroLinha: 4, desfecho: DESFECHO_LINHA.RECUSADA_RECEITA }, lote)).toBe(false);
    expect(podeRetentar({ numeroLinha: 5, desfecho: DESFECHO_LINHA.RECUSADA_RECEITA }, lote)).toBe(true);
  });

  it("⚠⚠ O CASO PARCIAL: 2 emitidas + 1 recusada ⇒ o plano tem UMA linha", () => {
    const plano = planoDeRetentativa({
      linhaIndeterminada: null,
      linhas: [
        { numeroLinha: 2, desfecho: DESFECHO_LINHA.EMITIDA },
        { numeroLinha: 3, desfecho: DESFECHO_LINHA.EMITIDA },
        { numeroLinha: 4, desfecho: DESFECHO_LINHA.RECUSADA_RECEITA },
      ],
    });
    expect(plano.quantas).toBe(1);
    expect(plano.retentaveis.map((l) => l.numeroLinha)).toEqual([4]);
    expect(plano.emitidas).toBe(2);
    expect(plano.bloqueadas.map((b) => b.numeroLinha)).toEqual([2, 3]);
    expect(plano.bloqueadas.every((b) => typeof b.motivo === "string" && b.motivo.length > 0)).toBe(true);
  });

  it("⚠⚠ o lote INTEIRAMENTE EMITIDO não tem nada a retentar — é a idempotência de sempre", () => {
    const plano = planoDeRetentativa({
      linhas: [
        { numeroLinha: 2, desfecho: DESFECHO_LINHA.EMITIDA },
        { numeroLinha: 3, desfecho: DESFECHO_LINHA.EMITIDA },
      ],
    });
    expect(plano.quantas).toBe(0);
    expect(plano.emitidas).toBe(2);
  });

  it("o lote do caso real — 3 recusadas, 0 emitidas — é inteiramente retentável", () => {
    const plano = planoDeRetentativa({
      linhas: [2, 3, 4].map((n) => ({ numeroLinha: n, desfecho: DESFECHO_LINHA.RECUSADA_RECEITA })),
    });
    expect(plano.quantas).toBe(3);
    expect(plano.bloqueadas).toEqual([]);
  });
});

describe("⚠⚠ o laço em MODO.RETENTATIVA", () => {
  it("⚠⚠ O CASO PARCIAL, DE PONTA A PONTA: reemite SÓ a recusada, e a emitida não é tocada", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 3);

    // 1ª passagem: linha 2 emite, linha 3 é RECUSADA pela Receita, linha 4 emite.
    const primeiro = jest.fn()
      .mockResolvedValueOnce(emitiuOk(2))
      .mockResolvedValueOnce({
        status: "rejected", camada: "RECEITA", codigo: "E1235",
        message: "erro de esquema", nfse: { id: "si-3", rpsSerie: "00001", rpsNumero: "3" },
      })
      .mockResolvedValueOnce(emitiuOk(4));
    await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir: primeiro });

    // 2ª passagem, agora RETENTATIVA.
    const segundo = jest.fn(async () => emitiuOk(3));
    const final = await processarLoteEmissao({
      prisma, loteId: lote.id, companyId: COMPANY, emitir: segundo, modo: MODO.RETENTATIVA,
    });

    // ⚠⚠ UMA chamada, e é a do tomador da linha recusada. Duas aqui seriam duas notas fiscais
    // duplicadas para tomadores que já as receberam.
    expect(segundo).toHaveBeenCalledTimes(1);
    expect(segundo.mock.calls[0][0].data.tomador.nome).toBe("TOMADOR 3");
    expect(final.emitidas).toBe(3);
    expect(final.recusadas).toBe(0);
  });

  it("⚠⚠ a linha EMITIDA não é reservada nem com o `updateMany` chamado direto no `where` do modo", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 2);
    await processarLoteEmissao({
      prisma, loteId: lote.id, companyId: COMPANY, emitir: jest.fn(async () => emitiuOk(1)),
    });

    // O conjunto de desfechos do modo é o `where` da reserva. Se `emitida` estivesse nele, esta
    // chamada marcaria as duas linhas como `enviando` — que é o passo anterior a reemitir.
    const tentativa = await prisma.loteEmissaoNfseLinha.updateMany({
      where: { loteId: lote.id, desfecho: { in: DESFECHOS_RETENTAVEIS } },
      data: { desfecho: DESFECHO_LINHA.ENVIANDO },
    });
    expect(tentativa.count).toBe(0);
  });

  it("⚠⚠ retentar um lote parado NÃO toca a linha indeterminada — e alcança a recusada ANTERIOR a ela", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 4); // linhas 2,3,4,5
    const primeiro = jest.fn()
      .mockResolvedValueOnce({
        status: "rejected", camada: "RECEITA", codigo: "E1235",
        message: "erro de esquema", nfse: { id: "si-2", rpsSerie: "00001", rpsNumero: "2" },
      })
      .mockResolvedValueOnce(emitiuOk(3))
      .mockResolvedValueOnce(transporte(4));
    await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir: primeiro });

    const parado = await prisma.loteEmissaoNfse.findUnique({ where: { id: lote.id } });
    expect(parado.linhaIndeterminada).toBe(4);

    const aRetentar = await selecionarParaRetomada({ prisma, lote: parado, modo: MODO.RETENTATIVA });
    // a 2 (recusada, ANTES da parada) e a 5 (nunca tentada) entram; a 3 (emitida) e a 4
    // (indeterminada) NÃO.
    expect(aRetentar.map((l) => l.numeroLinha)).toEqual([2, 5]);

    const segundo = jest.fn(async () => emitiuOk(9));
    const final = await processarLoteEmissao({
      prisma, loteId: lote.id, companyId: COMPANY, emitir: segundo, modo: MODO.RETENTATIVA,
    });
    expect(segundo.mock.calls.map((c) => c[0].data.tomador.nome)).toEqual(["TOMADOR 2", "TOMADOR 5"]);
    expect(final.linhas.find((l) => l.numeroLinha === 4).desfecho).toBe(DESFECHO_LINHA.INDETERMINADA);
  });

  it("⚠ o DEFAULT continua sendo a retomada — quem não passa `modo` não retenta recusada", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 1);
    await processarLoteEmissao({
      prisma, loteId: lote.id, companyId: COMPANY,
      emitir: jest.fn(async () => ({
        status: "rejected", camada: "RECEITA", codigo: "E1235", message: "x",
        nfse: { id: "si-2", rpsSerie: "00001", rpsNumero: "2" },
      })),
    });

    const segundo = jest.fn(async () => emitiuOk(2));
    await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir: segundo });
    expect(segundo).not.toHaveBeenCalled();
  });

  it("⚠ modo DESCONHECIDO cai no conjunto mais estreito, nunca no mais largo", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 1);
    await processarLoteEmissao({
      prisma, loteId: lote.id, companyId: COMPANY,
      emitir: jest.fn(async () => ({
        status: "rejected", camada: "RECEITA", codigo: "E1235", message: "x",
        nfse: { id: "si-2", rpsSerie: "00001", rpsNumero: "2" },
      })),
    });

    const segundo = jest.fn(async () => emitiuOk(2));
    await processarLoteEmissao({
      prisma, loteId: lote.id, companyId: COMPANY, emitir: segundo, modo: "retentativa_total",
    });
    expect(segundo).not.toHaveBeenCalled();
  });

  it("⚠⚠ a retentativa REUSA o número da tentativa anterior — número pulado é buraco permanente", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 1);
    await processarLoteEmissao({
      prisma, loteId: lote.id, companyId: COMPANY,
      emitir: jest.fn(async () => ({
        status: "rejected", camada: "RECEITA", codigo: "E1235", message: "x",
        nfse: { id: "si-antiga", rpsSerie: "00001", rpsNumero: "7" },
      })),
    });

    const segundo = jest.fn(async () => emitiuOk(2));
    await processarLoteEmissao({
      prisma, loteId: lote.id, companyId: COMPANY, emitir: segundo, modo: MODO.RETENTATIVA,
    });
    // Quem decide se aquele número pode voltar é `NfseService.issue` (ele recusa o reuso quando a
    // falha anterior foi de TRANSPORTE). O que se mede aqui é que o lote o OFERECE.
    expect(segundo.mock.calls[0][0].retryInvoiceId).toBe("si-antiga");
  });

  it("⚠ linha que nunca foi tentada não oferece número para reusar", async () => {
    const prisma = prismaFalso();
    const lote = await montar(prisma, 1);
    const emitir = jest.fn(async () => emitiuOk(2));
    await processarLoteEmissao({ prisma, loteId: lote.id, companyId: COMPANY, emitir });
    expect(emitir.mock.calls[0][0].retryInvoiceId).toBeNull();
  });
});
