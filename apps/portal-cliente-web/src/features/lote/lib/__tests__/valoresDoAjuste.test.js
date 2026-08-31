// ⚠⚠ O AJUSTE ABRE COM O ENDEREÇO QUE O SERVIDOR JÁ RESOLVEU (31/08/2026)
//
// > Dono: *"ao abrir os ajustes o endereço do tomador não está preenchido e deveria."*
//
// O endereço saiu da planilha em 20/08/2026 e passou a vir do cadastro de tomador ou da Receita.
// O formulário continuou semeado só com as células do arquivo, então numa linha PRONTA — cujo
// endereço o servidor JÁ tinha — o bloco inteiro abria em branco. Quem lê conclui que o sistema
// não tem o endereço e digita de novo o que já existe.
//
// ⚠⚠ E AS CHAVES NÃO BATEM: o payload usa `CEP` (maiúsculo, como o XML da NFS-e) e o formulário usa
// `cep`. Um spread traria a chave errada e o campo continuaria vazio — com o dado do lado,
// invisível. É o caso que este arquivo existe para travar.

import { valoresDoAjuste } from "../colunasDoLote";

// A forma EXATA de `classificarLinhaLote.js` — copiada do payload, não inventada aqui.
const LINHA_PRONTA = Object.freeze({
  numero: 2,
  valores: { documento: "12345678000190", descricao: "Consultoria", valor: "1500,00", competencia: "01/08/2026" },
  dados: {
    tomador: {
      doc: "12345678000190",
      nome: "ACME LTDA",
      email: "financeiro@acme.com.br",
      endereco: {
        cMun: "3304557",
        CEP: "20031170",
        xLgr: "Rua da Assembleia",
        nro: "10",
        xCpl: "sala 1201",
        xBairro: "Centro",
      },
    },
    servico: { descricao: "Consultoria", valorServicos: 1500 },
    competencia: "2026-08",
  },
});

describe("⚠⚠ o formulário de ajuste abre preenchido", () => {
  it("⚠⚠ o CEP chega — é a única chave que muda de caixa entre o payload e a tela", () => {
    // `CEP` → `cep`. Sem a tradução, o campo abre vazio com o dado do lado.
    expect(valoresDoAjuste(LINHA_PRONTA).cep).toBe("20031170");
  });

  it("o bloco de endereço inteiro chega", () => {
    const v = valoresDoAjuste(LINHA_PRONTA);
    expect(v.xLgr).toBe("Rua da Assembleia");
    expect(v.nro).toBe("10");
    expect(v.xBairro).toBe("Centro");
    expect(v.xCpl).toBe("sala 1201");
    expect(v.cMun).toBe("3304557");
  });

  it("o nome e o e-mail resolvidos também chegam", () => {
    const v = valoresDoAjuste(LINHA_PRONTA);
    expect(v.nome).toBe("ACME LTDA");
    expect(v.email).toBe("financeiro@acme.com.br");
  });

  it("as células da planilha continuam vindo, intocadas", () => {
    const v = valoresDoAjuste(LINHA_PRONTA);
    expect(v.documento).toBe("12345678000190");
    expect(v.valor).toBe("1500,00");
    expect(v.competencia).toBe("01/08/2026");
  });

  it("⚠⚠ A CÉLULA DIGITADA VENCE o que o servidor resolveu", () => {
    // Senão o formulário desfaria a correção de quem já ajustou esta linha, toda vez que reabrisse.
    const comAjuste = {
      ...LINHA_PRONTA,
      valores: { ...LINHA_PRONTA.valores, nro: "999", nome: "ACME COMERCIO LTDA" },
    };
    const v = valoresDoAjuste(comAjuste);
    expect(v.nro).toBe("999");
    expect(v.nome).toBe("ACME COMERCIO LTDA");
    // ⚠ E o resto continua vindo do servidor — não é tudo ou nada.
    expect(v.xLgr).toBe("Rua da Assembleia");
  });

  it("⚠ linha sem `dados` devolve só as células — é a verdade, e é o que o ajuste vem receber", () => {
    // `dados` é NULO fora de PRONTA/CONFERIR: não há endereço resolvido para mostrar.
    const pendente = { numero: 3, valores: { documento: "11122233344" }, dados: null };
    expect(valoresDoAjuste(pendente)).toEqual({ documento: "11122233344" });
  });

  it("⚠ campo resolvido vazio NÃO sobrescreve, e não vira string 'null'", () => {
    const semComplemento = {
      ...LINHA_PRONTA,
      dados: {
        ...LINHA_PRONTA.dados,
        tomador: {
          ...LINHA_PRONTA.dados.tomador,
          email: null,
          endereco: { ...LINHA_PRONTA.dados.tomador.endereco, xCpl: "" },
        },
      },
    };
    const v = valoresDoAjuste(semComplemento);
    expect(v.email ?? "").toBe("");
    expect(v.xCpl ?? "").toBe("");
  });

  it("⚠ nada de undefined explode — a linha pode chegar pela metade enquanto a tela carrega", () => {
    expect(valoresDoAjuste(undefined)).toEqual({});
    expect(valoresDoAjuste({})).toEqual({});
    expect(valoresDoAjuste({ dados: {} })).toEqual({});
  });
});
