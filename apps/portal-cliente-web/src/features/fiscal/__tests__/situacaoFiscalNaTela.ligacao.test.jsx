// A TELA DE SITUAÇÃO FISCAL — a ligação.
//
// ⚠ Por que ligação, e não só regra: a regra (`lib/situacaoFiscalNaTela.js`) já é testada sozinha e
// continuaria verde com a tela chamando outra coisa, mostrando a tabela de outra empresa, ou
// oferecendo um botão de consultar. O que se mede aqui é o que a PÁGINA faz.

import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { api } from "../../../api";
import { SituacaoFiscalPage } from "../SituacaoFiscalPage";

const EMPRESA = { companyId: "pc-001", razao: "ACME SERVICOS LTDA", myRole: "OWNER" };

function relatorioComPendencia() {
  return {
    emitidoEm: "19/08/2026 13:42:10",
    contribuinte: { cnpj: "12.345.678/0001-90", nome: "ACME SERVICOS LTDA" },
    temTexto: true,
    naoInterpretado: [],
    diagnosticos: [
      {
        orgao: "Receita Federal",
        chave: "RFB",
        semPendencia: false,
        blocos: [
          {
            titulo: "Pendência - Débito (SIEF)",
            descricao: [],
            anotacoes: [],
            colunas: ["Receita", "Sdo. Dev. Cons.", "Situação"],
            registros: [
              { "Receita": "4406-01 - MAED - PGDAS-D", "Sdo. Dev. Cons.": "1.518,40", "Situação": "DEVEDOR" },
              { "Receita": "1099-01 - CP-SEGUR.", "Sdo. Dev. Cons.": "925,30", "Situação": "DEVEDOR" },
            ],
            naoInterpretado: [],
          },
        ],
      },
      { orgao: "Procuradoria-Geral da Fazenda Nacional", chave: "PGFN", semPendencia: true, blocos: [] },
    ],
  };
}

async function abrir(empresa = EMPRESA) {
  render(
    <StrictMode>
      <SituacaoFiscalPage empresa={empresa} />
    </StrictMode>
  );
  await act(async () => {});
}

afterEach(() => jest.restoreAllMocks());

describe("⚠⚠ NUNCA CONSULTADA NÃO É EM DIA — na tela", () => {
  test("empresa sem consulta não produz 'em dia' em lugar NENHUM da página", async () => {
    jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({
      ok: true, situacao: null, checkedAt: null, ultimoRelatorioEm: null, relatorio: null,
    });
    await abrir();

    expect(screen.getByText("Não consultada")).toBeInTheDocument();
    // ⚠ A varredura é do texto INTEIRO da página, não do chip: a afirmação errada poderia estar
    // numa legenda, num `title`, num rodapé — e o defeito é a AFIRMAÇÃO, não onde ela mora.
    expect(document.body.textContent).not.toMatch(/em dia|regular|sem pend[êe]ncia|nada consta/i);
    expect(document.querySelector('[data-situacao-fiscal="nao_consultada"]')).toBeTruthy();
  });

  test("⚠ e ela DIZ que isso não significa nem uma coisa nem outra", async () => {
    // Sem esta frase, "não consultada" se lê como problema — ou como tranquilidade, conforme o dia.
    jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({
      ok: true, situacao: null, checkedAt: null, ultimoRelatorioEm: null, relatorio: null,
    });
    await abrir();
    expect(screen.getByText(/não quer dizer que está tudo certo/i)).toBeInTheDocument();
  });

  test("⚠ estado DESCONHECIDO do servidor cai no mesmo lugar — a falha fecha", async () => {
    jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({
      ok: true, situacao: "ALGO_NOVO", checkedAt: null, ultimoRelatorioEm: null, relatorio: null,
    });
    await abrir();
    expect(screen.getByText("Não consultada")).toBeInTheDocument();
  });
});

describe("a situação apurada", () => {
  test("REGULAR aparece com a DATA — 'sem pendências' sem quando fala do presente", async () => {
    jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({
      ok: true,
      situacao: "REGULAR",
      checkedAt: "2026-08-20T16:20:00.000Z",
      ultimoRelatorioEm: "2026-08-20T16:20:00.000Z",
      relatorio: { diagnosticos: [{ orgao: "Receita Federal", chave: "RFB", semPendencia: true, blocos: [] }], naoInterpretado: [] },
    });
    await abrir();

    expect(screen.getByText("Sem pendências")).toBeInTheDocument();
    expect(screen.getByText(/Conferido pelo seu contador em/)).toBeInTheDocument();
  });

  test("COM_PENDENCIA mostra a tabela do bloco, com TODAS as colunas e o total somado", async () => {
    jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({
      ok: true,
      situacao: "COM_PENDENCIA",
      checkedAt: "2026-08-19T13:42:10.000Z",
      ultimoRelatorioEm: "2026-08-19T13:42:10.000Z",
      relatorio: relatorioComPendencia(),
    });
    await abrir();

    expect(screen.getByText("Com pendência")).toBeInTheDocument();
    for (const c of ["Receita", "Sdo. Dev. Cons.", "Situação"]) {
      expect(screen.getByRole("columnheader", { name: c })).toBeInTheDocument();
    }
    // 1.518,40 + 925,30 — e o rótulo diz que a soma é DA TELA.
    expect(screen.getByText("R$ 2.443,70")).toBeInTheDocument();
    expect(screen.getByText("Total (2 pendências)")).toBeInTheDocument();
    // O órgão sem pendência continua dizendo isso, no bloco dele.
    expect(screen.getByText("Nada consta")).toBeInTheDocument();
  });

  test("⚠ uma linha ilegível derruba o total do bloco — nunca uma dívida MENOR que a real", async () => {
    const rel = relatorioComPendencia();
    rel.diagnosticos[0].blocos[0].registros[1]["Sdo. Dev. Cons."] = "ilegível";
    jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({
      ok: true, situacao: "COM_PENDENCIA", checkedAt: null, ultimoRelatorioEm: null, relatorio: rel,
    });
    await abrir();

    expect(screen.queryByText(/^Total \(/)).toBeNull();
    // E as linhas continuam na tela: o que caiu foi a soma, não o dado.
    expect(screen.getByText("4406-01 - MAED - PGDAS-D")).toBeInTheDocument();
  });

  test("⚠ NADA SOME: bloco que não virou tabela aparece CRU, dizendo que não foi interpretado", async () => {
    const rel = relatorioComPendencia();
    rel.diagnosticos[0].blocos.push({
      titulo: "Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI)",
      descricao: ["SIMPLES NACIONAL - EM PARCELAMENTO"],
      anotacoes: [], colunas: [], registros: [], naoInterpretado: [],
    });
    jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({
      ok: true, situacao: "COM_PENDENCIA", checkedAt: null, ultimoRelatorioEm: null, relatorio: rel,
    });
    await abrir();

    expect(screen.getByText(/Não conseguimos organizar este trecho em tabela/i)).toBeInTheDocument();
    expect(screen.getByText("SIMPLES NACIONAL - EM PARCELAMENTO")).toBeInTheDocument();
  });
});

describe("⚠⚠ o que esta tela NÃO tem", () => {
  test("⚠⚠ NENHUM botão de consultar — a consulta é paga e o limite é por CONTRATANTE", async () => {
    jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({
      ok: true, situacao: "COM_PENDENCIA", checkedAt: null, ultimoRelatorioEm: null, relatorio: relatorioComPendencia(),
    });
    await abrir();

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/consultar|atualizar situação/i);
  });

  test("⚠ e NÃO manda o cliente conferir no PDF oficial — ele não tem o PDF", async () => {
    const rel = relatorioComPendencia();
    rel.naoInterpretado = ["Seção não encontrada no relatório: Receita Federal"];
    jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({
      ok: true, situacao: "COM_PENDENCIA", checkedAt: null, ultimoRelatorioEm: null, relatorio: rel,
    });
    await abrir();

    expect(document.body.textContent).not.toMatch(/PDF/i);
    expect(screen.getAllByText(/Fale com o seu contador/i).length).toBeGreaterThan(0);
  });

  test("⚠ estado conhecido SEM relatório guardado não vira tabela vazia sem explicação", async () => {
    jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({
      ok: true, situacao: "REGULAR", checkedAt: "2026-05-04T10:00:00.000Z", ultimoRelatorioEm: "2026-05-04T10:00:00.000Z", relatorio: null,
    });
    await abrir();
    expect(screen.getByText(/não ficou guardado/i)).toBeInTheDocument();
  });
});

describe("⚠⚠ o piso de papel — o relatório traz o quadro societário", () => {
  test("FINANCEIRO não vê, e a API NEM É CHAMADA", async () => {
    const espia = jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({ ok: true, situacao: "REGULAR" });
    await abrir({ ...EMPRESA, myRole: "FINANCEIRO" });

    expect(espia).not.toHaveBeenCalled();
    expect(screen.getByText(/Esta tela é de quem administra a empresa/i)).toBeInTheDocument();
    // ⚠ E diz o CONSERTO: pedir o papel a quem é proprietário.
    expect(screen.getByText(/Peça acesso de administrador/i)).toBeInTheDocument();
  });

  test("⚠ papel ausente também não vê — peso 0 não alcança CLIENT_ADMIN", async () => {
    const espia = jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({ ok: true, situacao: "REGULAR" });
    await abrir({ companyId: "pc-001", razao: "ACME" });
    expect(espia).not.toHaveBeenCalled();
  });

  test("CLIENT_ADMIN vê", async () => {
    const espia = jest.spyOn(api, "getSituacaoFiscal").mockResolvedValue({
      ok: true, situacao: "REGULAR", checkedAt: null, ultimoRelatorioEm: null, relatorio: null,
    });
    await abrir({ ...EMPRESA, myRole: "CLIENT_ADMIN" });
    expect(espia).toHaveBeenCalledWith("pc-001");
  });
});
