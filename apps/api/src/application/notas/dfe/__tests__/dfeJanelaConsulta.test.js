// A JANELA DE 1 HORA DA SEFAZ, PROVADA POR NÃO-CHAMADA.
//
// ⚠ O CASO REAL. O dono clicou em "Buscar NF-e" numa empresa e levou `[CONSUMO_INDEVIDO] cStat=656`
// — no PRIMEIRO clique do dia. A "outra aplicação consultando o mesmo CNPJ" que a mensagem sugeria
// éramos NÓS: o worker (`workers/dfeNotasWorker.js`) já tinha consultado aquele CNPJ na hora, e a
// espera de 1 h da NT 2014.002 é disparada pelo cStat 137 — que é exatamente onde o laço de
// `syncDfeForCompany` PARA. Toda execução bem-sucedida do worker fecha a janela sozinha.
//
// Três caminhos consultam a distribuição DFe (worker, lote e o botão por empresa) e só dois
// respeitavam o intervalo; o botão chamava `syncDfeForCompany` direto. Agora a regra mora DENTRO do
// serviço e quem chama herda — mesma disciplina de `fechamentoBlockers` e `guideContract`.
//
// ⚠ POR QUE MEDIR POR NÃO-CHAMADA (molde de `routes/__tests__/portaoEmissaoNfse.test.js`): o estrago
// é a consulta EM SI. Uma consulta indevida bloqueia o CNPJ por 1 hora e o 656 grava backoff de
// 60 min, que derruba o worker junto. Só olhando se `fetchDistNSU` foi chamado dá para provar que
// nada saiu da máquina. "Clicar duas vezes" nunca foi o cenário — o primeiro clique já bastava.

const agora = Date.now();
const min = (n) => new Date(agora - n * 60000);
const dias = (n) => new Date(agora - n * 24 * 60 * 60000);

const cenario = {
  syncState: null,
  respostaDaSefaz: { cStat: "137", xMotivo: "Nenhum documento localizado", ultNSU: 0n, maxNSU: 0n, docs: [], error: false },
};

jest.mock("../../../../config.js", () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  // ⚠ A MESMA constante do worker. Um `60` escrito à mão aqui criaria uma segunda janela para a
  // mesma regra externa — que é o jeito de reabrir o bloqueio que as duas tentam evitar.
  DFE_NOTAS_WORKER_INTERVAL_MIN: 60,
}));

jest.mock("../../../../infrastructure/db/prisma.js", () => {
  const prisma = {
    portalClient: {
      findUnique: jest.fn(async () => ({
        id: "p1", razao: "VAGALO LTDA", cnpj: "11222333000181", uf: "RJ", status: "ATIVA",
      })),
    },
    portalSyncState: {
      findUnique: jest.fn(),
      upsert: jest.fn(async () => ({})),
    },
    companyMonthlyCircular: { findFirst: jest.fn(async () => null) },
    $transaction: jest.fn(async (arg) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg))),
  };
  return { prisma };
});

jest.mock("../../CertResolver.js", () => ({
  SERVICOS: { DFE: "DFE", NFSE: "NFSE" },
  resolveCertForCompany: jest.fn(async () => ({
    source: "company_a1", pfxBuffer: Buffer.from("pfx-falso"), password: "1234",
  })),
}));

// ⚠ O CLIENTE HTTP DA SEFAZ É MOCK EM TODOS OS CASOS. Nenhum teste pode consultar a distribuição
// DFe de verdade: cada consulta indevida bloqueia o CNPJ por 1 hora — é o defeito, não o teste.
jest.mock("../DfeClient.js", () => {
  class DfeClientError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  return {
    DfeClientError,
    fetchDistNSU: jest.fn(async () => ({ status: 200, xml: "<xml-falso/>" })),
  };
});

jest.mock("../DfeParser.js", () => ({
  parseDistDFeResponse: jest.fn(() => cenario.respostaDaSefaz),
  parseDocZip: jest.fn(() => ({ type: "unknown" })),
}));

import { prisma } from "../../../../infrastructure/db/prisma.js";
import { fetchDistNSU } from "../DfeClient.js";
import { syncDfeForCompany, avaliarJanelaDfe, explicar656, DFE_INTERVALO_MIN } from "../DfeSyncService.js";

beforeEach(() => {
  jest.clearAllMocks();
  cenario.syncState = null;
  cenario.respostaDaSefaz = { cStat: "137", xMotivo: "Nenhum documento localizado", ultNSU: 0n, maxNSU: 0n, docs: [], error: false };
  prisma.portalSyncState.findUnique.mockImplementation(async () => cenario.syncState);
});

describe("a janela de 1 hora mora dentro de syncDfeForCompany", () => {
  test("⚠ CASO REAL: worker consultou há 20 min e o contador dá o PRIMEIRO clique — recusa nossa, e nada sai para a SEFAZ", async () => {
    cenario.syncState = {
      clientId: "p1",
      dfeLastAttemptAt: min(20),   // o worker olhou há 20 min
      dfeLastSyncAt: min(20),
      dfeNsuCursor: 900n,
    };

    const r = await syncDfeForCompany({ portalClientId: "p1" });

    // O que prova o conserto: a consulta NÃO ACONTECEU.
    expect(fetchDistNSU).not.toHaveBeenCalled();

    expect(r.ok).toBe(false);
    expect(r.reason).toBe("DFE_INTERVALO_NAO_CUMPRIDO");
    expect(r.minutosDesdeUltima).toBe(20);
    expect(new Date(r.proximaConsultaEm).getTime()).toBe(new Date(cenario.syncState.dfeLastAttemptAt).getTime() + 60 * 60000);
    // A recusa é NOSSA: não grava backoff (derrubaria o worker junto) nem marca tentativa.
    expect(prisma.portalSyncState.upsert).not.toHaveBeenCalled();
  });

  test("⚠ SEM ESCAPE: a janela é regra EXTERNA — nenhuma opção de forçar a fura", async () => {
    cenario.syncState = { clientId: "p1", dfeLastAttemptAt: min(5), dfeNsuCursor: 0n };

    const r = await syncDfeForCompany({ portalClientId: "p1", forcar: true, force: true, podeForcar: true });

    expect(fetchDistNSU).not.toHaveBeenCalled();
    expect(r.reason).toBe("DFE_INTERVALO_NAO_CUMPRIDO");
  });

  test("empresa nunca consultada passa na primeira — sem linha em PortalSyncState não há dfeLastAttemptAt", async () => {
    cenario.syncState = null;

    const r = await syncDfeForCompany({ portalClientId: "p1" });

    expect(fetchDistNSU).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
  });

  test("⚠ 'OLHEI' e não 'RECEBI': dfeLastSyncAt de 30 dias com dfeLastAttemptAt de 10 min BARRA", async () => {
    // Empresa quieta: faz 30 dias que não CHEGA documento, mas nós OLHAMOS há 10 min. Ler
    // `dfeLastSyncAt` como relógio foi o defeito que custou 29 dias no ADN — aqui ele soltaria a
    // consulta que a SEFAZ recusa.
    cenario.syncState = { clientId: "p1", dfeLastSyncAt: dias(30), dfeLastAttemptAt: min(10), dfeNsuCursor: 900n };

    const r = await syncDfeForCompany({ portalClientId: "p1" });

    expect(fetchDistNSU).not.toHaveBeenCalled();
    expect(r.reason).toBe("DFE_INTERVALO_NAO_CUMPRIDO");
  });

  test("⚠ O WORKER CONTINUA RODANDO: passado o ciclo dele (61 min desde a tentativa), a guarda deixa passar", async () => {
    // Se a guarda nova fosse mais estreita que a do worker, ela viraria uma regressão silenciosa:
    // a captura automática pararia de trazer notas sem ninguém perceber (já aconteceu, 29 dias).
    cenario.syncState = { clientId: "p1", dfeLastAttemptAt: min(61), dfeLastSyncAt: dias(30), dfeNsuCursor: 900n };

    const r = await syncDfeForCompany({ portalClientId: "p1" });

    expect(fetchDistNSU).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
  });

  test("o backoff continua sendo checado antes da janela", async () => {
    cenario.syncState = { clientId: "p1", dfeBackoffUntil: new Date(agora + 30 * 60000), dfeLastAttemptAt: min(90) };

    const r = await syncDfeForCompany({ portalClientId: "p1" });

    expect(fetchDistNSU).not.toHaveBeenCalled();
    expect(r.reason).toBe("backoff_active");
  });

  test("a janela usa a constante do worker, não um 60 solto", () => {
    expect(DFE_INTERVALO_MIN).toBe(60);
    const j = avaliarJanelaDfe({ dfeLastAttemptAt: min(20) });
    expect(j.intervaloMin).toBe(DFE_INTERVALO_MIN);
    expect(j.podeConsultarAgora).toBe(false);
    expect(j.minutosRestantes).toBe(40);
    expect(avaliarJanelaDfe(null).podeConsultarAgora).toBe(true);
    expect(avaliarJanelaDfe({}).podeConsultarAgora).toBe(true);
  });
});

describe("a mensagem do 656 diz o FATO, não o palpite", () => {
  test("nossa última tentativa recente ⇒ o texto aponta para NÓS e cita os minutos", () => {
    const texto = explicar656(min(20));
    expect(texto).toMatch(/este sistema consultou este CNPJ há 20 min/i);
    expect(texto).toMatch(/60 min/);
    // Nada de mandar o contador caçar culpado externo quando o culpado é o nosso worker.
    expect(texto).not.toMatch(/outra aplicação/i);
  });

  test("nossa última tentativa fora da janela ⇒ a outra aplicação vira HIPÓTESE, dita como hipótese", () => {
    const texto = explicar656(min(200));
    expect(texto).toMatch(/PODE ser outra aplicação/);
    expect(texto).toMatch(/há 200 min/);
  });

  test("sem registro nosso ⇒ diz que não há registro, e só então levanta a hipótese", () => {
    const texto = explicar656(null);
    expect(texto).toMatch(/não há registro de consulta nossa/i);
  });

  test("o 656 devolvido pela SEFAZ carrega a explicação (e não a frase antiga)", async () => {
    cenario.syncState = { clientId: "p1", dfeLastAttemptAt: min(200), dfeNsuCursor: 900n };
    cenario.respostaDaSefaz = { cStat: "656", xMotivo: "Rejeicao: Consumo Indevido", ultNSU: 0n, maxNSU: 0n, docs: [], error: true };

    const r = await syncDfeForCompany({ portalClientId: "p1" });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe("CONSUMO_INDEVIDO");
    expect(r.message).toMatch(/cStat=656/);
    expect(r.message).toMatch(/PODE ser outra aplicação/);
    expect(r.message).not.toMatch(/aguarde 1h\)$/);
  });
});
