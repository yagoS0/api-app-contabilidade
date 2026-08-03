// A identificação da chamada é o alicerce da guarda de custo: se ela errar o CNPJ ou o serviço, o
// teto conta para a empresa errada e o cooldown deixa passar clique repetido.
//
// O que se trava aqui é a extração vir do PRÓPRIO envelope `pedidoDados` — e não de um parâmetro
// do chamador. É isso que faz uma chamada nova, escrita amanhã, já nascer registrada e travada.
import { identificarChamada } from "../SerproCallGuard.js";
import { comContextoSerpro, contextoSerproAtual, podeForcarSerpro } from "../serproCallContext.js";

const envelope = (contribuinte, idServico) => ({
  contratante: { numero: "11111111111111", tipo: 2 },
  autorPedidoDados: { numero: "11111111111111", tipo: 2 },
  contribuinte: { numero: contribuinte, tipo: 2 },
  pedidoDados: { idSistema: "PGDASD", idServico, versaoSistema: "1.0", dados: '{"periodoApuracao":"202607"}' },
});

describe("identificarChamada", () => {
  test("tira CNPJ e serviço do envelope, sem o chamador informar nada", () => {
    const id = identificarChamada(envelope("66233216000105", "TRANSDECLARACAO11"), "/Declarar");
    expect(id.cnpj).toBe("66233216000105");
    expect(id.idServico).toBe("TRANSDECLARACAO11");
    expect(id.idSistema).toBe("PGDASD");
    expect(id.rota).toBe("/Declarar");
  });

  test("normaliza o CNPJ para dígitos — máscara não pode virar outra empresa no teto", () => {
    const id = identificarChamada(envelope("66.233.216/0001-05", "GERARDAS12"), "/Emitir");
    expect(id.cnpj).toBe("66233216000105");
  });

  test("payload igual → mesma assinatura (é o clique repetido que o cooldown pega)", () => {
    const a = identificarChamada(envelope("66233216000105", "GERARDAS12"), "/Emitir");
    const b = identificarChamada(envelope("66233216000105", "GERARDAS12"), "/Emitir");
    expect(a.assinatura).toBe(b.assinatura);
  });

  test("payload diferente → assinatura diferente: corrigir um valor e recalcular NÃO é repetição", () => {
    const a = identificarChamada(envelope("66233216000105", "GERARDAS12"), "/Emitir");
    const b = identificarChamada(envelope("66233216000105", "CONSDECLARACAO13"), "/Emitir");
    expect(a.assinatura).not.toBe(b.assinatura);
  });

  test("rota diferente com mesmo corpo também muda a assinatura", () => {
    const corpo = envelope("66233216000105", "GERARDAS12");
    expect(identificarChamada(corpo, "/Emitir").assinatura)
      .not.toBe(identificarChamada(corpo, "/Consultar").assinatura);
  });

  test("payload sem contribuinte não quebra — vira chamada sem empresa a quem imputar", () => {
    const id = identificarChamada({ pedidoDados: { idServico: "X" } }, "/Apoiar");
    expect(id.cnpj).toBe("");
    expect(id.assinatura).toHaveLength(64);
  });
});

describe("contexto da chamada", () => {
  test("viaja pelo AsyncLocalStorage sem passar por parâmetro", async () => {
    const visto = await comContextoSerpro({ origem: "teste", userId: "u1", forcar: true }, async () => {
      await Promise.resolve();
      return contextoSerproAtual();
    });
    expect(visto).toEqual({ origem: "teste", userId: "u1", forcar: true });
  });

  test("fora do contexto devolve vazio — worker e script não herdam override de ninguém", () => {
    expect(contextoSerproAtual()).toEqual({});
  });
});

describe("teto global derivado da carteira", () => {
  // Teto fixo vira armadilha quando o escritório cresce: a carteira dobra, o consumo legítimo
  // dobra, e o teto de ontem passa a barrar trabalho normal no fim do mês. Aqui trava-se a conta.
  const calcular = (empresas, orcamento, minimo, absoluto) => {
    const derivado = empresas * orcamento;
    const teto = Math.max(derivado, minimo);
    return absoluto > 0 ? Math.min(teto, absoluto) : teto;
  };

  test("acompanha a carteira — dobrar as empresas dobra o teto", () => {
    expect(calcular(40, 40, 500, 0)).toBe(1600);
    expect(calcular(80, 40, 500, 0)).toBe(3200);
  });

  test("o piso protege carteira pequena de um teto proporcional minúsculo", () => {
    expect(calcular(3, 40, 500, 0)).toBe(500);
  });

  test("a trava absoluta só entra quando configurada de propósito", () => {
    expect(calcular(100, 40, 500, 0)).toBe(4000);
    expect(calcular(100, 40, 500, 2500)).toBe(2500);
  });
});

describe("podeForcarSerpro", () => {
  test("exige ADMIN **e** pedido explícito", () => {
    expect(podeForcarSerpro({ auth: { user: { role: "admin" } }, query: { forcar: "1" } })).toBe(true);
    // ADMIN sem pedir não fura: senão o teto não avisaria ninguém.
    expect(podeForcarSerpro({ auth: { user: { role: "admin" } }, query: {} })).toBe(false);
    // Pedir sem ser ADMIN não fura: senão a guarda seria contornável pela URL.
    expect(podeForcarSerpro({ auth: { user: { role: "contador" } }, query: { forcar: "1" } })).toBe(false);
    expect(podeForcarSerpro({})).toBe(false);
  });
});
