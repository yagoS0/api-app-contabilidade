// A LIGAÇÃO DA TELA DE EXTRATO — a regra tem teste próprio (`lib/__tests__/relatorioDoExtrato`);
// o que se prende aqui é o que só se vê montando.
//
// ⚠⚠ O CAMPO DO `FormData` É `file`, NÃO `arquivo`. O lote usa `arquivo`, e copiar aquela linha
// verbatim devolve `400 file_required`. Isso é medido no par mock/real, não aqui — aqui se mede que
// a tela CHAMA a função certa com o arquivo certo.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ExtratoOfxPage } from "../ExtratoOfxPage";

// ⚠⚠ SÓ `companyId`, como o objeto REAL de `GET /client/companies`. A fixture trazia `id`
// também, e por isso o teste passou enquanto a tela lia o campo errado — o defeito só apareceu no
// navegador. Fixture mais generosa que o dado real é uma rede com o buraco no meio.
const EMPRESA = { companyId: "pc-001", nome: "Empresa Teste" };

const relatorio = (extra = {}) => ({
  importId: "imp-1",
  conta: { acctId: "12345-6", bankId: "001" },
  transacoesLidas: 23,
  criados: 20,
  jaImportadas: 3,
  descartadas: [],
  descartadasTotal: 0,
  descartadasTruncadas: false,
  foraDoEscopo: 7,
  recusadas: [],
  anomalias: [],
  arquivoJaImportado: null,
  ...extra,
});

const arquivoOfx = (nome = "extrato.ofx") =>
  new File(["OFXHEADER:100"], nome, { type: "text/plain" });

const montar = (api) => render(<ExtratoOfxPage empresa={EMPRESA} api={api} aoVoltar={() => {}} />);

const escolherArquivo = (nome) => {
  const campo = screen.getByLabelText(/Arquivo do extrato/i);
  fireEvent.change(campo, { target: { files: [arquivoOfx(nome)] } });
  return campo;
};

describe("⚠ o envio", () => {
  it("⚠⚠ o botão nasce DESABILITADO e diz por quê — sem arquivo não há o que enviar", () => {
    montar({ importarExtratoOfx: jest.fn() });
    const botao = screen.getByRole("button", { name: /Enviar extrato/i });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/Escolha o arquivo/i));
  });

  it("manda o arquivo escolhido para a empresa ativa", async () => {
    const importar = jest.fn(async () => relatorio());
    montar({ importarExtratoOfx: importar });
    escolherArquivo();
    fireEvent.click(screen.getByRole("button", { name: /Enviar extrato/i }));
    await waitFor(() => expect(importar).toHaveBeenCalled());
    const [companyId, arquivo] = importar.mock.calls[0];
    expect(companyId).toBe("pc-001");
    expect(arquivo.name).toBe("extrato.ofx");
  });

  it("⚠ depois do sucesso o campo esvazia — deixá-lo cheio convida ao segundo clique", async () => {
    montar({ importarExtratoOfx: jest.fn(async () => relatorio()) });
    escolherArquivo();
    fireEvent.click(screen.getByRole("button", { name: /Enviar extrato/i }));
    await screen.findByText(/despesas novas na fila/i);
    expect(screen.getByRole("button", { name: /Enviar extrato/i })).toBeDisabled();
  });
});

describe("⚠⚠ as três linhas obrigatórias chegam na tela", () => {
  const abrir = async (extra) => {
    montar({ importarExtratoOfx: jest.fn(async () => relatorio(extra)) });
    escolherArquivo();
    fireEvent.click(screen.getByRole("button", { name: /Enviar extrato/i }));
    return screen.findByText(/despesas novas na fila/i);
  };

  it("as três aparecem", async () => {
    await abrir();
    expect(screen.getByText(/despesas novas na fila/i)).toBeInTheDocument();
    expect(screen.getByText(/já estavam importadas/i)).toBeInTheDocument();
    expect(screen.getByText(/entradas \(créditos\)/i)).toBeInTheDocument();
  });

  it("⚠⚠ a frase da SOBREPOSIÇÃO aparece — sem ela, reenviar se lê como falha", async () => {
    await abrir();
    expect(screen.getByText(/Períodos que se sobrepõem são normais/i)).toBeInTheDocument();
  });

  it("⚠⚠ os créditos são NOMEADOS", async () => {
    await abrir();
    expect(screen.getByText(/Só as saídas viram despesa/i)).toBeInTheDocument();
  });
});

describe("⚠⚠ `descartadasTotal` — 'pelo menos N', nunca N", () => {
  const abrirCom = async (extra) => {
    montar({ importarExtratoOfx: jest.fn(async () => relatorio(extra)) });
    escolherArquivo();
    fireEvent.click(screen.getByRole("button", { name: /Enviar extrato/i }));
    return screen.findByText(/despesas novas na fila/i);
  };

  it("⚠⚠ com o total, a tela mostra o NÚMERO REAL — não o tamanho da amostra", async () => {
    await abrirCom({
      descartadas: Array.from({ length: 50 }, (_, i) => ({ motivo: "sem_data", fitId: `X${i}` })),
      descartadasTotal: 145634,
      descartadasTruncadas: true,
    });
    // ⚠ é o defeito que motivou o campo: a tela diria "50" num arquivo com 145 mil blocos inválidos
    expect(screen.getByText("145634")).toBeInTheDocument();
    expect(screen.getByText(/Mostrando as 50 primeiras de 145634/i)).toBeInTheDocument();
  });

  it("⚠⚠ SEM o total, a tela escreve PELO MENOS — nunca um número com cara de final", async () => {
    const r = relatorio({ descartadas: [{ motivo: "sem_data", fitId: "A" }] });
    delete r.descartadasTotal;
    montar({ importarExtratoOfx: jest.fn(async () => r) });
    escolherArquivo();
    fireEvent.click(screen.getByRole("button", { name: /Enviar extrato/i }));
    await screen.findByText(/despesas novas na fila/i);
    expect(screen.getByText(/pelo menos 1/i)).toBeInTheDocument();
  });

  it("⚠ o que não deu para ler sai NOMEADO, com o motivo", async () => {
    await abrirCom({
      descartadas: [{ motivo: "sem_data", fitId: "B7", dtPosted: null, trnAmt: "-1500.00" }],
      descartadasTotal: 1,
    });
    expect(screen.getByText("sem_data")).toBeInTheDocument();
    expect(screen.getByText("-1500.00")).toBeInTheDocument();
  });
});

describe("⚠⚠ '0 novas' nunca fica sozinho", () => {
  it("tudo já importado diz que é o ESPERADO", async () => {
    montar({
      importarExtratoOfx: jest.fn(async () => relatorio({ criados: 0, jaImportadas: 23 })),
    });
    escolherArquivo();
    fireEvent.click(screen.getByRole("button", { name: /Enviar extrato/i }));
    expect(await screen.findByText(/já tinham sido importadas/i)).toBeInTheDocument();
  });

  it("⚠ o ARQUIVO repetido tem frase própria — a que só o hash permite", async () => {
    montar({
      importarExtratoOfx: jest.fn(async () =>
        relatorio({ criados: 0, jaImportadas: 23, arquivoJaImportado: { em: "2026-07-10T15:00:00.000Z" } }),
      ),
    });
    escolherArquivo();
    fireEvent.click(screen.getByRole("button", { name: /Enviar extrato/i }));
    expect(await screen.findByText(/já tinha sido enviado em 10\/07\/2026/i)).toBeInTheDocument();
  });
});

describe("⚠⚠ a recusa do servidor CHEGA — com o conserto", () => {
  it("⚠⚠ o 413 mostra o texto do servidor, que diz para dividir o período", async () => {
    const erro = Object.assign(new Error("O extrato passa de 10 MB. Baixe o arquivo em períodos menores e envie um de cada vez."), {
      status: 413,
      code: "arquivo_grande_demais",
    });
    montar({ importarExtratoOfx: jest.fn(async () => { throw erro; }) });
    escolherArquivo("gigante.ofx");
    fireEvent.click(screen.getByRole("button", { name: /Enviar extrato/i }));
    expect(await screen.findByText(/períodos menores/i)).toBeInTheDocument();
  });

  it("⚠ escolher outro arquivo LIMPA o erro anterior", async () => {
    const erro = Object.assign(new Error("O extrato passa de 10 MB."), { status: 413, code: "arquivo_grande_demais" });
    montar({ importarExtratoOfx: jest.fn(async () => { throw erro; }) });
    escolherArquivo("gigante.ofx");
    fireEvent.click(screen.getByRole("button", { name: /Enviar extrato/i }));
    await screen.findByText(/10 MB/i);
    escolherArquivo("menor.ofx");
    expect(screen.queryByText(/10 MB/i)).toBeNull();
  });
});

describe("⚠⚠ a tela não promete o que não faz", () => {
  it("⚠⚠ NÃO oferece conferir antes de enviar — não existe preview, o POST já grava", () => {
    const { container } = montar({ importarExtratoOfx: jest.fn() });
    expect(container.textContent).not.toMatch(/conferir antes|pré-visualiz|revisar antes/i);
    // e diz o que é verdade: reenviar é seguro
    expect(container.textContent).toMatch(/não há uma etapa de conferência antes/i);
  });

  it("⚠⚠ diz que NADA é lançado automaticamente", () => {
    const { container } = montar({ importarExtratoOfx: jest.fn() });
    expect(container.textContent).toMatch(/quem decide a conta contábil é o contador/i);
  });

  it("⚠ e repete isso DEPOIS do envio, junto do resultado", async () => {
    montar({ importarExtratoOfx: jest.fn(async () => relatorio()) });
    escolherArquivo();
    fireEvent.click(screen.getByRole("button", { name: /Enviar extrato/i }));
    expect(await screen.findByText(/Nada foi lançado ainda/i)).toBeInTheDocument();
  });

  it("⚠ o único botão além de Voltar é o de enviar — esta tela não escreve contabilidade", () => {
    montar({ importarExtratoOfx: jest.fn() });
    const rotulos = screen.getAllByRole("button").map((b) => b.textContent.trim());
    expect(rotulos.sort()).toEqual(["Enviar extrato", "Voltar"]);
  });
});

describe("⚠ a conta bancária", () => {
  it("⚠⚠ sem o número da conta, o aviso diz a CONSEQUÊNCIA", async () => {
    montar({
      importarExtratoOfx: jest.fn(async () => relatorio({ conta: { acctId: null, bankId: "001" } })),
    });
    escolherArquivo();
    fireEvent.click(screen.getByRole("button", { name: /Enviar extrato/i }));
    expect(await screen.findByText(/mesmo valor no mesmo dia/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ OS AVISOS DO DEDUPE E AS RECUSADAS — que somiam da tela, achados por agente adversarial.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ nada some em silêncio", () => {
  const enviarCom = async (extra) => {
    montar({ importarExtratoOfx: jest.fn(async () => relatorio(extra)) });
    escolherArquivo();
    fireEvent.click(screen.getByRole("button", { name: /Enviar extrato/i }));
    return screen.findByText(/O que entrou/i);
  };

  it("⚠⚠ `fitid_repetido` APARECE — ele significa possível duplicata na fila do contador", async () => {
    await enviarCom({
      anomalias: [{ codigo: "fitid_repetido", n: 5, frase: "O banco repetiu o mesmo identificador." }],
    });
    expect(screen.getByText(/O banco repetiu o mesmo identificador/i)).toBeInTheDocument();
  });

  it("⚠⚠ `sem_fitid` APARECE — é a EXCEÇÃO à promessa de que reenviar é seguro", async () => {
    await enviarCom({
      anomalias: [{ codigo: "sem_fitid", n: 17, frase: "Duas iguais no mesmo dia continuam entrando as duas." }],
    });
    expect(screen.getByText(/Duas iguais no mesmo dia/i)).toBeInTheDocument();
  });

  it("⚠ o `n` do servidor sai junto — 'estas transações' sem número não deixa decidir nada", async () => {
    await enviarCom({
      anomalias: [{ codigo: "sem_fitid", n: 17, frase: "Sem identificador do banco." }],
    });
    expect(screen.getByText(/17 transações/i)).toBeInTheDocument();
  });

  it("⚠⚠ as RECUSADAS saem com o MOTIVO, não só um número em âmbar", async () => {
    await enviarCom({
      criados: 0,
      recusadas: [{ motivo: "sem_conta", frase: "A conta de destino não existe.", historico: "PAGTO ALUGUEL" }],
    });
    expect(screen.getByText(/A conta de destino não existe/i)).toBeInTheDocument();
    expect(screen.getByText("PAGTO ALUGUEL")).toBeInTheDocument();
  });

  it("⚠⚠ o MOTIVO do descarte é a FRASE, não o código cru", async () => {
    await enviarCom({
      descartadas: [{ motivo: "sem_data", frase: "A transação não traz data de lançamento (DTPOSTED).", trnAmt: "-10.00" }],
      descartadasTotal: 1,
    });
    expect(screen.getByText(/não traz data de lançamento/i)).toBeInTheDocument();
    // ⚠ o código cru NÃO chega ao olho do cliente
    expect(screen.queryByText("sem_data")).toBeNull();
  });
});
