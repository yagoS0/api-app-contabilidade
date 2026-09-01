// A REGRA QUE IMPEDE O "SALVAR" DE APAGAR A DESCRIÇÃO DOS CNAEs.
//
// ⚠ Os exemplos abaixo são FORMAS reais medidas em produção (30/08/2026), com o texto encurtado:
// 12 de 34 empresas tinham ao menos uma linha descrita, contra 65 linhas com código nu.

import { mesclarAtividades, temDescricao } from "../atividadesDaEmpresa.js";

describe("temDescricao", () => {
  test("código nu, nas duas formas gravadas em produção, NÃO é descrição", () => {
    expect(temDescricao("4619200")).toBe(false);
    expect(temDescricao("46.19-2-00")).toBe(false);
    expect(temDescricao("")).toBe(false);
    expect(temDescricao(null)).toBe(false);
  });

  test("código + texto é descrição", () => {
    expect(temDescricao("46.19-2-00 - Representantes comerciais e agentes do comércio")).toBe(true);
    expect(temDescricao("82.20-2-00 - Atividades de teleatendimento (Dispensada *)")).toBe(true);
  });
});

describe("mesclarAtividades", () => {
  test("PRESERVA a linha descrita quando o código continua na lista — o defeito relatado", () => {
    const atuais = ["46.19-2-00 - Representantes comerciais e agentes do comércio"];
    // o payload chega com o código NU, porque `realApi` faz `.replace(/\D+/g,"")`
    expect(mesclarAtividades(atuais, ["4619200"])).toEqual([
      "46.19-2-00 - Representantes comerciais e agentes do comércio",
    ]);
  });

  test("casa com o código gravado FORMATADO e com o gravado NU — as duas formas de produção", () => {
    const descrita = "70.20-4-00 - Atividades de consultoria em gestão empresarial";
    expect(mesclarAtividades([descrita], ["70.20-4-00"])).toEqual([descrita]);
    expect(mesclarAtividades(["7020400 - Consultoria"], ["7020400"])).toEqual(["7020400 - Consultoria"]);
  });

  test("código REMOVIDO do cadastro some — preservar não é acumular", () => {
    const atuais = ["4619200 - Representantes", "8220200 - Teleatendimento"];
    expect(mesclarAtividades(atuais, ["4619200"])).toEqual(["4619200 - Representantes"]);
  });

  test("código NOVO, sem linha correspondente, entra NU — nada é inventado", () => {
    const saida = mesclarAtividades(["4619200 - Representantes"], ["4619200", "6201500"]);
    expect(saida).toEqual(["4619200 - Representantes", "6201500"]);
  });

  test("⚠ CÓDIGO NU CONTINUA NU: não existe tabela para completar a descrição", () => {
    expect(mesclarAtividades(["6201500"], ["6201500"])).toEqual(["6201500"]);
    expect(mesclarAtividades([], ["6201500"])).toEqual(["6201500"]);
  });

  test("entrada vazia ou inválida não fabrica linha nenhuma", () => {
    expect(mesclarAtividades(null, null)).toEqual([]);
    expect(mesclarAtividades(undefined, [])).toEqual([]);
    expect(mesclarAtividades(["4619200 - X"], [])).toEqual([]);
    expect(mesclarAtividades(["4619200 - X"], ["", null, "  "])).toEqual([]);
  });

  test("⚠ a linha DESCRITA vence a nua do mesmo código, qualquer que seja a ordem gravada", () => {
    expect(mesclarAtividades(["4619200", "4619200 - Representantes"], ["4619200"]))
      .toEqual(["4619200 - Representantes"]);
    expect(mesclarAtividades(["4619200 - Representantes", "4619200"], ["4619200"]))
      .toEqual(["4619200 - Representantes"]);
  });

  test("o mesmo código pedido duas vezes sai UMA vez", () => {
    expect(mesclarAtividades(["4619200 - X"], ["4619200", "46.19-2-00"])).toEqual(["4619200 - X"]);
  });

  test("código que não normaliza (menos de 7 dígitos) entra CRU, não é descartado", () => {
    // ⚠ Descartar apagaria do cadastro um valor que o contador digitou. Quem julga a forma é o
    //   validador (`company_cnae_principal_required`), não esta função.
    expect(mesclarAtividades([], ["123"])).toEqual(["123"]);
  });

  test("a ORDEM é a dos códigos pedidos — o principal primeiro", () => {
    const atuais = ["8220200 - Teleatendimento", "4619200 - Representantes"];
    expect(mesclarAtividades(atuais, ["4619200", "8220200"])).toEqual([
      "4619200 - Representantes",
      "8220200 - Teleatendimento",
    ]);
  });
});
