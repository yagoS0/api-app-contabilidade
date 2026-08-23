// AS NOTAS DE COMPRA APARECEM — os dois defeitos que as escondiam, travados.
//
// Medido em produção em 23/08/2026, e é o que dá o peso a este arquivo:
//   • 47 NF-e na base, **todas `papel: "DEST"`** (compras) e **nenhuma com `xmlRaw`**;
//   • as 3 — e únicas — empresas com NF-e (SINTROPIA 34, LENTE 11, ALBATROZ 2) **não têm
//     inscrição estadual**, porque RECEBER NF-e não exige IE (emitir é que exige);
//   • a única empresa com IE (VAGALO) tem **zero** NF-e.
//
// Ou seja, os dois defeitos se somavam para o mesmo resultado: a janela de NF-e aparecia
// exatamente para quem não tinha nota de compra e sumia exatamente para quem tinha — e, quando
// aparecia, vinha vazia porque o papel estava em EMIT.
//
// ⚠ Se algum destes testes ficar vermelho, a pergunta não é "como faço passar": é se as notas de
// compra voltaram a ficar invisíveis para o contador.

import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotasFiscaisTab } from "../renderNotasFiscaisTab";

// Uma NF-e de COMPRA como as da produção: sem XML, sem itens, com emitente/valor/data/chave.
const NFE_COMPRA = {
  id: "nfe-1",
  type: "NFE",
  papel: "DEST",
  numero: "12345",
  serie: "1",
  chaveAcesso: "33260812345678000199550010000123451000123456",
  issueDate: "2026-08-10T00:00:00.000Z",
  total: "1500.00",
  emitenteNome: "FORNECEDOR DE MERCADORIA LTDA",
  emitenteDoc: "12345678000199",
  tomadorNome: "SINTROPIA TECNOLOGIA LTDA",
  statusEfetivo: "autorizada",
};

const NFSE_RECEBIDA = {
  ...NFE_COMPRA,
  id: "nfse-1",
  type: "NFSE",
  numero: "77",
  emitenteNome: "PRESTADOR DE SERVICO LTDA",
};

function montar(overrides = {}) {
  const setNotasFilters = jest.fn();
  const notasPanel = {
    loading: false,
    error: null,
    reload: jest.fn(),
    dfeState: null, dfeSyncing: false, syncDfe: jest.fn(), clearDfeError: jest.fn(),
    adnState: null, adnSyncing: false, syncAdn: jest.fn(), clearAdnError: jest.fn(),
    companyId: "empresa-1",
    notas: [NFE_COMPRA, NFSE_RECEBIDA],
    notasTotal: 1,
    // O padrão do hook: papel EMIT, que é o que esvaziava a janela de NF-e.
    notasFilters: { papel: "EMIT", type: "NFSE", competencia: "2026-08", search: "", cfop: "", servico: "", incluirCanceladas: "", limit: 100, offset: 0 },
    setNotasFilters,
    notasSummary: { ano: 2026, totals: { totalNotas: 2, totalEmitido: 0, totalRecebido: 1500, countNfe: 1, countNfse: 1, countCanceladas: 0 } },
    // O resumo NOVO: `papel: "DEST"`, sem `type` — as duas espécies recebidas.
    notasRecebidas: { ano: 2026, totals: { totalNotas: 2, totalEmitido: 0, totalRecebido: 2500, countNfe: 34, countNfse: 248, countCanceladas: 0 } },
    loadingNotas: false, loadNotas: jest.fn(),
    importing: false, importNotas: jest.fn(),
    marcarNotaStatus: jest.fn(),
    notaAbertaId: null, notaAberta: null, notaLoading: false, notaError: null,
    abrirNota: jest.fn(), fecharNota: jest.fn(),
    ...overrides,
  };
  render(<NotasFiscaisTab notasPanel={notasPanel} competencia="2026-08" />);
  return { setNotasFilters, notasPanel };
}

describe("as notas de compra (NF-e) aparecem para quem as tem", () => {
  // ── DEFEITO 1: a janela sumia sem inscrição estadual ─────────────────────────────────────────
  it("a janela de NF-e existe SEM inscrição estadual — a aba nem recebe mais essa informação", () => {
    montar();
    // Nenhuma prop de IE é passada, e a janela tem de estar lá assim mesmo.
    expect(screen.getByRole("button", { name: /Notas de compra \(NF-e\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Notas de serviço \(NFS-e\)/i })).toBeInTheDocument();
  });

  // ── DEFEITO 2: a janela abria vazia porque o papel ficava em EMIT ────────────────────────────
  it("entrar na janela de NF-e leva o papel para DEST — senão ela lista zero linhas", () => {
    const { setNotasFilters } = montar();

    fireEvent.click(screen.getByRole("button", { name: /Notas de compra \(NF-e\)/i }));

    // ⚠ Os DOIS campos no MESMO patch: em duas chamadas haveria uma carga intermediária
    // (NF-e + EMIT), que é justamente a consulta vazia que o conserto evita.
    expect(setNotasFilters).toHaveBeenCalledWith(
      expect.objectContaining({ type: "NFE", papel: "DEST", offset: 0 }),
    );
  });

  it("voltar para NFS-e NÃO força o papel — a escolha de quem estava em Recebidas sobrevive", () => {
    const { setNotasFilters } = montar({
      notasFilters: { papel: "EMIT", type: "NFE", competencia: "2026-08", search: "", cfop: "", servico: "", incluirCanceladas: "", limit: 100, offset: 0 },
    });

    fireEvent.click(screen.getByRole("button", { name: /Notas de serviço \(NFS-e\)/i }));

    expect(setNotasFilters).toHaveBeenCalledWith(
      expect.objectContaining({ type: "NFSE", papel: "EMIT" }),
    );
  });
});

describe("o total de notas recebidas — duas espécies, contadas separadas e somadas com rótulo", () => {
  it("mostra cada espécie com o próprio número", () => {
    montar();
    const bloco = screen.getByRole("region", { name: /Notas recebidas pela empresa/i });

    expect(within(bloco).getByText(/Serviço \(NFS-e\)/i)).toBeInTheDocument();
    expect(within(bloco).getByText("248")).toBeInTheDocument();
    expect(within(bloco).getByText(/Compra \(NF-e\)/i)).toBeInTheDocument();
    expect(within(bloco).getByText("34")).toBeInTheDocument();
  });

  it("a SOMA aparece e DIZ que soma espécies diferentes", () => {
    montar();
    const bloco = screen.getByRole("region", { name: /Notas recebidas pela empresa/i });

    // 248 + 34
    expect(within(bloco).getByText("282")).toBeInTheDocument();
    // ⚠ O rótulo é a metade que importa: "282" sozinho soma nota de mercadoria com nota de
    // serviço, que vão para contas diferentes e não respondem à mesma pergunta fiscal.
    expect(within(bloco).getByText(/espécies somadas/i)).toBeInTheDocument();
  });

  it("clicar numa espécie abre a janela dela JÁ em Recebidas — é assim que o número se confere", () => {
    const { setNotasFilters } = montar();
    const bloco = screen.getByRole("region", { name: /Notas recebidas pela empresa/i });

    fireEvent.click(within(bloco).getByRole("button", { name: /Compra \(NF-e\)/i }));
    expect(setNotasFilters).toHaveBeenCalledWith(
      expect.objectContaining({ type: "NFE", papel: "DEST", offset: 0 }),
    );

    fireEvent.click(within(bloco).getByRole("button", { name: /Serviço \(NFS-e\)/i }));
    // ⚠ Aqui o papel é FORÇADO a DEST mesmo indo para a NFS-e: o número clicado é de recebidas,
    // e abrir a lista em "Emitidas" faria a tela contradizer a caixa que o contador acabou de
    // clicar. É o caso que o `papelForcado` existe para cobrir.
    expect(setNotasFilters).toHaveBeenCalledWith(
      expect.objectContaining({ type: "NFSE", papel: "DEST", offset: 0 }),
    );
  });
});

describe("nota recebida não se cancela", () => {
  it("em Recebidas, a coluna 'Marcar como cancelada' NÃO é oferecida", () => {
    // ⚠ `type: "NFSE"` porque a janela nasce em NFS-e — e a linha PRECISA estar na tela para o
    // teste valer. Sem a linha, "o botão não existe" passaria por lista vazia, e o teste diria
    // que a porta está fechada quando ela só não tinha sido aberta.
    montar({
      notas: [NFSE_RECEBIDA],
      notasFilters: { papel: "DEST", type: "NFSE", competencia: "2026-08", search: "", cfop: "", servico: "", incluirCanceladas: "", limit: 100, offset: 0 },
    });

    expect(screen.getByText(/PRESTADOR DE SERVICO LTDA/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Marcar como cancelada/i })).not.toBeInTheDocument();
  });

  it("em Emitidas o botão continua existindo — o corte é do papel, não da funcionalidade", () => {
    montar({
      notas: [{ ...NFSE_RECEBIDA, papel: "EMIT" }],
      notasFilters: { papel: "EMIT", type: "NFSE", competencia: "2026-08", search: "", cfop: "", servico: "", incluirCanceladas: "", limit: 100, offset: 0 },
    });

    expect(screen.getByRole("button", { name: /Marcar como cancelada/i })).toBeInTheDocument();
  });
});

describe("a linha de NF-e sem XML não some — e não promete o que não tem", () => {
  it("a nota de compra é listada mesmo sem xmlRaw", () => {
    montar({
      notas: [NFE_COMPRA],
      notasFilters: { papel: "DEST", type: "NFE", competencia: "2026-08", search: "", cfop: "", servico: "", incluirCanceladas: "", limit: 100, offset: 0 },
    });

    // ⚠ QUEM DECIDE O QUE A TABELA MOSTRA É A JANELA (estado local), não `notasFilters.type` — o
    // effect sincroniza o filtro A PARTIR da janela. Por isso é preciso ENTRAR na janela de NF-e;
    // montar com `type: "NFE"` e a janela em NFS-e é um estado que a tela nunca produz sozinha.
    fireEvent.click(screen.getByRole("button", { name: /Notas de compra \(NF-e\)/i }));

    // ⚠ 47 de 47 NF-e da base são resumo (`resNFe`), sem XML e sem itens. Sumir com a linha por
    // isso esconderia a compra inteira; o que falta é dito no detalhe da nota
    // (`BlocoXml`/`podeGerarDanfse`), não com a ausência da linha.
    expect(screen.getByText(/FORNECEDOR DE MERCADORIA LTDA/i)).toBeInTheDocument();
  });
});
