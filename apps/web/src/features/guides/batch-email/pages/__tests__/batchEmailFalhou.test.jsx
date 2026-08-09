// A MATRIZ DO ENVIO EM LOTE PRECISA SEPARAR "FALHOU" DE "AINDA NÃO TENTEI".
//
// ⚠ POR QUE ESTE TESTE EXISTE
// `GuideStatusCell` pintava PENDING, ERROR e `null` tudo como "📄 guia". O `emailStatus` já chegava
// no payload e era descartado aqui — então a única tela em que o contador decide o que enviar
// mostrava a guia cujo envio FALHOU exatamente como a que está esperando a vez.
//
// Isso importa porque nada drena `emailNextRetryAt`: o laço automático saiu na Q55 ("nada roda
// sozinho"). A guia em ERROR fica em ERROR até alguém, por acaso, clicar de novo — e o único lugar
// que poderia avisar mostrava-a como rotina normal.
//
// Regras que ficam travadas aqui:
//   1. célula própria, com ícone próprio e o MOTIVO no `title`;
//   2. a linha continua SELECIONÁVEL (o envio manual alcança ERROR — a mudança é de exibição, não
//      de elegibilidade);
//   3. o aviso agregado no topo, porque uma célula vermelha no meio de oito colunas e trinta linhas
//      não é um aviso — e sem falha ele não aparece (aviso permanente vira paisagem).
import { render, screen, fireEvent } from "@testing-library/react";
import { BatchEmailPage } from "../renderBatchEmailPage.jsx";

function linha(over = {}) {
  return {
    portalClientId: "c1",
    razao: "ACME LTDA",
    cnpj: "11.111.111/0001-11",
    regimeTributario: "SIMPLES",
    competencia: "2026-07",
    tiposGuias: { DAS: null, INSS: null, IRPJ: null, CSLL: null, PIS_COFINS: null, ISS: null, FGTS: null, PARC_DAS: null },
    pendingGuideIds: [],
    ...over,
  };
}

const CELULA_FALHOU = {
  guideId: "g1", valor: 1234.56, vazio: false,
  emailStatus: "ERROR", falhou: true, emailAttempts: 2,
  emailLastError: "connect ETIMEDOUT smtp.gmail.com:465",
};
const CELULA_PENDENTE = { guideId: "g2", valor: 500, vazio: false, emailStatus: "PENDING" };

/**
 * A célula da TABELA, não a da legenda.
 *
 * ⚠ A legenda do rodapé repete os mesmos rótulos ("📄 guia", "✖ falhou") de propósito — é ela que
 * explica o que cada símbolo quer dizer. Uma busca por texto solto casa com as duas e o teste
 * passaria mesmo com a coluna vazia, verificando só a legenda.
 */
function celula(texto) {
  const achados = screen.getAllByText(texto).filter((el) => el.tagName === "TD");
  return achados.length === 1 ? achados[0] : achados;
}
function semCelula(texto) {
  return screen.queryAllByText(texto).filter((el) => el.tagName === "TD");
}

function renderPagina(rows, props = {}) {
  return render(
    <BatchEmailPage
      report={{ competencia: "2026-07", simples: rows, presumidos: [], outros: [], competenciasPresentes: ["2026-07"] }}
      loading={false}
      sending={false}
      onLoad={jest.fn()}
      onSend={jest.fn()}
      onBack={jest.fn()}
      {...props}
    />,
  );
}

describe("célula da guia que falhou", () => {
  test("não se confunde com '📄 guia'", () => {
    renderPagina([linha({ tiposGuias: { ...linha().tiposGuias, DAS: CELULA_FALHOU } })]);
    expect(celula("✖ falhou")).toBeInTheDocument();
  });

  test("o MOTIVO vai junto — senão sobra 'falhou, não sei por quê'", () => {
    renderPagina([linha({ tiposGuias: { ...linha().tiposGuias, DAS: CELULA_FALHOU } })]);
    expect(celula("✖ falhou")).toHaveAttribute(
      "title",
      expect.stringContaining("connect ETIMEDOUT smtp.gmail.com:465"),
    );
  });

  test("o title diz que ninguém tentará de novo e o que fazer", () => {
    renderPagina([linha({ tiposGuias: { ...linha().tiposGuias, DAS: CELULA_FALHOU } })]);
    const title = celula("✖ falhou").getAttribute("title");
    expect(title).toMatch(/nada tentará de novo sozinho/i);
    expect(title).toMatch(/Enviar e-mails/);
  });

  test("guia pendente continua '📄 guia' — só ERROR vira falha", () => {
    renderPagina([linha({ tiposGuias: { ...linha().tiposGuias, DAS: CELULA_PENDENTE } })]);
    expect(celula("📄 guia")).toBeInTheDocument();
    expect(semCelula("✖ falhou")).toHaveLength(0);
  });

  test("⚠ a linha segue SELECIONÁVEL: o envio manual alcança ERROR", () => {
    renderPagina([linha({ tiposGuias: { ...linha().tiposGuias, DAS: CELULA_FALHOU } })]);
    // Duas caixas: a do cabeçalho ("selecionar todas com pendência") e a da linha.
    const caixas = screen.getAllByRole("checkbox").filter((el) => el.type === "checkbox");
    const daLinha = caixas[caixas.length - 1];
    expect(daLinha).not.toBeDisabled();
  });
});

describe("aviso agregado no topo", () => {
  test("conta os envios que falharam e diz que não há retentativa", () => {
    renderPagina([
      linha({ tiposGuias: { ...linha().tiposGuias, DAS: CELULA_FALHOU } }),
      linha({ portalClientId: "c2", razao: "BETA ME", tiposGuias: { ...linha().tiposGuias, INSS: CELULA_FALHOU } }),
    ]);
    expect(screen.getByText(/não há retentativa automática/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Selecionar as 2 com falha/ })).toBeInTheDocument();
  });

  test("⚠ NÃO aparece quando está tudo bem — aviso permanente vira paisagem", () => {
    renderPagina([linha({ tiposGuias: { ...linha().tiposGuias, DAS: CELULA_PENDENTE } })]);
    expect(screen.queryByText(/não há retentativa automática/i)).not.toBeInTheDocument();
  });

  test("o botão do aviso seleciona as linhas com falha — o caminho de ação, em um clique", () => {
    renderPagina([linha({ tiposGuias: { ...linha().tiposGuias, DAS: CELULA_FALHOU } })]);
    fireEvent.click(screen.getByRole("button", { name: /Selecionar as 1 com falha/ }));
    expect(screen.getByRole("button", { name: /Enviar e-mails \(1\)/ })).toBeInTheDocument();
  });
});
