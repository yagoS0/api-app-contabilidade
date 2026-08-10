// O PAYLOAD DA DECLARAÇÃO ZERADA — a forma que a Receita aceita, travada.
//
// O defeito (produção, 10/08/2026): empresa do Simples sem faturamento montava
// `estabelecimentos[0].atividades: []` e a RFB recusava com
//
//     HTTP 400 — "SN-Entregar: O valor da atividade deve ser maior que zero."
//
// A forma correta é OMITIR a chave, e isso é documentação oficial, não dedução:
//
//  • esquema de entrada do TRANSDECLARACAO11 (apicenter SERPRO, lido em 10/08/2026), campo
//    `atividades`: "Se não houve atividade para o estabelecimento, não enviar esta lista" — campo
//    NÃO obrigatório, ao contrário de `estabelecimentos`;
//  • catálogo de mensagens do PGDAS-D, na AÇÃO do próprio erro que recebemos
//    (`EntradaIncorreta-PGDASD-MSG_ISN_023`): "Caso não tenha atividade no período, o bloco
//    ListaAtividades não deve ser enviado."
//
// ⚠ `[]` e chave ausente são a MESMA COISA para quase todo código JavaScript e coisas OPOSTAS para
// este validador. É por isso que existe um teste só para a forma do objeto: nenhuma asserção sobre
// comportamento pega essa diferença, e `JSON.stringify` de um `[]` não chama atenção de ninguém.
//
// ⚠ E é a mesma regra que já valia para `receitasBrutasAnteriores` e `folhasSalario`, omitidos
// quando vazios pelo mesmo motivo. `atividades` era a cópia fora de sincronia.

import { buildDeclaracaoPayload } from "../PgdasSimulacaoService.js";

const BASE = { contribuinteCnpj: "10.111.222/0001-58", competencia: "2026-07", indicadorTransmissao: false };
// A linha que o CNAE produz numa empresa sem faturamento: atividade real, valor zero.
const ATIVIDADE_ZERADA = [{ idAtividade: 11, valorInterno: 0, valorExterno: 0 }];

function estabelecimento(payload) {
  return payload.declaracao.estabelecimentos[0];
}

describe("buildDeclaracaoPayload — declaração zerada", () => {
  it("⚠ sem atividade, a chave `atividades` NÃO existe no estabelecimento", () => {
    const est = estabelecimento(buildDeclaracaoPayload({ ...BASE, atividades: [] }));
    expect("atividades" in est).toBe(false);
  });

  it("⚠ atividade de R$ 0,00 também some — e não deixa `[]` para trás", () => {
    // Este era o caso real: a lista chegava com um item, o item era descartado por valor zero, e
    // sobrava o array vazio que a RFB recusa.
    const est = estabelecimento(buildDeclaracaoPayload({ ...BASE, atividades: ATIVIDADE_ZERADA }));
    expect("atividades" in est).toBe(false);
  });

  it("lista vazia e lista de R$ 0,00 produzem o MESMO payload", () => {
    // Vale registrar porque foi o que enganou o gate do `calcularFechamento`, que perguntava pelo
    // comprimento da lista enquanto o payload pergunta pela soma.
    const vazia = buildDeclaracaoPayload({ ...BASE, atividades: [] });
    const zerada = buildDeclaracaoPayload({ ...BASE, atividades: ATIVIDADE_ZERADA });
    expect(zerada).toEqual(vazia);
  });

  it("o estabelecimento continua presente, com o CNPJ — só a lista de atividades some", () => {
    // ⚠ `estabelecimentos` é OBRIGATÓRIO na doc. Omitir a lista de atividades não é omitir o
    // estabelecimento; confundir as duas coisas troca um erro por outro.
    const est = estabelecimento(buildDeclaracaoPayload({ ...BASE, atividades: [] }));
    expect(est.cnpjCompleto).toBe("10111222000158");
  });

  it("as receitas do PA vão zeradas, não omitidas", () => {
    // Manual do PGDAS-D e DEFIS (RFB, 17/06/2025) §6.4.1: "os campos de receita bruta deverão ser
    // preenchidos com valor igual a zero".
    const { declaracao } = buildDeclaracaoPayload({ ...BASE, atividades: [] });
    expect(declaracao.receitaPaCompetenciaInterno).toBe(0);
    expect(declaracao.receitaPaCompetenciaExterno).toBe(0);
  });

  it("⚠ COM atividade de verdade, a chave volta — a omissão é só do caso zerado", () => {
    const est = estabelecimento(buildDeclaracaoPayload({
      ...BASE, atividades: [{ idAtividade: 11, valorInterno: 1000, valorExterno: 0 }],
    }));
    expect(est.atividades).toHaveLength(1);
    expect(est.atividades[0]).toMatchObject({ idAtividade: 11, valorAtividade: 1000 });
  });

  it("uma atividade zerada no meio de outras preenchidas some sozinha", () => {
    const est = estabelecimento(buildDeclaracaoPayload({
      ...BASE,
      atividades: [
        { idAtividade: 11, valorInterno: 1000, valorExterno: 0 },
        { idAtividade: 3, valorInterno: 0, valorExterno: 0 },
      ],
    }));
    expect(est.atividades).toHaveLength(1);
    expect(est.atividades[0].idAtividade).toBe(11);
  });
});
