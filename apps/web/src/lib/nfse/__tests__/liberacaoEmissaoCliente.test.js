// A REGRA DE TELA DO PORTÃO — sozinha (a ligação é
// `features/companies/form/components/__tests__/liberacaoEmissaoCliente.test.jsx`).

import {
  lerLiberacaoEmissao,
  linhaDeAutoria,
  fraseDeConfirmacao,
  PAPEIS_QUE_PASSAM,
  PAPEIS_QUE_NAO_PASSAM,
} from "../liberacaoEmissaoCliente";

describe("três estados, não dois", () => {
  it("prop ausente = ESTADO DESCONHECIDO, e isso não é 'não liberada'", () => {
    // ⚠ Desenhar as duas iguais faria o contador achar que alguém revogou a liberação dele.
    const r = lerLiberacaoEmissao(undefined);
    expect(r.conhecida).toBe(false);
    expect(r.liberada).toBe(false);
  });

  it("`{liberada:false}` é conhecido E não liberado", () => {
    const r = lerLiberacaoEmissao({ liberada: false, liberadaEm: null, liberadaPor: null });
    expect(r.conhecida).toBe(true);
    expect(r.liberada).toBe(false);
    expect(r.resumo).toMatch(/só o escritório/i);
  });

  it("`{liberada:true}` é conhecido E liberado", () => {
    const r = lerLiberacaoEmissao({ liberada: true, liberadaEm: "2026-08-17T13:40:00.000Z", liberadaPorNome: "Fulano" });
    expect(r.conhecida).toBe(true);
    expect(r.liberada).toBe(true);
    expect(r.quem).toBe("Fulano");
    expect(r.quando).toBeTruthy();
  });

  it("só `true` literal libera — string 'true' não conta", () => {
    expect(lerLiberacaoEmissao({ liberada: "true" }).liberada).toBe(false);
    expect(lerLiberacaoEmissao({ liberada: 1 }).liberada).toBe(false);
  });
});

describe("quem liberou", () => {
  it("sem nome, cai no id — usuário apagado não vira 'ninguém'", () => {
    const r = lerLiberacaoEmissao({ liberada: true, liberadaPor: "user-42", liberadaPorNome: null });
    expect(r.quem).toBe("user-42");
  });

  it("nem nome nem id: a autoria é DITA como ausente, não escondida", () => {
    const r = lerLiberacaoEmissao({ liberada: true, liberadaPor: null, liberadaPorNome: null, liberadaEm: null });
    expect(linhaDeAutoria(r)).toMatch(/não há registro/i);
  });

  it("data inválida não vira 'Invalid Date' na tela", () => {
    const r = lerLiberacaoEmissao({ liberada: true, liberadaEm: "não é data", liberadaPorNome: "Fulano" });
    expect(r.quando).toBeNull();
    expect(linhaDeAutoria(r)).toMatch(/sem registro da data/i);
  });

  it("revogada não carrega autoria antiga", () => {
    // O backend zera `Em`/`Por` ao revogar; a tela não pode inventar o que não veio.
    const r = lerLiberacaoEmissao({ liberada: false, liberadaPor: "user-42", liberadaEm: "2026-08-17T13:40:00.000Z" });
    expect(r.quem).toBeNull();
    expect(r.quando).toBeNull();
  });
});

describe("a confirmação REPETE o que vai acontecer", () => {
  it("nomeia os papéis, o ambiente e em nome de quem", () => {
    const frase = fraseDeConfirmacao("EMPRESA TESTE LTDA");
    expect(frase).toContain("CLIENT_ADMIN");
    expect(frase).toContain("OWNER");
    expect(frase).toMatch(/produção/i);
    expect(frase).toContain("EMPRESA TESTE LTDA");
  });

  it("sem razão social ainda faz sentido", () => {
    expect(fraseDeConfirmacao("")).toMatch(/desta empresa/i);
  });

  it("o papel que NÃO passa é nomeado à parte — a surpresa é o que se quer evitar", () => {
    expect(PAPEIS_QUE_PASSAM).toEqual(["CLIENT_ADMIN", "OWNER"]);
    expect(PAPEIS_QUE_NAO_PASSAM).toEqual(["FINANCEIRO"]);
    expect(PAPEIS_QUE_PASSAM).not.toContain("FINANCEIRO");
  });
});
