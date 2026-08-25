// A LIGAÇÃO PREFILL → INPUT → CÁLCULO — a camada que não tinha um único teste.
//
// ⚠⚠ ELA É A LIÇÃO INTEIRA DE 25/08/2026. O motor fiscal tem 95 testes (24 casos dourados
// calculados à mão) e estava CERTO. `prefillDaEmpresa` tem 15 e estava CERTO. Entre um e outro,
// o número passava por `String(n)` e voltava por um parser pt-BR — e ninguém media essa passagem.
//
// O que o dono viu na tela da LENTE, e que tem esta única causa:
//   · "A empresa não é elegível a este regime com esta receita"  (Lucro Presumido, sobre 889 mil)
//   · "Sem RBT12 não há alíquota efetiva"                        (com o RBT12 preenchido na tela)
//   · e, entre as duas, um "ponto de equilíbrio" cravando R$ 1.250.000 — porque `pontoDeEquilibrio`
//     varre com um RBT12 interno e não encostava no estado quebrado.
//
// Medido em produção antes do conserto: 12 de 18 empresas com dado apurado, 3 com o Presumido morto
// e 7 com o Simples. Este arquivo prende os três sintomas pelo caminho REAL da tela.

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PlanejamentoPage } from "../renderPlanejamentoPage";

/** ⚠ Os números são os da LENTE em produção, com centavos — é o centavo que quebrava. */
const LENTE = {
  receitaAnual: 889_286.09,
  rbt12: 718_036.09,
  folhaAnual: 31_500,
  aliquotaIss: 0.035,
};

const ok = (valor, origem = "medido em produção") => ({ valor, apurado: true, origem, motivoAusencia: null });
const nao = (motivoAusencia) => ({ valor: null, apurado: false, origem: null, motivoAusencia });

function payload(over = {}, raiz = {}) {
  return {
    empresa: { id: "e1", razao: "LENTE - MEDICAL MARKETING LTDA", cnpj: "24352609000198" },
    referencia: { competencia: "2026-08", janela: [], janelaRotulo: "08/2025 a 07/2026" },
    campos: {
      receitaAnual: ok(LENTE.receitaAnual),
      rbt12: ok(LENTE.rbt12),
      folhaAnual: ok(LENTE.folhaAnual),
      regimeAtual: ok("SIMPLES_NACIONAL"),
      anexo: ok("III"),
      sujeitoFatorR: ok(false),
      aliquotaIss: ok(LENTE.aliquotaIss),
      atividadePresumido: nao("Escolha na tela."),
      ...over,
    },
    ...raiz,
  };
}

function montar(over, raiz) {
  const api = { getDadosPlanejamento: jest.fn(async () => payload(over, raiz)) };
  render(
    <PlanejamentoPage
      api={api}
      empresas={[{ id: "e1", razao: "LENTE - MEDICAL MARKETING LTDA", cnpj: "24352609000198" }]}
      empresa={{ id: "e1" }}
      onVoltar={() => {}}
    />,
  );
  return api;
}

describe("⚠⚠ O VALOR QUE ENTRA NO CAMPO É O VALOR QUE O MOTOR CALCULA", () => {
  it("a receita com centavos chega ao input em pt-BR, não como número cru", async () => {
    montar();
    // ⚠ "889286.09" seria o defeito. O motor leria 88.928.609.
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
  });

  it("o RBT12 idem", async () => {
    montar();
    await waitFor(() => expect(screen.getByDisplayValue("718.036,09")).toBeInTheDocument());
  });

  it("⚠ o ISS FRACIONÁRIO não vira dez vezes maior — 3,5% é 3,5%, não 35%", async () => {
    montar();
    await waitFor(() => expect(screen.getByDisplayValue("3,5")).toBeInTheDocument());
  });
});

describe("⚠⚠ OS TRÊS SINTOMAS QUE O DONO RELATOU", () => {
  it("o Lucro Presumido NÃO sai inelegível com 889 mil de receita", async () => {
    // O teto do Presumido é R$ 78 MILHÕES (Lei 9.718/1998, art. 13). 889 mil não chega perto.
    // ⚠ A acusação inicial foi de lógica invertida com o teto do Simples; o limite estava certo,
    // e quem inflava a receita era a passagem do valor.
    montar();
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    expect(screen.queryByText(/não é elegível a este regime/i)).not.toBeInTheDocument();
  });

  it("o Simples NÃO sai \"Sem RBT12\" com o RBT12 preenchido", async () => {
    montar();
    await waitFor(() => expect(screen.getByDisplayValue("718.036,09")).toBeInTheDocument());
    expect(screen.queryByText(/Sem RBT12/i)).not.toBeInTheDocument();
  });

  it("⚠⚠ SOBRA UMA recusa, e ela é LEGÍTIMA — a do Lucro Real", async () => {
    // O card do equilíbrio sempre calculou (varre com um RBT12 próprio), e era ele que denunciava a
    // contradição: duas caixas dizendo "não dá para comparar" ladeando um número cravado.
    //
    // ⚠ MAS NEM TODA RECUSA ERA DEFEITO. O Lucro Real recusa porque a margem e os créditos de
    // PIS/COFINS não foram informados — sem eles "qualquer número aqui seria chute", e essa recusa
    // TEM de continuar. Um teste que exigisse zero recusas apagaria a guarda junto com o bug.
    montar();
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());

    const recusas = screen.getAllByText(/Não dá para comparar ainda/i);
    expect(recusas).toHaveLength(1);
    // E é a do Lucro Real: a que pede margem e créditos.
    expect(screen.getByText(/a margem de lucro real/i)).toBeInTheDocument();
    expect(screen.getByText(/créditos de PIS\/COFINS/i)).toBeInTheDocument();
  });
});

describe("⚠ O QUE NÃO PODE TER MUDADO JUNTO", () => {
  it("campo NÃO apurado continua vazio — nunca zero, nunca o valor da empresa anterior", async () => {
    montar({ folhaAnual: nao("Não foi possível apurar a folha dos 12 meses.") });
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("0")).not.toBeInTheDocument();
    // ⚠ `getAllByText`: o motivo aparece DUAS vezes de propósito — na linha de origem do campo e
    // dentro do card que se recusou a calcular. Uma consulta singular estoura com "multiple found"
    // e faz parecer defeito o que é a regra funcionando.
    expect(screen.getAllByText(/Não foi possível apurar a folha/i).length).toBeGreaterThan(0);
  });

  it("valor REDONDO continua funcionando — era o único formato que o mock exercitava", async () => {
    montar({ receitaAnual: ok(1_850_000), rbt12: ok(1_790_000) });
    await waitFor(() => expect(screen.getByDisplayValue("1.850.000")).toBeInTheDocument());
    expect(screen.queryByText(/não é elegível a este regime/i)).not.toBeInTheDocument();
  });
});

describe("⚠⚠ O FATOR R VEM DO PERFIL DE ATIVIDADES, NÃO DO BOOLEANO DO CADASTRO", () => {
  // Defeito relatado pelo dono: o Perfil fiscal da LENTE mostrava os DOIS CNAEs como "III ou V
  // (Fator R) — sim" e ESTA tela exibia o checkbox DESMARCADO, com o anexo travado em III.
  // A causa era `CadastroFiscal.usaFatorR` ser lido cru — uma coluna com `@default(false)`, que
  // não distingue "o contador disse que não" de "ninguém nunca abriu essa tela".
  const DIVERGENTE = {
    fatorR: {
      resposta: "sim",
      origem: "perfil_de_atividades",
      cnaes: ["7319003", "6319400"],
      divergencia: {
        codigo: "CADASTRO_NAO_MARCA_FATOR_R",
        frase: "O cadastro fiscal está com \"usa Fator R\" desmarcado, mas o perfil tem atividade "
          + "sujeita ao Fator R. Vale o perfil — confirme o cadastro.",
      },
    },
  };

  it("o checkbox nasce MARCADO quando o perfil diz que a atividade é de Fator R", async () => {
    montar({ sujeitoFatorR: ok(true, "As atividades 7319003, 6319400 são sujeitas ao Fator R.") }, DIVERGENTE);
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    const caixa = screen.getByLabelText(/Atividade sujeita ao Fator R/i);
    expect(caixa).toBeChecked();
  });

  it("⚠⚠ e a DIVERGÊNCIA com o cadastro aparece — não é corrigida em silêncio", async () => {
    // Corrigir calado deixaria o cadastro errado para sempre. Quem responde por ele é o contador.
    montar({ sujeitoFatorR: ok(true, "…") }, DIVERGENTE);
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    expect(screen.getByText(/desmarcado, mas o perfil tem atividade sujeita ao Fator R/i)).toBeInTheDocument();
    expect(screen.getByText(/confirme o cadastro/i)).toBeInTheDocument();
  });

  it("sem divergência, nada é dito — âmbar permanente treina o olho a ignorar", async () => {
    montar({ sujeitoFatorR: ok(true, "…") }, { fatorR: { resposta: "sim", divergencia: null } });
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    expect(screen.queryByText(/confirme o cadastro/i)).not.toBeInTheDocument();
  });

  it("⚠ payload SEM `fatorR` (contrato antigo) não quebra nem inventa aviso", async () => {
    montar();
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    expect(screen.queryByText(/confirme o cadastro/i)).not.toBeInTheDocument();
  });

  it("⚠⚠ INDEFINIDO deixa o campo AUSENTE, com o motivo — nunca afirma \"não é Fator R\"", async () => {
    // Um `false` aqui derruba a empresa no Anexo V (a alíquota MAIOR) sem ninguém ter decidido.
    montar({ sujeitoFatorR: nao("Sem cadastro fiscal não há como saber se a atividade é sujeita ao Fator R.") });
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    expect(screen.getAllByText(/não há como saber se a atividade é sujeita ao Fator R/i).length).toBeGreaterThan(0);
  });
});

describe("⚠⚠ A PERGUNTA DOS R$ 120.000 (art. 15, § 4º) APARECE E NÃO SE RESPONDE SOZINHA", () => {
  const PEQUENA = { receitaAnual: ok(100_000), rbt12: ok(100_000) };

  it("com receita dentro do limite, a pergunta aparece com as exceções nomeadas", async () => {
    montar(PEQUENA);
    // ⚠ receita e RBT12 têm o mesmo valor aqui, logo DOIS inputs o exibem.
    await waitFor(() => expect(screen.getAllByDisplayValue("100.000").length).toBeGreaterThan(0));
    expect(screen.getByText(/a presunção de IRPJ pode ser de 16%/i)).toBeInTheDocument();
    // ⚠ Caso concreto na carteira: terapia ocupacional é profissão regulamentada e NÃO tem direito.
    expect(screen.getByText(/profissão legalmente regulamentada/i)).toBeInTheDocument();
    expect(screen.getByText(/serviços hospitalares/i)).toBeInTheDocument();
  });

  it("⚠⚠ NADA vem pré-selecionado — valor escolhido pelo sistema fica indistinguível de conferido", async () => {
    montar(PEQUENA);
    // ⚠ receita e RBT12 têm o mesmo valor aqui, logo DOIS inputs o exibem.
    await waitFor(() => expect(screen.getAllByDisplayValue("100.000").length).toBeGreaterThan(0));
    expect(screen.getByLabelText(/Enquadra — usar 16%/i)).not.toBeChecked();
    expect(screen.getByLabelText(/Não enquadra — 32%/i)).not.toBeChecked();
  });

  it("⚠ e enquanto ninguém responde, a tela DIZ o que a omissão custa", async () => {
    montar(PEQUENA);
    // ⚠ receita e RBT12 têm o mesmo valor aqui, logo DOIS inputs o exibem.
    await waitFor(() => expect(screen.getAllByDisplayValue("100.000").length).toBeGreaterThan(0));
    // ⚠ A frase aparece em DOIS lugares, e isso é o desenho: ao lado da pergunta (onde se
    // responde) e dentro de "o que este total não considera", no card do Presumido (onde o número
    // é lido). Uma consulta singular estoura com "multiple found" e faz parecer defeito.
    expect(screen.getAllByText(/pode estar superestimado/i).length).toBeGreaterThanOrEqual(2);
  });

  it("acima de R$ 120.000 a pergunta NÃO aparece — não há o que enquadrar", async () => {
    montar();
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    expect(screen.queryByText(/a presunção de IRPJ pode ser de 16%/i)).not.toBeInTheDocument();
  });
});

describe("⚠⚠ A CATEGORIA DO PRESUMIDO CHEGA SUGERIDA, E A TELA DIZ QUE É SUGESTÃO", () => {
  // Decisão do dono (25/08/2026): "sugerir por CNAE, você confirma". A diferença entre SUGERIR e
  // DERIVAR é o desenho inteiro — e errar entre 8% e 32% de IRPJ inverte a comparação de regimes.
  const SUGERE_SERVICO = {
    presumido: {
      sugestao: "servicos", rotulo: "Serviços em geral", confianca: "media",
      motivo: "O CNAE 6201501 é de SERVIÇO no catálogo do Simples.",
      excecoes: ["serviços hospitalares e de auxílio diagnóstico não são \"serviços em geral\": a presunção de IRPJ cai para 8%"],
      confirmadoPeloContador: false,
    },
  };

  it("pré-seleciona a sugestão E a marca como sugestão", async () => {
    montar({}, SUGERE_SERVICO);
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    expect(screen.getByText(/foi/i).textContent).toMatch(/sugerido/i);
    expect(screen.getByText(/confirme no seletor acima/i)).toBeInTheDocument();
  });

  it("⚠⚠ e as EXCEÇÕES aparecem — sem elas o contador confirma sem saber o quê", async () => {
    montar({}, SUGERE_SERVICO);
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    expect(screen.getByText(/hospitalares/i)).toBeInTheDocument();
  });

  it("⚠ tocar no seletor É a confirmação — o aviso some", async () => {
    montar({}, SUGERE_SERVICO);
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    const select = screen.getByLabelText(/Atividade no Lucro Presumido/i);
    fireEvent.change(select, { target: { value: "comercio" } });
    expect(screen.queryByText(/confirme no seletor acima/i)).not.toBeInTheDocument();
  });

  it("⚠⚠ SEM sugestão a tela não inventa aviso nenhum — e o campo segue AUSENTE", async () => {
    // 18 dos 64 CNAEs da carteira estão fora do catálogo. Cair no default de "serviços" ali
    // afirmaria 32% para quem pode ser 8%.
    montar({}, { presumido: { sugestao: null, rotulo: null, confianca: null, motivo: "fora do catálogo", excecoes: [] } });
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    expect(screen.queryByText(/confirme no seletor acima/i)).not.toBeInTheDocument();
  });

  it("⚠ payload SEM `presumido` (contrato antigo) não quebra", async () => {
    montar();
    await waitFor(() => expect(screen.getByDisplayValue("889.286,09")).toBeInTheDocument());
    expect(screen.queryByText(/confirme no seletor acima/i)).not.toBeInTheDocument();
  });
});
