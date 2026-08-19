// A RECUSA DA LEITURA — a mensagem do servidor vence, e o ajuste recusado não apaga a planilha.

import { RECUSA, ehRecusaDeAjuste, lerRecusaDaPlanilha } from "../recusaDaPlanilha";

function erro(code, message) {
  const e = new Error(message);
  e.code = code;
  e.message = message;
  return e;
}

describe("a mensagem do servidor vence", () => {
  test("o texto é o do servidor, com os dados do caso", () => {
    const r = lerRecusaDaPlanilha(
      erro(RECUSA.COLUNAS_FALTANDO, "Faltam colunas obrigatórias nesta planilha: Valor do serviço (R$).")
    );
    expect(r.titulo).toBe("Faltam colunas obrigatórias.");
    expect(r.texto).toContain("Valor do serviço");
  });

  test("⚠ código desconhecido NÃO ganha procedimento fabricado", () => {
    const r = lerRecusaDaPlanilha(erro("planilha_coisa_nova", "O servidor disse isto."));
    expect(r.texto).toBe("O servidor disse isto.");
    expect(r.titulo).toBe("Não conseguimos ler esta planilha.");
  });

  test("sem mensagem, a frase de reserva aponta o caminho que sempre existe", () => {
    const r = lerRecusaDaPlanilha(erro(RECUSA.ILEGIVEL, ""));
    expect(r.texto).toMatch(/Baixe o modelo/);
  });

  test("erro sem código nenhum não quebra", () => {
    expect(lerRecusaDaPlanilha(null).codigo).toBeNull();
    expect(lerRecusaDaPlanilha(undefined).titulo).toBe("Não conseguimos ler esta planilha.");
  });
});

describe("⚠⚠ a recusa do AJUSTE é de outra natureza", () => {
  test.each([[RECUSA.AJUSTE_FORMA], [RECUSA.AJUSTE_LINHA], [RECUSA.AJUSTE_COLUNA]])(
    "`%s` é reconhecida como recusa de ajuste",
    (codigo) => {
      expect(ehRecusaDeAjuste(codigo)).toBe(true);
      expect(lerRecusaDaPlanilha(erro(codigo, "x")).deAjuste).toBe(true);
    }
  );

  test("recusa de planilha NÃO é recusa de ajuste — a tela descarta a leitura só nesse caso", () => {
    expect(ehRecusaDeAjuste(RECUSA.SEM_CABECALHO)).toBe(false);
    expect(lerRecusaDaPlanilha(erro(RECUSA.SEM_CABECALHO, "x")).deAjuste).toBe(false);
  });

  test("⚠ os três títulos dizem que NADA FOI APLICADO", () => {
    for (const codigo of [RECUSA.AJUSTE_FORMA, RECUSA.AJUSTE_LINHA, RECUSA.AJUSTE_COLUNA]) {
      expect(lerRecusaDaPlanilha(erro(codigo, "x")).titulo).toMatch(/não foi aplicado/i);
    }
  });
});
