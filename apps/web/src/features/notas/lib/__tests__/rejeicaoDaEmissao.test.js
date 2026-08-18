// A LEITURA DA RECUSA — o que a tela diz depois do "não".
//
// ⚠ O caso que sustenta o arquivo é o ÚLTIMO: falha de transporte não é "deu erro, tente de novo".
// É "não se sabe se a nota saiu", e reemitir ali duplica nota fiscal.

import { CAMPO, lerRejeicao } from "../rejeicaoDaEmissao";

describe("os dois formatos de erro — real e mock", () => {
  it("no REAL o código vem carimbado e o corpo inteiro viaja em `payload`", () => {
    const erro = Object.assign(new Error("mensagem humana"), {
      code: "servico_valor_invalido",
      status: 400,
      payload: { error: "servico_valor_invalido" },
    });
    const r = lerRejeicao(erro);
    expect(r.campo).toBe(CAMPO.VALOR);
    expect(r.oQueFazer).toMatch(/maior que zero/);
    expect(r.reconhecida).toBe(true);
  });

  it("no MOCK a MENSAGEM é o código, e ela é lida igual", () => {
    const r = lerRejeicao(new Error("nfse_iss_retido_sem_aliquota"));
    expect(r.campo).toBe(CAMPO.ALIQUOTA);
    expect(r.oQueFazer).toMatch(/alíquota/);
  });
});

describe("a `correcao` do servidor VENCE o texto local", () => {
  it("quando o backend diz o que fazer, é ele que fala", () => {
    const erro = Object.assign(new Error("x"), {
      code: "servico_valor_invalido",
      payload: { error: "servico_valor_invalido", correcao: "Confira o contrato: o valor combinado é outro." },
    });
    expect(lerRejeicao(erro).oQueFazer).toBe("Confira o contrato: o valor combinado é outro.");
  });

  it("recusa fiscal da prefeitura não ganha texto nosso — o motivo é do provedor", () => {
    const erro = Object.assign(new Error("rejeitada"), {
      code: "nfse_rejected",
      payload: {
        error: "nfse_rejected", camada: "RECEITA", codigo: "E0625",
        message: "Alíquota inválida", correcao: "Informe a alíquota do município.",
      },
    });
    const r = lerRejeicao(erro);
    expect(r.mensagem).toBe("Alíquota inválida");
    expect(r.codigoDoProvedor).toBe("E0625");
    expect(r.oQueFazer).toBe("Informe a alíquota do município.");
    expect(r.podeTentarDeNovo).toBe(true);
  });
});

describe("a lista `missing` do cadastro chega inteira", () => {
  it("os nomes de coluna que o servidor apontou não se perdem", () => {
    const erro = Object.assign(new Error("company_missing_fields"), {
      code: "company_missing_fields",
      payload: { error: "company_missing_fields", missing: ["codigoServicoNacional", "rpsSerie"] },
    });
    const r = lerRejeicao(erro);
    expect(r.camposDoCadastro).toEqual(["codigoServicoNacional", "rpsSerie"]);
    expect(r.oQueFazer).toMatch(/Editar cadastro/);
    // Não se resolve nesta tela: não há campo para onde levar.
    expect(r.campo).toBeNull();
  });
});

describe("⚠⚠ desfecho DESCONHECIDO — a recusa que não pode virar 'tente de novo'", () => {
  it("falha de TRANSPORTE proíbe a retentativa", () => {
    const erro = Object.assign(new Error("timeout"), {
      code: "nfse_falha_transporte",
      payload: { error: "nfse_falha_transporte", camada: "TRANSPORTE", message: "timeout" },
    });
    const r = lerRejeicao(erro);
    expect(r.desfechoDesconhecido).toBe(true);
    expect(r.podeTentarDeNovo).toBe(false);
    expect(r.oQueFazer).toMatch(/consulte/i);
  });

  it("número em estado indeterminado idem — duplicar a nota é o risco", () => {
    const r = lerRejeicao(new Error("nfse_numero_em_estado_indeterminado"));
    expect(r.podeTentarDeNovo).toBe(false);
    expect(r.oQueFazer).toMatch(/duplicar/);
  });

  it("a camada TRANSPORTE trava mesmo com um código que a tela nunca viu", () => {
    const erro = Object.assign(new Error("???"), {
      code: "codigo_novo_do_futuro",
      payload: { error: "codigo_novo_do_futuro", camada: "TRANSPORTE" },
    });
    expect(lerRejeicao(erro).podeTentarDeNovo).toBe(false);
  });
});

describe("o que a tela NÃO sabe, ela não inventa", () => {
  it("código desconhecido não recebe procedimento sugerido", () => {
    const r = lerRejeicao(new Error("algo_que_ninguem_mapeou"));
    expect(r.oQueFazer).toBeNull();
    expect(r.campo).toBeNull();
    expect(r.reconhecida).toBe(false);
    // …mas a mensagem do servidor não se perde.
    expect(r.mensagem).toBe("algo_que_ninguem_mapeou");
    // E corrigir-e-tentar continua permitido: nada aqui diz que o desfecho é desconhecido.
    expect(r.podeTentarDeNovo).toBe(true);
  });

  it("erro sem mensagem nenhuma ainda diz alguma coisa", () => {
    expect(lerRejeicao(null).mensagem).toMatch(/Não foi possível emitir/);
  });
});
