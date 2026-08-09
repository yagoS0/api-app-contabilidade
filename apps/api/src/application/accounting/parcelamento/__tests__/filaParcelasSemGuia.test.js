// A FILA DA PRESTAÇÃO SEM GUIA — o critério de "entra na fila", travado como dado.
//
// ⚠ O QUE ESTE ARQUIVO PROTEGE não é a query: é a promessa de que NÃO existe uma terceira
// definição de atraso no módulo. `riscoRescisao.avaliarRiscoRescisao` tem a dela (`venc < agora`),
// `parcelaStateMachine.estadoEmAberto` tem a MESMA, e a fila reusa a segunda para rotular cada
// linha. O que a fila acrescenta é só a JANELA — quem vence hoje entra, e entra dizendo
// `VENCE_HOJE`, nunca "vencida".
//
// O teste compara os dois predicados lado a lado de propósito: se alguém mudar um deles, a
// divergência aparece aqui e não numa tela pintando atraso onde o card não pinta.

jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));

import {
  whereParcelaSemGuiaPendente,
  situacaoDaPrestacaoSemGuia,
  linhaDaFilaSemGuia,
  fimDoDiaDe,
  SELECT_PARCELA_FILA_SEM_GUIA,
  SELECT_PARCELA_PARA_QUADRO,
} from "../recalculoParcelamento.js";
import { estadoEmAberto, PARCELA_ESTADOS } from "../parcelaStateMachine.js";
import { avaliarRiscoRescisao } from "../riscoRescisao.js";

const AGORA = new Date("2026-08-09T15:00:00.000Z");
const dias = (n) => new Date(AGORA.getTime() + n * 24 * 60 * 60 * 1000);

describe("whereParcelaSemGuiaPendente — as três condições, e de onde vêm", () => {
  it("exige SEM GUIA — é a pré-condição da própria baixa por declaração", () => {
    // `gerarPagamentoParcelaManual` recusa com `parcela_tem_guia`; listar prestação com guia aqui
    // seria oferecer o botão que o servidor recusa, e apontar a fila errada ao contador.
    expect(whereParcelaSemGuiaPendente({ agora: AGORA }).guiaId).toBeNull();
  });

  it("exige NÃO QUITADA pela mesma coluna que a baixa reserva", () => {
    // `parcelaRowQuitada` só pergunta se há `origemBaixa`. Nulo cobre MANUAL, DEBITO_AUTOMATICO e
    // HISTORICO de uma vez — sem enumerar valores que a próxima via acrescentaria.
    expect(whereParcelaSemGuiaPendente({ agora: AGORA }).origemBaixa).toBeNull();
  });

  it("a janela vai até o FIM DO DIA de hoje — quem vence hoje entra", () => {
    const w = whereParcelaSemGuiaPendente({ agora: AGORA });
    expect(w.vencimento.lte).toEqual(fimDoDiaDe(AGORA));
    expect(w.vencimento.not).toBeNull(); // sem data não se afirma que venceu
  });

  it("prestação FUTURA fica fora — 'ainda não devida' não é 'não paga'", () => {
    const limite = whereParcelaSemGuiaPendente({ agora: AGORA }).vencimento.lte;
    expect(dias(1).getTime()).toBeGreaterThan(limite.getTime());
    expect(dias(-1).getTime()).toBeLessThan(limite.getTime());
  });

  it("parcelamento RESCINDIDO fica fora — mesma decisão de quadroDasParcelas", () => {
    expect(whereParcelaSemGuiaPendente({ agora: AGORA }).parcelamento)
      .toEqual({ is: { status: { not: "RESCINDIDO" } } });
  });

  it("filtra por empresa (isolamento multi-tenant)", () => {
    expect(whereParcelaSemGuiaPendente({ portalClientId: "c1", agora: AGORA }).portalClientId).toBe("c1");
  });
});

describe("o rótulo da linha NÃO é uma terceira definição de atraso", () => {
  it("VENCIDA sai do MESMO predicado da máquina de estados", () => {
    const venc = dias(-10);
    expect(estadoEmAberto(venc, AGORA)).toBe(PARCELA_ESTADOS.EM_ATRASO);
    expect(situacaoDaPrestacaoSemGuia({ vencimento: venc }, AGORA)).toBe("VENCIDA");
  });

  it("e concorda com o que `avaliarRiscoRescisao` conta como em atraso", () => {
    const venc = dias(-10);
    const risco = avaliarRiscoRescisao({
      parcelas: [{ numeroParcela: 1, vencimento: venc, quitada: false }],
      agora: AGORA,
    });
    expect(risco.emAtraso).toBe(1);
    expect(situacaoDaPrestacaoSemGuia({ vencimento: venc }, AGORA)).toBe("VENCIDA");
  });

  it("quem vence HOJE entra na fila SEM ser chamada de vencida", () => {
    // A janela a inclui (é o débito que sai hoje da conta), mas o rótulo continua o da máquina —
    // e a máquina não a chama de EM_ATRASO enquanto o vencimento não passou.
    const hojeMaisTarde = new Date(AGORA.getTime() + 60 * 60 * 1000);
    expect(hojeMaisTarde.getTime()).toBeLessThan(fimDoDiaDe(AGORA).getTime());
    expect(situacaoDaPrestacaoSemGuia({ vencimento: hojeMaisTarde }, AGORA)).toBe("VENCE_HOJE");
  });
});

describe("a linha devolvida basta para renderizar — sem N+1 contra o contrato", () => {
  const parcela = {
    id: "p-23", numeroParcela: 23, competencia: "2026-07", vencimento: dias(-20),
    valorPrevisto: 633.96, origemBaixa: null, guia: null, parcelamentoId: "parc-1",
    parcelamento: {
      id: "parc-1", label: "OUTRO 2026 — migrado", tipo: "OUTRO", kind: "OUTRO",
      numParcelas: 60, numeroParcelamento: "3", formaPagamento: "DEBITO_AUTOMATICO",
      status: "ATIVO", aberturaEntryId: "e-abertura",
    },
  };

  it("traz prestação, competência, valor e contrato numa resposta só", () => {
    const l = linhaDaFilaSemGuia(parcela, AGORA);
    expect(l).toMatchObject({
      parcelaId: "p-23", numeroParcela: 23, competencia: "2026-07", valorPrevisto: 633.96,
      situacao: "VENCIDA", parcelamentoId: "parc-1", podeBaixar: true, motivoBloqueio: null,
    });
    expect(l.parcelamento).toMatchObject({
      label: "OUTRO 2026 — migrado", numParcelas: 60, formaPagamento: "DEBITO_AUTOMATICO",
      temProvisaoDeAbertura: true,
    });
  });

  it("sem provisão de abertura: bloqueia COM O MOTIVO, antes de o contador preencher nada", () => {
    const l = linhaDaFilaSemGuia(
      { ...parcela, parcelamento: { ...parcela.parcelamento, aberturaEntryId: null } }, AGORA,
    );
    expect(l.podeBaixar).toBe(false);
    // O mesmo código que a rota de baixa devolveria — a tela tem uma tradução só.
    expect(l.motivoBloqueio).toBe("provisao_inexistente");
  });

  it("sem valorPrevisto: bloqueia COM O MOTIVO — não se inventa o principal", () => {
    const l = linhaDaFilaSemGuia({ ...parcela, valorPrevisto: null }, AGORA);
    expect(l.podeBaixar).toBe(false);
    expect(l.motivoBloqueio).toBe("sem_valor_previsto");
    expect(l.valorPrevisto).toBeNull();
  });

  // ⚠ A linha bloqueada NÃO some da fila. Ausência nunca é resposta: a prestação ESTÁ vencida e sem
  // baixa, e escondê-la faria o contrato parecer em ordem justamente onde ele não está.
  it("linha bloqueada continua na fila, só não é clicável", () => {
    const l = linhaDaFilaSemGuia({ ...parcela, valorPrevisto: null }, AGORA);
    expect(l.parcelaId).toBe("p-23");
    expect(l.situacao).toBe("VENCIDA");
  });
});

describe("o select é o mesmo das outras derivações", () => {
  it("a fila ESTENDE `SELECT_PARCELA_PARA_QUADRO`, não o reescreve", () => {
    for (const campo of Object.keys(SELECT_PARCELA_PARA_QUADRO)) {
      expect(SELECT_PARCELA_FILA_SEM_GUIA[campo]).toEqual(SELECT_PARCELA_PARA_QUADRO[campo]);
    }
  });

  // ⚠ Os dois campos que a fase acrescentou ao select compartilhado. `competencia` já tinha mordido
  // uma vez (o modal de anexo nascia com o campo vazio porque ela não era selecionada).
  it("`competencia` e `valorPrevisto` saem do select COMPARTILHADO", () => {
    expect(SELECT_PARCELA_PARA_QUADRO.competencia).toBe(true);
    expect(SELECT_PARCELA_PARA_QUADRO.valorPrevisto).toBe(true);
  });
});
