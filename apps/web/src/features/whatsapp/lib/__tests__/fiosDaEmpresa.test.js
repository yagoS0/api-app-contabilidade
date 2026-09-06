// QUAL FIO ABRIR DENTRO DA EMPRESA — a regra, pura.
//
// ⚠ O caso que importa é o do meio: o dono decidiu que o seletor de contato SÓ aparece quando há
// mais de um fio. Um seletor de um item pergunta o que não tem alternativa.

import { ESCOLHA_DO_FIO, FRASE_SEM_FIO, escolhaDoFio, fioAberto } from "../fiosDaEmpresa";

const fio = (id) => ({ id, telefoneE164: `5521${id}` });

describe("escolhaDoFio — três respostas", () => {
  it("⚠ empresa sem fio nenhum NÃO é erro: é 'ninguém escreveu ainda'", () => {
    const r = escolhaDoFio([]);
    expect(r.situacao).toBe(ESCOLHA_DO_FIO.VAZIO);
    expect(r.unico).toBeNull();
    // A frase explica de QUEM é a vez — a janela de 24h abre pelo cliente, não pelo escritório.
    expect(FRASE_SEM_FIO).toMatch(/Quem abre a conversa é o cliente/);
  });

  it("um fio só: abre direto, sem seletor", () => {
    const r = escolhaDoFio([fio("a")]);
    expect(r.situacao).toBe(ESCOLHA_DO_FIO.UNICO);
    expect(r.unico.id).toBe("a");
  });

  it("dois ou mais: escolher — e todos os fios viajam para o seletor", () => {
    const r = escolhaDoFio([fio("a"), fio("b")]);
    expect(r.situacao).toBe(ESCOLHA_DO_FIO.ESCOLHER);
    expect(r.unico).toBeNull();
    expect(r.fios.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("lista ausente ou suja não quebra", () => {
    expect(escolhaDoFio(null).situacao).toBe(ESCOLHA_DO_FIO.VAZIO);
    expect(escolhaDoFio([null, fio("a"), undefined]).situacao).toBe(ESCOLHA_DO_FIO.UNICO);
  });
});

describe("fioAberto", () => {
  it("o escolhido vence", () => {
    expect(fioAberto([fio("a"), fio("b")], "b").id).toBe("b");
  });

  it("⚠ escolha que sumiu cai no PRIMEIRO — não deixa a tela vazia nem guarda um id morto", () => {
    expect(fioAberto([fio("a"), fio("b")], "zzz").id).toBe("a");
  });

  it("sem escolha, o primeiro (que é o mais recente, pela ordenação da lista)", () => {
    expect(fioAberto([fio("a"), fio("b")], null).id).toBe("a");
  });

  it("sem fio nenhum, nulo", () => {
    expect(fioAberto([], "a")).toBeNull();
    expect(fioAberto(null, "a")).toBeNull();
  });
});
