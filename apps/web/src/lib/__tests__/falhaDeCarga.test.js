// A REGRA das três respostas — não a tela (as telas têm teste próprio, e cobrem a ligação).
//
// O que se trava aqui: `null` (não houve falha) é distinto de falha, e falha por 403 é distinta de
// falha por qualquer outro motivo. Foi o colapso dessas três em uma que fez cinco telas
// desenharem "0" no lugar de "não sei".

import { lerFalhaDeCarga, SEM_RESPOSTA } from "../falhaDeCarga";

describe("lerFalhaDeCarga — ausência de falha é ausência de resposta, não falha", () => {
  it.each([[null], [undefined], [""], [0]])("%p não é falha", (entrada) => {
    expect(lerFalhaDeCarga(entrada)).toBeNull();
  });
});

describe("lerFalhaDeCarga — NÃO CARREGOU", () => {
  it("a mensagem do servidor é o motivo, sem reescrita", () => {
    const f = lerFalhaDeCarga(new Error("banco indisponível"), { assunto: "as obrigações" });
    expect(f.semAcesso).toBe(false);
    expect(f.titulo).toBe("Não foi possível carregar as obrigações");
    expect(f.motivo).toBe("banco indisponível");
  });

  it("sem assunto, o título não inventa complemento", () => {
    expect(lerFalhaDeCarga(new Error("falhou")).titulo).toBe("Não foi possível carregar");
  });

  it("⚠ falha de AÇÃO não é falha de carga — o verbo diz o que se tentou fazer", () => {
    const f = lerFalhaDeCarga(new Error("500"), { verbo: "excluir", assunto: "a função" });
    expect(f.titulo).toBe("Não foi possível excluir a função");
  });

  it("⚠ mensagem SEM espaço é código, não explicação — e não vai crua para a tela", () => {
    const f = lerFalhaDeCarga(new Error("serpro_pagtoweb_disabled"));
    expect(f.motivo).toContain("serpro_pagtoweb_disabled");
    expect(f.motivo).toMatch(/sem explicação/);
  });

  it("erro sem mensagem nenhuma ainda diz alguma coisa", () => {
    expect(lerFalhaDeCarga({ status: 500 }).motivo).toMatch(/não respondeu/);
  });

  it("aceita corpo `{ ok:false, error, message }` além de Error", () => {
    const f = lerFalhaDeCarga({ ok: false, error: "regra_nao_encontrada", message: "Regra não encontrada." });
    expect(f.code).toBe("REGRA_NAO_ENCONTRADA");
    expect(f.motivo).toBe("Regra não encontrada.");
  });

  it("aceita string crua", () => {
    expect(lerFalhaDeCarga("deu ruim aqui").motivo).toBe("deu ruim aqui");
  });
});

describe("lerFalhaDeCarga — VOCÊ NÃO TEM ACESSO é a TERCEIRA resposta", () => {
  it("403 não é 'não carregou': a lista existe, quem não a vê é você", () => {
    const err = Object.assign(new Error("forbidden"), { status: 403, code: "forbidden" });
    const f = lerFalhaDeCarga(err, { assunto: "as obrigações" });
    expect(f.semAcesso).toBe(true);
    expect(f.titulo).toBe("Você não tem acesso a estes dados");
    expect(f.titulo).not.toMatch(/Não foi possível carregar/);
    expect(f.motivo).toMatch(/administrador/);
  });

  it("401 cai no mesmo ramo", () => {
    expect(lerFalhaDeCarga({ status: 401 }).semAcesso).toBe(true);
  });

  it.each(["insufficient_role", "scope_required", "forbidden"])(
    "o código %s do backend basta, mesmo sem status",
    (code) => {
      expect(lerFalhaDeCarga({ code }).semAcesso).toBe(true);
    },
  );

  it("⚠ código de outra recusa NÃO vira falta de acesso", () => {
    expect(lerFalhaDeCarga({ code: "mes_fechado", status: 409 }).semAcesso).toBe(false);
  });

  it("mensagem humana do servidor vence o texto padrão", () => {
    const err = Object.assign(new Error("Seu perfil não alcança esta empresa."), { status: 403 });
    expect(lerFalhaDeCarga(err).motivo).toBe("Seu perfil não alcança esta empresa.");
  });
});

it("o glifo do lugar do número é um só", () => {
  expect(SEM_RESPOSTA).toBe("—");
});
