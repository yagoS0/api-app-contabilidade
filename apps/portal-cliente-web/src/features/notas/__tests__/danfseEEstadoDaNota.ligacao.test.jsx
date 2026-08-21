// A LIGAÇÃO DAS DUAS ENTREGAS DE 19/08/2026, NA MESMA TELA:
//
//   1. **O DANFSe da nota é gerado** — o botão existe, chama a rota certa com o id certo, e a
//      RECUSA 503 aparece com o motivo.
//   2. **A nota emitida aparece na hora, mais clara, e "acende" quando o ADN confirma** — sem
//      nenhuma explicação em texto na tela.
//
// ⚠⚠ COMPONENTE SEM CHAMADOR É O DEFEITO FAVORITO DESTE PROJETO. As regras já têm suíte própria
// (`lib/__tests__/danfseDaNota.test.js`); o que este arquivo prova é a CORRENTE: a casca monta a
// aba Notas, a linha renderiza o botão, o botão chama `api.fetchDanfseBlob`, e o Blob vira
// download. Um `podeGerarDanfse` perfeito que ninguém chama não baixa nada.
//
// ⚠⚠ DENTRO DO `StrictMode` — é assim que o app roda (`src/main.jsx`), e o React 19 executa cada
// efeito DUAS vezes. Um defeito recente deste app só apareceu por isso.
//
// ⚠⚠ NADA É EMITIDO. `api.emitirNfse` é uma armadilha que explode, e o `fetch` global também.

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../../../api";
import { AppShell } from "../../shell/AppShell";

const CNPJ_DA_EMPRESA = "11222333000181";

const EMPRESA = {
  companyId: "pc-001",
  razao: "ACME SERVICOS LTDA",
  cnpj: CNPJ_DA_EMPRESA,
  myRole: "OWNER",
  emissaoNfseLiberada: true,
  legacyCompany: {
    regimeTributario: "SIMPLES_NACIONAL",
    inscricaoMunicipal: "1234567",
    codigoServicoNacional: "010101",
    codigoServicoMunicipal: "1.01",
    rpsSerie: "1",
  },
};

/** A forma REAL do payload do cliente (`serializeInvoice`, `apps/api/src/routes/portalInvoices.js`). */
function nota(patch = {}) {
  return {
    invoiceId: "inv-1001",
    type: "NFSE",
    numero: "13000",
    competencia: "2026-06",
    issueDate: "2026-06-10T00:00:00.000Z",
    status: "EMITIDA",
    total: 2300,
    emitente: { nome: "ACME SERVICOS LTDA", cnpj: CNPJ_DA_EMPRESA },
    tomador: { nome: "TOMADOR EXEMPLO LTDA", cnpjCpf: "44555666000177" },
    updatedAt: "2026-06-11T00:00:00.000Z",
    hasXml: true,
    hasPdf: false,
    confirmadaPeloAdn: true,
    ...patch,
  };
}

function respostaDeNotas(lista) {
  return {
    data: lista,
    page: 1,
    limit: 25,
    total: lista.length,
    summary: { totalInvoices: lista.length, totalAmount: 2300, pageAmount: 2300 },
  };
}

/** O erro como `realApi.fetchDanfseBlob` o lança (o `ApiError` com `code`, `message` e `motivo`). */
function recusa(status, code, message, motivo = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.motivo = motivo;
  return err;
}

let fetchOriginal;
let cliques;

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
  cliques = [];
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
  // O download real cria um `<a>` e clica nele. Aqui a âncora é interceptada para que o teste
  // possa AFIRMAR o nome do arquivo — jsdom não implementa `URL.createObjectURL`.
  URL.createObjectURL = jest.fn(() => "blob:mock");
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function interceptar() {
    cliques.push({ href: this.href, download: this.download });
  });

  jest.spyOn(api, "getCompanies").mockResolvedValue([EMPRESA]);
  jest.spyOn(api, "getInvoices").mockResolvedValue(respostaDeNotas([nota()]));
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "fetchDanfseBlob").mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" }));
  jest.spyOn(api, "emitirNfse").mockImplementation(() => {
    throw new Error("⚠ NENHUM TESTE PODE EMITIR NFS-e");
  });
});

afterEach(() => {
  expect(api.emitirNfse).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  window.location.hash = "";
  jest.restoreAllMocks();
});

async function abrirNotas() {
  render(
    <StrictMode>
      <AppShell user={{ defaultClientId: "pc-001" }} />
    </StrictMode>
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole("link", { name: "Notas" }));
  // ⚠ O flush precisa passar por uma TAREFA, não só por microtarefas: as abas são `<a href>` e o
  // `useRota` escuta `hashchange`, que o jsdom entrega numa tarefa. Sem isto o `findByText` abaixo
  // fica dependendo do polling de 1s para a rota trocar — e é daí que vinham os timeouts de 5s
  // desta suíte quando a máquina está ocupada.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await screen.findByText("Notas emitidas");
}

const botaoDanfse = () => screen.getByRole("button", { name: "Baixar DANFSe" });

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1. O DANFSe
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("o DANFSe da nota é gerado — a corrente inteira", () => {
  test("⚠ O BOTÃO EXISTE NA LINHA e chama a rota com a empresa e a nota certas", async () => {
    await abrirNotas();
    fireEvent.click(botaoDanfse());
    await waitFor(() => expect(api.fetchDanfseBlob).toHaveBeenCalled());
    expect(api.fetchDanfseBlob).toHaveBeenCalledWith("pc-001", "inv-1001");
  });

  test("⚠⚠ NÃO É UM `<a href>`: o arquivo vem por `fetch` autenticado e é entregue como Blob", async () => {
    await abrirNotas();
    // Nenhum link de download existe na tela ANTES do clique — se existisse, ele iria à rota sem
    // o Bearer e o cliente receberia um 401 em vez do PDF.
    expect(document.querySelector("a[download]")).toBeNull();
    fireEvent.click(botaoDanfse());
    await waitFor(() => expect(cliques).toHaveLength(1));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(cliques[0].href).toBe("blob:mock");
    expect(cliques[0].download).toBe("danfse-13000.pdf");
  });

  test("enquanto gera, o botão diz que está gerando e não aceita um segundo clique", async () => {
    let liberar;
    api.fetchDanfseBlob.mockImplementation(() => new Promise((r) => { liberar = r; }));
    await abrirNotas();
    fireEvent.click(botaoDanfse());
    await act(async () => {});
    const gerando = screen.getByRole("button", { name: "Gerando…" });
    expect(gerando).toBeDisabled();
    await act(async () => { liberar(new Blob(["%PDF"])); });
    expect(api.fetchDanfseBlob).toHaveBeenCalledTimes(1);
  });
});

describe("⚠⚠ A RECUSA 503 APARECE, COM O MOTIVO", () => {
  test("`danfse_sem_qrcode`: a mensagem do servidor E o porquê ficam na tela", async () => {
    api.fetchDanfseBlob.mockRejectedValue(
      recusa(503, "danfse_sem_qrcode", "O QR Code não pôde ser gerado: a chave de acesso não está no XML desta nota.", "chave_ausente")
    );
    await abrirNotas();
    fireEvent.click(botaoDanfse());

    // A mensagem do SERVIDOR vence e aparece inteira.
    await screen.findByText(/a chave de acesso não está no XML desta nota/i);
    // ⚠ E o PORQUÊ, que é o que essa recusa existe para dizer.
    expect(screen.getByText(/Um DANFSe sem QR Code não é um DANFSe/i)).toBeInTheDocument();
    // ⚠ Nada de download vazio: o `<a>` nunca foi clicado.
    expect(cliques).toHaveLength(0);
  });

  test("⚠ NÃO vira 'falha ao baixar' genérico, e a tela NÃO fica em branco", async () => {
    api.fetchDanfseBlob.mockRejectedValue(recusa(503, "danfse_sem_qrcode", "sem QR Code", "chave_ausente"));
    await abrirNotas();
    fireEvent.click(botaoDanfse());
    await screen.findByText(/O DANFSe não foi gerado/i);
    expect(screen.queryByText(/falha ao baixar/i)).not.toBeInTheDocument();
  });

  test("recusa DESCONHECIDA não ganha procedimento inventado", async () => {
    api.fetchDanfseBlob.mockRejectedValue(recusa(500, "internal_error", ""));
    await abrirNotas();
    fireEvent.click(botaoDanfse());
    await screen.findByText(/não devolveu o PDF e não disse por quê/i);
    expect(screen.queryByText(/tente de novo/i)).not.toBeInTheDocument();
  });
});

describe("⚠ BOTÃO IMPOSSÍVEL NÃO SOME — ele fica desabilitado DIZENDO POR QUÊ", () => {
  // ATUALIZADO EM 19/08/2026 (consolidacao da frase repetida): ser NF-e e impedimento da NOTA, e a
  // coluna Tipo da linha ja mostra NFE. A frase ao lado do botao seria a segunda vez que a linha
  // diz o mesmo, e a coluna Cancelar diria uma terceira. O motivo continua no title.
  test("NF-e: o botão continua na tela, desabilitado, com o motivo no title", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ type: "NFE" })]));
    await abrirNotas();
    const botao = botaoDanfse();
    expect(botao).toBeInTheDocument();
    expect(botao).toBeDisabled();
    expect(botao.getAttribute("title")).toMatch(/documento auxiliar da NFS-e/i);
    const linha = document.querySelector("tbody tr").textContent;
    // A linha ja diz que e NF-e na coluna Tipo.
    expect(linha).toContain("NFE");
    // A frase do DANFSe saiu.
    expect(linha).not.toContain("Só NFS-e tem DANFSe.");
    // ⚠⚠ E O QUE SOBROU, MEDIDO COM HONESTIDADE: a coluna "Usar como modelo" ainda escreve o seu
    // "só NFS-e" — UMA vez na linha, e de propósito. A regra dela
    // (`emitir/lib/reaproveitarNota.js`) é ESPELHO da do portal do escritório ("mudou lá, muda
    // aqui"), e acrescentar `escopo` só de um lado divergiria as duas. Uma ocorrência por linha
    // era a meta; esta é ela.
    // ⚠ A contagem é case-INSENSITIVE de propósito: a primeira versão deste caso usava /Só NFS-e/
    // com maiúscula e passava por acidente, porque o texto que sobra é "só NFS-e", minúsculo.
    expect(linha.match(/só NFS-e/gi)).toHaveLength(1);
    expect(api.fetchDanfseBlob).not.toHaveBeenCalled();
  });

  test("nota sem XML guardado: desabilitado, com o motivo — não some", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ hasXml: false })]));
    await abrirNotas();
    expect(botaoDanfse()).toBeDisabled();
    expect(screen.getByText("Sem o XML guardado.")).toBeInTheDocument();
  });

  test("⚠ nota AINDA NÃO CONFIRMADA pelo ADN: desabilitado (a rota lê `PortalInvoice`, e ela não está lá)", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ confirmadaPeloAdn: false, hasXml: false })]));
    await abrirNotas();
    expect(botaoDanfse()).toBeDisabled();
    // ⚠⚠ ATUALIZADO DUAS VEZES EM 19/08/2026, e a segunda desfez a primeira. Quando o botão
    // Cancelar entrou na mesma linha, a MESMA frase passou a aparecer duas vezes e eu escopei a
    // asserção na célula do DANFSe. O dono então mandou CONSOLIDAR: "Ainda não confirmada." é
    // estado da NOTA, e a linha o diz uma vez só — pela opacidade e pelo `title`/`aria` do chip.
    // Ver `lib/impedimento.js`.
    //
    // ⚠ O motivo desta ação não sumiu: ele está no `title` do botão, que não é texto na tela.
    expect(botaoDanfse().getAttribute("title")).toMatch(/ainda não voltou/i);
    expect(document.querySelector("tbody tr").textContent).not.toMatch(/Ainda não confirmada/);
    expect(api.fetchDanfseBlob).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2. A nota emitida — mais clara enquanto o ADN não confirma
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("a nota emitida aparece MAIS CLARA e 'acende' quando o ADN confirma", () => {
  test("⚠ o estado fica AUDITÁVEL NO DOM (`data-confirmada-adn`), nos dois valores", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([
      nota({ invoiceId: "si-9", numero: null, confirmadaPeloAdn: false, hasXml: false }),
      nota({ invoiceId: "inv-1001", confirmadaPeloAdn: true }),
    ]));
    await abrirNotas();
    const linhas = [...document.querySelectorAll("tbody tr")];
    expect(linhas).toHaveLength(2);
    // ⚠ O atributo virou `data-estado-nota` em 19/08/2026, quando o cancelamento enviado passou a
    // ser um TERCEIRO estado: um booleano não comportava três fatos. Ver `estadoDaLinhaDaNota.js`.
    expect(linhas[0].getAttribute("data-estado-nota")).toBe("aguardando_adn");
    expect(linhas[1].getAttribute("data-estado-nota")).toBe("confirmada");
  });

  test("⚠⚠ NENHUMA EXPLICAÇÃO NA TELA — instrução literal do dono", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ confirmadaPeloAdn: false, hasXml: false })]));
    await abrirNotas();
    const corpo = document.body.textContent;
    // Nada de legenda, rodapé ou parágrafo explicando os dois estados.
    for (const frase of [
      /aguardando confirma..o do sistema nacional/i,
      /ainda n.o foi confirmada pelo ADN/i,
      /notas mais claras/i,
      /as notas em cinza/i,
    ]) {
      expect(corpo).not.toMatch(frase);
    }
  });

  test("⚠ MAS o estado CHEGA a quem não enxerga a diferença: `title` e `aria-label` no chip", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ confirmadaPeloAdn: false, hasXml: false })]));
    await abrirNotas();
    const chip = document.querySelector(".chip");
    expect(chip.getAttribute("title")).toMatch(/aguardando confirma/i);
    expect(chip.getAttribute("aria-label")).toMatch(/aguardando confirma/i);
    // ⚠ `title`/`aria-label` NÃO são texto na tela: o que se LÊ continua sendo só "Emitida".
    expect(chip.textContent).toBe("Emitida");
  });

  test("⚠ NÃO SE CONFUNDE COM CANCELADA: o chip não muda de cor nem de rótulo", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ confirmadaPeloAdn: false, hasXml: false })]));
    await abrirNotas();
    const chip = document.querySelector(".chip");
    expect(chip.getAttribute("data-status")).toBe("emitida");
    expect(chip.getAttribute("data-status")).not.toBe("cancelada");
  });

  test("a nota CONFIRMADA não ganha `title` nenhum — ela é o caso normal", async () => {
    await abrirNotas();
    const chip = document.querySelector(".chip");
    expect(chip.getAttribute("title")).toBeNull();
    expect(chip.getAttribute("aria-label")).toBeNull();
  });

  test("⚠ contrato ANTIGO (sem o campo) é lido como CONFIRMADA — `undefined` não é `false`", async () => {
    const { confirmadaPeloAdn, ...semOCampo } = nota();
    api.getInvoices.mockResolvedValue(respostaDeNotas([semOCampo]));
    await abrirNotas();
    expect(document.querySelector("tbody tr").getAttribute("data-estado-nota")).toBe("confirmada");
    expect(botaoDanfse()).not.toBeDisabled();
  });

  test("⚠ a linha NÃO fica desabilitada: 'Usar como modelo' continua clicável na nota não confirmada", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ confirmadaPeloAdn: false, hasXml: false })]));
    await abrirNotas();
    const linha = document.querySelector("tbody tr");
    expect(within(linha).getByRole("button", { name: "Usar como modelo" })).not.toBeDisabled();
  });
});
