// A LIGAÇÃO da pré-verificação com a tela.
//
// ⚠⚠ TESTE DE LIGAÇÃO, E ELE É O QUE IMPORTA AQUI. A regra do backend tem teste lá, a tradução tem
// teste em `lib/__tests__/verificacaoNaTela.test.js` — e as duas podem estar verdes com o painel
// não renderizando nada, que é exatamente como `hasAccountingDivergence` passou meses sendo
// gravado sem ninguém ver. O que se prende aqui é o CAMPO DO PAYLOAD CHEGANDO À TELA.

import { render, screen } from "@testing-library/react";
import { VerificacaoDeLancamentos } from "../renderAccountingEntriesTab";

// A resposta REAL da rota, com os achados medidos em produção em 24/08/2026.
const RESPOSTA = {
  ok: true,
  competencia: "2026-07",
  resumo: { total: 12, ok: 4, viola: 6, conferir: 1, indeterminado: 36, suprimidos: 0 },
  porRegra: [
    {
      regraId: "F3.01", severidade: "ALERTA", n: 3,
      exemplos: ["IRPJ/CSLL incide sobre o lucro, não sobre a receita: debitando 5.1.1.01.0002 (-) CSLL — esperado despesa tributária (4.1.1.03.*)."],
      lancamentos: ["e1", "e2", "e3"],
    },
    {
      regraId: "F3.02", severidade: "ALERTA", n: 2,
      exemplos: ["Provisão creditando 1.2.1.06.0003 CSLL — esperado a obrigação a recolher (2.1.1.05.*)."],
      lancamentos: ["e1", "e2"],
    },
    {
      regraId: "F9.03", severidade: "SUGESTAO", n: 1,
      exemplos: ["Move dívida entre passivos (2.1.1.05.0027 → 2.1.1.05.0016)."],
      lancamentos: ["e5"],
    },
  ],
  porLancamento: [],
};

describe("o painel da pré-verificação", () => {
  it("⚠⚠ mostra o resumo e UMA LINHA POR REGRA — é o agrupamento que serve à correção em lote", () => {
    render(<VerificacaoDeLancamentos verificacao={RESPOSTA} />);
    expect(screen.getByText(/6 lançamentos a corrigir/)).toBeInTheDocument();
    expect(screen.getByText(/1 a conferir/)).toBeInTheDocument();
    expect(screen.getByText(/3× IRPJ\/CSLL fora da despesa tributária/)).toBeInTheDocument();
    expect(screen.getByText(/2× IRPJ\/CSLL sem contrapartida no passivo/)).toBeInTheDocument();
    expect(screen.getByText(/1× Movimento entre passivos/)).toBeInTheDocument();
  });

  it("⚠ o EXEMPLO com o conserto vai no title — o contador vê a conta esperada sem abrir nada", () => {
    render(<VerificacaoDeLancamentos verificacao={RESPOSTA} />);
    const linha = screen.getByText(/3× IRPJ\/CSLL fora da despesa tributária/);
    expect(linha.getAttribute("title")).toContain("4.1.1.03.*");
    expect(linha.getAttribute("title")).toContain("5.1.1.01.0002");
  });

  it("⚠⚠ o painel é ÂMBAR, nunca vermelho — vermelho nesta casa BLOQUEIA o fechamento", () => {
    const { container } = render(<VerificacaoDeLancamentos verificacao={RESPOSTA} />);
    const painel = container.firstChild;
    expect(painel).toHaveStyle({ border: "1px solid #FFB347" });
    expect(painel.getAttribute("style")).not.toContain("FF5757");
  });

  it("⚠ o que NÃO pôde ser conferido aparece — esconder faria a lista parecer completa", () => {
    render(<VerificacaoDeLancamentos verificacao={RESPOSTA} />);
    expect(screen.getByText(/36 lançamento\(s\) não puderam ser conferidos/)).toBeInTheDocument();
  });

  it("⚠⚠ SEM ACHADO NÃO DESENHA NADA — e não um painel dizendo 'tudo certo'", () => {
    const limpo = { ok: true, resumo: { total: 10, ok: 10, viola: 0, conferir: 0, indeterminado: 0 }, porRegra: [] };
    const { container } = render(<VerificacaoDeLancamentos verificacao={limpo} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("⚠ backend/mock sem a rota (verificacao nula) também não desenha — ausência é 'não perguntei'", () => {
    const { container } = render(<VerificacaoDeLancamentos verificacao={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("⚠ regra que a tela não conhece aparece com o id, e a contagem continua batendo", () => {
    const novo = {
      resumo: { viola: 2, conferir: 0, indeterminado: 0 },
      porRegra: [{ regraId: "F7.02", severidade: "ALERTA", n: 2, exemplos: [], lancamentos: [] }],
    };
    render(<VerificacaoDeLancamentos verificacao={novo} />);
    expect(screen.getByText(/2× F7\.02/)).toBeInTheDocument();
    expect(screen.getByText(/2 lançamentos a corrigir/)).toBeInTheDocument();
  });

  it("⚠ zero indeterminados não anuncia ausência de ausência", () => {
    const semIndet = { ...RESPOSTA, resumo: { ...RESPOSTA.resumo, indeterminado: 0 } };
    render(<VerificacaoDeLancamentos verificacao={semIndet} />);
    expect(screen.queryByText(/não puderam ser conferidos/)).toBeNull();
  });
});
