// O PAINEL DE CASAMENTOS E A VARREDURA — a ligação.
//
// ⚠ O que se prende aqui é o que só se vê montando: que a AMBIGUIDADE não ganha botão, que casar
// avisa não contabilizar, que a data-piso não nasce preenchida, e que o relatório da varredura sai
// inteiro. A regra tem teste próprio em `../../lib/__tests__/conferenciaTela.test.js`.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mockGetCasamentos = jest.fn();
const mockPostFundir = jest.fn();
const mockPostVarrer = jest.fn();

// ⚠ Delegação preguiçosa: o `jest.mock` é hoisted e os componentes chamam `createApiClient()` no
// corpo do módulo, antes de os `const` acima existirem.
jest.mock("../../../../api/client", () => ({
  createApiClient: () => ({
    getConferenciaCasamentos: (...a) => mockGetCasamentos(...a),
    postConferenciaFundir: (...a) => mockPostFundir(...a),
    postVarrerNotas: (...a) => mockPostVarrer(...a),
  }),
}));

import { ModalDaVarredura } from "../ModalDaVarredura";
import { PainelDeCasamentos } from "../PainelDeCasamentos";

const debito = (extra = {}) => ({
  id: "ofx-1",
  descricaoOriginal: "PAGTO KODA BEAR",
  valor: "890.00",
  dataPagamento: "2026-07-18",
  cnpjFornecedor: null,
  ...extra,
});
const nota = (extra = {}) => ({
  id: "dec-2",
  descricaoOriginal: "KODA BEAR",
  valor: "890.00",
  dataDocumento: "2026-07-05",
  cnpjFornecedor: "98765432000155",
  ...extra,
});

const comSugestao = {
  debito: debito(),
  sugestao: { nota: nota(), pista: "NOME_NO_MEMO", frase: "O nome do fornecedor aparece na descrição do banco." },
  candidatos: [{ nota: nota(), pista: "NOME_NO_MEMO", frase: "…" }],
  motivo: null,
  frase: "",
};
const ambiguo = {
  debito: debito({ id: "ofx-2", descricaoOriginal: "PAGTO MENSALIDADE", valor: "500.00" }),
  sugestao: null,
  candidatos: [
    { nota: nota({ id: "dec-7", descricaoOriginal: "MENSALIDADE ALFA", valor: "500.00" }), frase: "…" },
    { nota: nota({ id: "dec-8", descricaoOriginal: "MENSALIDADE BETA", valor: "500.00" }), frase: "…" },
  ],
  motivo: "ambiguo",
  frase: "Mais de uma nota se parece com este débito. O sistema não escolhe entre elas — confira qual é a certa.",
};
const semNota = {
  debito: debito({ id: "ofx-3", descricaoOriginal: "TARIFA", valor: "175.00" }),
  sugestao: null,
  candidatos: [],
  motivo: "nenhum_candidato",
  frase: "Nenhuma nota recebida em aberto se parece com este débito.",
};

const responder = (linhas) =>
  mockGetCasamentos.mockResolvedValue({ ok: true, linhas, totalDebitos: linhas.length, totalNotas: 4 });

beforeEach(() => {
  jest.clearAllMocks();
  mockPostFundir.mockResolvedValue({ ok: true });
  mockPostVarrer.mockResolvedValue({ ok: true, varridas: 18, criados: 12, jaExistiam: 4, fora: [], recusados: [] });
});

describe("⚠⚠ AMBIGUIDADE NÃO GANHA BOTÃO", () => {
  it("com sugestão única, o botão Casar existe", async () => {
    responder([comSugestao]);
    render(<PainelDeCasamentos companyId="emp-1" />);
    expect(await screen.findByRole("button", { name: /^Casar$/ })).toBeEnabled();
  });

  it("⚠⚠ com DOIS candidatos NÃO existe botão nenhum de casar", async () => {
    // Um "casar" ao lado de cada candidato converteria a recusa do sistema em decisão do dedo de
    // quem está com pressa — e põe a despesa no fornecedor errado, em silêncio.
    responder([ambiguo]);
    render(<PainelDeCasamentos companyId="emp-1" />);
    await screen.findAllByText(/Mais de uma nota/);
    expect(screen.queryByRole("button", { name: /^Casar$/ })).toBeNull();
  });

  it("⚠ mas os DOIS candidatos aparecem — a ambiguidade é mostrada, não escondida", async () => {
    responder([ambiguo]);
    render(<PainelDeCasamentos companyId="emp-1" />);
    expect(await screen.findByText(/MENSALIDADE ALFA/)).toBeInTheDocument();
    expect(screen.getByText(/MENSALIDADE BETA/)).toBeInTheDocument();
  });

  it("⚠ débito sem candidato nenhum diz isso, e não é pintado de pendência", async () => {
    responder([semNota]);
    const { container } = render(<PainelDeCasamentos companyId="emp-1" />);
    expect(await screen.findByText(/Sem nota correspondente/)).toBeInTheDocument();
    // ⚠ Débito sem nota é comum e legítimo — âmbar ali encheria a tela de pendência falsa.
    expect(container.textContent).not.toMatch(/erro|falha/i);
  });

  it("⚠ quem não pode escrever vê o botão desabilitado, com o motivo", async () => {
    responder([comSugestao]);
    render(<PainelDeCasamentos companyId="emp-1" podeEscrever={false} />);
    const botao = await screen.findByRole("button", { name: /^Casar$/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/perfil/i));
  });
});

describe("⚠⚠ O PAINEL SOME quando não há nada a casar", () => {
  it("lista vazia não renderiza bloco nenhum", async () => {
    // Um bloco permanente dizendo "nada a casar" seria ruído na maioria das empresas — as que nunca
    // importaram extrato.
    responder([]);
    const { container } = render(<PainelDeCasamentos companyId="emp-1" />);
    await waitFor(() => expect(mockGetCasamentos).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).not.toMatch(/Débitos do extrato/));
  });
});

describe("⚠⚠ CASAR AVISA QUE NÃO CONTABILIZA", () => {
  it("a confirmação repete os DOIS lados e diz que não cria lançamento", async () => {
    responder([comSugestao]);
    render(<PainelDeCasamentos companyId="emp-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Casar$/ }));

    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/DÉBITO DO EXTRATO/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/NOTA RECEBIDA/)).toBeInTheDocument();
    // ⚠⚠ Sem esta frase o contador acha que o lançamento saiu e não confere a fila depois.
    expect(within(dialogo).getByText(/não cria lançamento contábil/i)).toBeInTheDocument();
  });

  it("confirmar manda o par certo e avisa quem chamou", async () => {
    responder([comSugestao]);
    const aoCasar = jest.fn();
    render(<PainelDeCasamentos companyId="emp-1" aoCasar={aoCasar} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Casar$/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Casar$/ }));

    await waitFor(() => expect(mockPostFundir).toHaveBeenCalledWith("emp-1", {
      declaradoOfxId: "ofx-1",
      declaradoNotaId: "dec-2",
    }));
    // ⚠ A FILA também mudou — sem avisar, a nota continuaria "sem pagamento identificado" ao lado.
    await waitFor(() => expect(aoCasar).toHaveBeenCalled());
  });

  it("⚠⚠ a recusa do servidor APARECE — a sugestão pode ter envelhecido", async () => {
    responder([comSugestao]);
    mockPostFundir.mockRejectedValue(new Error("Este débito não confere mais com esta nota."));
    render(<PainelDeCasamentos companyId="emp-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Casar$/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Casar$/ }));
    expect(await screen.findByText(/não confere mais/i)).toBeInTheDocument();
  });

  it("⚠ a PISTA aparece — 'por que o sistema acha que é esta?'", async () => {
    responder([comSugestao]);
    render(<PainelDeCasamentos companyId="emp-1" />);
    expect(await screen.findByText(/O nome do fornecedor aparece na descrição do banco/)).toBeInTheDocument();
  });
});

describe("⚠⚠ A VARREDURA — a data-piso não nasce preenchida", () => {
  const montar = (props = {}) => render(<ModalDaVarredura companyId="emp-1" aoFechar={jest.fn()} {...props} />);

  it("⚠⚠ o campo nasce VAZIO e o botão nasce desabilitado, com o motivo", () => {
    // Sugerir "o primeiro dia do mês" pareceria prestativo e seria a TELA decidindo o volume de
    // trabalho — o que a obrigatoriedade existe para impedir.
    montar();
    expect(screen.getByLabelText(/Trazer notas emitidas a partir de/i)).toHaveValue("");
    const botao = screen.getByRole("button", { name: /^Varrer$/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/escolha a data/i));
    expect(mockPostVarrer).not.toHaveBeenCalled();
  });

  it("⚠ o diálogo explica POR QUE a data é obrigatória", () => {
    montar();
    expect(screen.getByText(/não é uma fila|toda a base de notas recebidas entraria de uma vez/i)).toBeInTheDocument();
  });

  it("⚠ e avisa que nada vira lançamento", () => {
    montar();
    expect(screen.getByText(/sem lançamento contábil/i)).toBeInTheDocument();
  });

  it("com data válida, varre e mostra o relatório INTEIRO", async () => {
    mockPostVarrer.mockResolvedValue({
      ok: true, varridas: 18, criados: 12, jaExistiam: 4,
      fora: [{ notaId: "n-1" }],
      recusados: [{ notaId: "n-2", motivo: "sem_valor" }],
    });
    montar();
    fireEvent.change(screen.getByLabelText(/a partir de/i), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: /^Varrer$/ }));

    expect(await screen.findByText(/12/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/18 nota\(s\) olhadas/)).toBeInTheDocument());
    expect(screen.getByText(/4 já estavam na fila/)).toBeInTheDocument();
    // ⚠ NADA SOME EM SILÊNCIO: a nota sem valor aparece com o motivo (62 delas na base real).
    expect(screen.getByText(/não tem valor/i)).toBeInTheDocument();
  });

  it("⚠⚠ '0 novas' é a IDEMPOTÊNCIA funcionando, e a tela DIZ isso", async () => {
    // Sem esta frase o contador roda três vezes achando que não funcionou.
    mockPostVarrer.mockResolvedValue({ ok: true, varridas: 12, criados: 0, jaExistiam: 12, fora: [], recusados: [] });
    montar();
    fireEvent.change(screen.getByLabelText(/a partir de/i), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: /^Varrer$/ }));
    expect(await screen.findByText(/Varrer de novo não duplica nada/i)).toBeInTheDocument();
  });

  it("⚠ 'nada varrido' propõe o conserto certo: uma data anterior", async () => {
    mockPostVarrer.mockResolvedValue({ ok: true, varridas: 0, criados: 0, jaExistiam: 0, fora: [], recusados: [] });
    montar();
    fireEvent.change(screen.getByLabelText(/a partir de/i), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: /^Varrer$/ }));
    expect(await screen.findByText(/tente uma data anterior/i)).toBeInTheDocument();
  });

  it("⚠ a data vai CRUA para o servidor, no formato que a rota aceita", async () => {
    montar();
    fireEvent.change(screen.getByLabelText(/a partir de/i), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: /^Varrer$/ }));
    await waitFor(() => expect(mockPostVarrer).toHaveBeenCalledWith("emp-1", "2026-07-01"));
  });

  it("⚠ o erro do servidor aparece, e o botão continua disponível", async () => {
    mockPostVarrer.mockRejectedValue(new Error("data_piso_invalida"));
    montar();
    fireEvent.change(screen.getByLabelText(/a partir de/i), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: /^Varrer$/ }));
    expect(await screen.findByText(/data_piso_invalida/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Varrer$/ })).toBeEnabled();
  });
});
