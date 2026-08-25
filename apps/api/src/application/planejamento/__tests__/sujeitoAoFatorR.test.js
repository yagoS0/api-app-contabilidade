// ⚠⚠ O FATOR R DECIDE ANEXO III OU V — e o `false` do cadastro não é resposta.
//
// Defeito relatado pelo dono (25/08/2026): o Perfil fiscal da LENTE mostrava os dois CNAEs como
// "III ou V (Fator R) — sim" e o Planejamento da MESMA empresa exibia o checkbox DESMARCADO, com o
// anexo travado em III. Custo estimado com os números dela (RBT12 ~718 mil): III ≈ 11,04% contra
// V ≈ 17,6% — cerca de 6,6 pontos de alíquota efetiva.

import { sujeitoAoFatorR, RESPOSTA, ORIGEM } from "../lib/sujeitoAoFatorR.js";

const atv = (over = {}) => ({ cnae: "7319003", sujeitoFatorR: false, ativo: true, impeditivo: false, ...over });
const DE_FATOR_R = atv({ sujeitoFatorR: true });

describe("⚠⚠ O PERFIL AFIRMA, E O `false` DO CADASTRO NÃO O DESMENTE", () => {
  it("atividade ativa de Fator R ⇒ SIM, mesmo com `usaFatorR: false` no cadastro", () => {
    // É literalmente o caso da LENTE.
    const r = sujeitoAoFatorR({ atividades: [DE_FATOR_R], usaFatorRCadastro: false });
    expect(r.resposta).toBe(RESPOSTA.SIM);
    expect(r.origem).toBe(ORIGEM.PERFIL);
    expect(r.cnaesDeFatorR).toEqual(["7319003"]);
  });

  it("⚠ e a discordância vira DIVERGÊNCIA NOMEADA, não correção silenciosa", () => {
    const r = sujeitoAoFatorR({ atividades: [DE_FATOR_R], usaFatorRCadastro: false });
    expect(r.divergencia.codigo).toBe("CADASTRO_NAO_MARCA_FATOR_R");
    expect(r.divergencia.frase).toMatch(/confirme o cadastro/i);
  });

  it("com o cadastro concordando, não há divergência a mostrar", () => {
    expect(sujeitoAoFatorR({ atividades: [DE_FATOR_R], usaFatorRCadastro: true }).divergencia).toBeNull();
  });

  it("os dois CNAEs da LENTE saem nomeados na frase", () => {
    const r = sujeitoAoFatorR({
      atividades: [atv({ cnae: "7319003", sujeitoFatorR: true }), atv({ cnae: "6319400", sujeitoFatorR: true })],
      usaFatorRCadastro: false,
    });
    expect(r.motivo).toMatch(/7319003, 6319400/);
    expect(r.motivo).toMatch(/III a partir de 28%/);
  });
});

describe("⚠⚠ SÓ ATIVIDADE ATIVA CONTA — e isto era um defeito", () => {
  // `resolverPerfilFiscal.temFatorR` marcava `true` lendo TODOS os candidatos, antes de olhar
  // `cfg.ativo`: um CNAE que o contador desativou continuava forçando o Fator R da empresa.
  it("atividade de Fator R DESATIVADA não força nada", () => {
    const r = sujeitoAoFatorR({ atividades: [atv({ sujeitoFatorR: true, ativo: false })], usaFatorRCadastro: false });
    expect(r.resposta).not.toBe(RESPOSTA.SIM);
    // ⚠ E a resposta é INDEFINIDO, não `nao`: desativada a única atividade, não sobra NADA ativo de
    // onde derivar. Escrevi este teste esperando `nao` e ele caiu — com razão. "Não há atividade
    // ativa" e "as atividades ativas não são de Fator R" são fatos diferentes, e só o segundo
    // autoriza dizer não.
    expect(r.resposta).toBe(RESPOSTA.INDEFINIDO);
    expect(r.motivo).toMatch(/Nenhuma atividade ativa no perfil/i);
  });

  it("uma ativa entre desativadas ainda decide", () => {
    const r = sujeitoAoFatorR({
      atividades: [atv({ cnae: "1", sujeitoFatorR: true, ativo: false }), atv({ cnae: "2", sujeitoFatorR: true })],
      usaFatorRCadastro: false,
    });
    expect(r.cnaesDeFatorR).toEqual(["2"]);
  });

  it("⚠ `ativo` ausente é ATIVO — é o default do serviço, e inverter isso esconderia atividade", () => {
    const { ativo, ...semAtivo } = atv({ sujeitoFatorR: true });
    expect(sujeitoAoFatorR({ atividades: [semAtivo], usaFatorRCadastro: false }).resposta).toBe(RESPOSTA.SIM);
  });
});

describe("⚠⚠ A MARCA DO CONTADOR NUNCA É REBAIXADA", () => {
  // Mesma disciplina da regra APRENDIDA que nunca suspende uma regra MANUAL: decisão explícita de
  // uma pessoa não se desfaz por observação do sistema.
  it("`usaFatorR: true` sem nenhuma atividade de Fator R ⇒ SIM, pelo cadastro", () => {
    const r = sujeitoAoFatorR({ atividades: [atv()], usaFatorRCadastro: true });
    expect(r.resposta).toBe(RESPOSTA.SIM);
    expect(r.origem).toBe(ORIGEM.CADASTRO);
    expect(r.divergencia.codigo).toBe("PERFIL_NAO_TEM_ATIVIDADE_DE_FATOR_R");
  });
});

describe("⚠⚠ \"INDEFINIDO\" NÃO É \"NÃO\"", () => {
  it("sem cadastro fiscal, a resposta é INDEFINIDO — nunca `nao`", () => {
    const r = sujeitoAoFatorR({ atividades: [], usaFatorRCadastro: false, temCadastro: false });
    expect(r.resposta).toBe(RESPOSTA.INDEFINIDO);
    expect(r.origem).toBe(ORIGEM.SEM_CADASTRO);
  });

  it("⚠ nenhum CNAE ativo no CATÁLOGO ⇒ INDEFINIDO, não `nao`", () => {
    // O catálogo do portal tem 127 de ~1.330 subclasses da CNAE 2.3 (~10%). "Não achei" é ausência
    // de informação, não ausência de Fator R.
    const r = sujeitoAoFatorR({ atividades: [atv({ impeditivo: true })], usaFatorRCadastro: false });
    expect(r.resposta).toBe(RESPOSTA.INDEFINIDO);
    expect(r.origem).toBe(ORIGEM.SEM_CATALOGO);
    expect(r.motivo).toMatch(/não há como derivar/i);
  });

  it("perfil vazio ⇒ INDEFINIDO, com o motivo próprio", () => {
    const r = sujeitoAoFatorR({ atividades: [], usaFatorRCadastro: false });
    expect(r.resposta).toBe(RESPOSTA.INDEFINIDO);
    expect(r.motivo).toMatch(/Nenhuma atividade ativa no perfil/i);
  });

  it("⚠ um CNAE catalogado e não-Fator-R É base para dizer NÃO", () => {
    const r = sujeitoAoFatorR({ atividades: [atv()], usaFatorRCadastro: false });
    expect(r.resposta).toBe(RESPOSTA.NAO);
    expect(r.divergencia).toBeNull();
  });

  it("catalogado + não catalogado: o catalogado sustenta o NÃO", () => {
    const r = sujeitoAoFatorR({
      atividades: [atv({ cnae: "1" }), atv({ cnae: "2", impeditivo: true })],
      usaFatorRCadastro: false,
    });
    expect(r.resposta).toBe(RESPOSTA.NAO);
  });
});

describe("⚠ entrada torta não vira afirmação", () => {
  it.each([undefined, {}, { atividades: null }])("%p não estoura e não responde \"não\" à toa", (args) => {
    const r = sujeitoAoFatorR(args);
    expect([RESPOSTA.INDEFINIDO, RESPOSTA.NAO]).toContain(r.resposta);
    expect(typeof r.motivo).toBe("string");
  });

  it("⚠ `usaFatorRCadastro` NULO não é `true` nem derruba a derivação", () => {
    expect(sujeitoAoFatorR({ atividades: [DE_FATOR_R], usaFatorRCadastro: null }).resposta).toBe(RESPOSTA.SIM);
    expect(sujeitoAoFatorR({ atividades: [atv()], usaFatorRCadastro: null }).resposta).toBe(RESPOSTA.NAO);
  });
});
