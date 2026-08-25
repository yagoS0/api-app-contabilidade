// AS DUAS METADES DE "as notas não aparecem completas".
//
// 1. TRUNCAMENTO — a tabela pagina de 100 em 100 e o rodapé escrevia o tamanho da PÁGINA.
//    Um mês de 2.717 notas (medido em produção, 10/08/2026) exibia 100 e dizia "100 nota(s)":
//    indistinguível de um mês que teve 100 notas mesmo. Truncar em silêncio se parece com
//    "é só isso que existe".
//
// 2. AUSÊNCIA — o detalhe da nota mostra o que temos, e onde não temos DIZ que não temos.
//    Campo vazio diagramado como se fosse valor é o defeito que este projeto mais persegue.
//    Os dois casos reais que precisam parecer diferentes na tela:
//      • NFS-e: 16.128 de 16.128 com XML gravado e item descrito;
//      • NF-e:  29 de 29 SEM XML, SEM tomador e SEM nenhum item.

import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotasList } from "../NotasList";
import { NotaDetailModal } from "../NotaDetailModal";

const FILTROS = { papel: "EMIT", type: "NFSE", competencia: "2026-07", search: "", limit: 100, offset: 0 };

function paginaDe(n, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `nota-${offset + i}`, type: "NFSE", papel: "EMIT", statusEfetivo: "autorizada",
    numero: String(1000 + offset + i), serie: null, chaveAcesso: `3304${String(offset + i).padStart(40, "0")}`,
    issueDate: "2026-07-10T00:00:00.000Z", competencia: "2026-07-01T00:00:00.000Z",
    total: "100.00", emitenteNome: "EMPRESA EXEMPLO LTDA", emitenteDoc: "00000000000191",
    tomadorNome: "TOMADOR EXEMPLO LTDA", tomadorDoc: null, competenciaPosFechamento: false,
  }));
}

const noop = () => {};

function umaNota(patch) {
  return [{ ...paginaDe(1)[0], ...patch }];
}

// ⚠ VERDE ERA O FALLBACK, E ISSO ERA UMA BOMBA ARMADA.
//
// `StatusBadge` era `cancelada ? vermelho : rejeitada ? âmbar : VERDE`, ou seja: qualquer valor
// desconhecido — inclusive `null` — se apresentava como autorizado. Enquanto o banco só teve dois
// valores ninguém percebeu. No instante em que um terceiro aparecesse ("substituida"), a nota
// apareceria verde, contaria no resumo, ofereceria "Cancelar" — e continuaria FORA do faturamento,
// que exige `=== "autorizada"`. Duas telas discordando em silêncio sobre a mesma nota.
describe("situação da nota — o desconhecido nunca se apresenta como autorizado", () => {
  it("valor desconhecido NÃO vira verde, e diz que não foi reconhecido", () => {
    render(
      <NotasList notas={umaNota({ statusEfetivo: "coisa_nova" })} total={1} filters={FILTROS}
        onFiltersChange={noop} onApply={noop} loading={false} />,
    );
    const selo = screen.getByText("coisa_nova");
    expect(selo).toHaveStyle({ color: "var(--state-neutral)" });
    expect(selo.getAttribute("title")).toMatch(/não presuma que está autorizada/i);
  });

  it("sem situação nenhuma, diz que não está registrada — não inventa 'autorizada'", () => {
    render(
      <NotasList notas={umaNota({ statusEfetivo: null, status: null })} total={1} filters={FILTROS}
        onFiltersChange={noop} onApply={noop} loading={false} />,
    );
    expect(screen.getByText(/situação não registrada/i)).toBeInTheDocument();
  });

  it("autorizada continua verde e substituída sai em âmbar (não em verde)", () => {
    const { rerender } = render(
      <NotasList notas={umaNota({ statusEfetivo: "autorizada" })} total={1} filters={FILTROS}
        onFiltersChange={noop} onApply={noop} loading={false} />,
    );
    expect(screen.getByText("autorizada")).toHaveStyle({ color: "var(--state-ok)" });

    rerender(
      <NotasList notas={umaNota({ statusEfetivo: "cancelada", ciclo: { situacao: "substituida", eventoRegistrado: true } })}
        total={1} filters={FILTROS} onFiltersChange={noop} onApply={noop} loading={false} />,
    );
    expect(screen.getByText("substituida")).toHaveStyle({ color: "var(--state-warn)" });
  });

  // ⚠ "Não temos o evento" ≠ "não houve evento". É o estado das 556 canceladas de produção.
  it("cancelada SEM evento gravado avisa que o evento não foi guardado", () => {
    render(
      <NotasList
        notas={umaNota({ statusEfetivo: "cancelada", ciclo: { situacao: "cancelada", eventoRegistrado: false } })}
        total={1} filters={FILTROS} onFiltersChange={noop} onApply={noop} loading={false} />,
    );
    expect(screen.getByText(/sem evento/i)).toBeInTheDocument();
    expect(screen.getByText("cancelada").getAttribute("title"))
      .toMatch(/não quer dizer que não houve evento/i);
  });

  it("cancelada COM evento gravado não recebe o aviso", () => {
    render(
      <NotasList
        notas={umaNota({ statusEfetivo: "cancelada", ciclo: { situacao: "cancelada", eventoRegistrado: true } })}
        total={1} filters={FILTROS} onFiltersChange={noop} onApply={noop} loading={false} />,
    );
    expect(screen.queryByText(/sem evento/i)).not.toBeInTheDocument();
  });
});

describe("truncamento nunca é silencioso", () => {
  it("diz quantas EXISTEM, não quantas couberam na página", () => {
    render(
      <NotasList
        notas={paginaDe(100)} total={2717} filters={FILTROS}
        onFiltersChange={noop} onApply={noop} loading={false}
      />,
    );

    // O número do universo aparece nos DOIS lugares que falam de quantidade (o contador junto do
    // filtro e o rodapé) — e os dois falam o mesmo número, que é o do servidor.
    expect(screen.getAllByText(/2717/).length).toBe(2);
    expect(screen.getByText(/1–100/)).toBeInTheDocument();
    expect(screen.getByText(/Há mais notas nesta competência do que cabem nesta página/i)).toBeInTheDocument();
  });

  it("mês que cabe inteiro NÃO ganha aviso de truncamento", () => {
    render(
      <NotasList
        notas={paginaDe(37)} total={37} filters={FILTROS}
        onFiltersChange={noop} onApply={noop} loading={false}
      />,
    );

    expect(screen.getByText(/todas as da competência/i)).toBeInTheDocument();
    expect(screen.queryByText(/Há mais notas/i)).not.toBeInTheDocument();
    // Sem página seguinte, não há por que oferecer navegação.
    expect(screen.queryByRole("button", { name: /Próxima/ })).not.toBeInTheDocument();
  });

  it("avançar de página move o OFFSET do filtro (é o servidor que pagina, não o cliente)", () => {
    const onFiltersChange = jest.fn();
    const onApply = jest.fn();
    render(
      <NotasList
        notas={paginaDe(100)} total={2717} filters={FILTROS}
        onFiltersChange={onFiltersChange} onApply={onApply} loading={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Próxima/ }));

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ offset: 100 }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ offset: 100 }));
  });

  it("botão desabilitado NOMEIA o motivo", () => {
    render(
      <NotasList
        notas={paginaDe(100)} total={2717} filters={FILTROS}
        onFiltersChange={noop} onApply={noop} loading={false}
      />,
    );

    const anterior = screen.getByRole("button", { name: /Anterior/ });
    expect(anterior).toBeDisabled();
    expect(anterior).toHaveAttribute("title", expect.stringMatching(/primeira página/i));
  });

  it("a linha inteira abre a nota — e a ação de marcar NÃO abre junto", () => {
    const onAbrirNota = jest.fn();
    const onMarcarStatus = jest.fn();
    window.confirm = () => true;

    render(
      <NotasList
        notas={paginaDe(2)} total={2} filters={FILTROS}
        onFiltersChange={noop} onApply={noop} loading={false}
        onAbrirNota={onAbrirNota} onMarcarStatus={onMarcarStatus}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Ver a nota 1000 por inteiro/i }));
    expect(onAbrirNota).toHaveBeenCalledWith("nota-0");

    onAbrirNota.mockClear();
    fireEvent.click(screen.getAllByRole("button", { name: "Marcar como cancelada" })[0]);
    expect(onMarcarStatus).toHaveBeenCalledWith("nota-0", "cancelada");
    expect(onAbrirNota).not.toHaveBeenCalled();
  });

  it("⚠ o botão NÃO se chama 'Cancelar' e NÃO é vermelho — ele não cancela nada no fisco", () => {
    // Rastreado em 18/08/2026: a ação faz um `portalInvoice.update` na nossa linha e mais nada.
    // O rótulo antigo era o nome do ATO FISCAL, que este botão não pratica.
    render(
      <NotasList
        notas={paginaDe(1)} total={1} filters={FILTROS}
        onFiltersChange={noop} onApply={noop} loading={false}
        onAbrirNota={noop} onMarcarStatus={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
    const botao = screen.getByRole("button", { name: "Marcar como cancelada" });
    expect(botao.getAttribute("style")).not.toMatch(/var(--danger)|--state-danger/);
    expect(botao).toHaveAttribute("title", expect.stringMatching(/não envia cancelamento à prefeitura/i));
  });

  it("⚠ a confirmação DIZ que nada é enviado à prefeitura", () => {
    const perguntas = [];
    window.confirm = (msg) => { perguntas.push(msg); return false; };
    render(
      <NotasList
        notas={paginaDe(1)} total={1} filters={FILTROS}
        onFiltersChange={noop} onApply={noop} loading={false}
        onAbrirNota={noop} onMarcarStatus={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Marcar como cancelada" }));
    expect(perguntas[0]).toMatch(/NADA é enviado à prefeitura/i);
    expect(perguntas[0]).toMatch(/revers[íi]vel/i);
  });
});

// ── O detalhe ────────────────────────────────────────────────────────────────

const NFSE_COMPLETA = {
  id: "nota-1", type: "NFSE", papel: "EMIT", numero: "13967", serie: null,
  chaveAcesso: "33045572255387580000103000000001396726088969924159",
  idNfse: null, idDps: null,
  competencia: "2026-06-01T00:00:00.000Z", issueDate: "2026-06-10T00:00:00.000Z",
  status: "EMITIDA", statusEfetivo: "autorizada", total: "540.00",
  emitenteNome: "EMPRESA EXEMPLO LTDA", emitenteDoc: "00000000000191",
  tomadorNome: "TOMADOR EXEMPLO LTDA", tomadorDoc: "11222333000191",
  competenciaPosFechamento: false, pdfUrl: null, xmlHash: null, lastSyncAt: null,
  createdAt: "2026-06-10T12:00:00.000Z", updatedAt: "2026-06-10T12:00:00.000Z",
  itens: [{
    id: "i1", descricao: "CURSO EAD - POS-GRADUACAO", codigoServico: "080201",
    cfop: null, ncm: null, valor: "540.00", tipoReceita: null, anexoResolvido: null,
    sujeitoFatorR: false, flagST: false, flagMonofasico: false, flagExportacao: false, classificadoEm: null,
  }],
  xml: { disponivel: true, bytes: 9866, conteudo: "<NFSe><infNFSe>exemplo</infNFSe></NFSe>", truncadoPorTamanho: false },
};

// O caso real das 29 NF-e: sem XML, sem tomador, sem item.
const NFE_MAGRA = {
  ...NFSE_COMPLETA,
  id: "nota-2", type: "NFE", papel: "DEST", numero: "000014520", serie: "001",
  tomadorNome: null, tomadorDoc: null, itens: [],
  xml: { disponivel: false, bytes: null, conteudo: null, truncadoPorTamanho: false },
};

describe("detalhe da nota — ausência nunca é resposta", () => {
  it("mostra a íntegra: itens com descrição e código, e o XML bruto atrás de um botão", () => {
    render(<NotaDetailModal nota={NFSE_COMPLETA} loading={false} error={null} onClose={noop} />);

    expect(screen.getByText(/CURSO EAD - POS-GRADUACAO/)).toBeInTheDocument();
    expect(screen.getByText("080201")).toBeInTheDocument();
    expect(screen.getByText(NFSE_COMPLETA.chaveAcesso)).toBeInTheDocument();

    // O XML é o dado mais valioso guardado e não tinha nenhuma porta antes desta.
    expect(screen.queryByText(/<infNFSe>/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ver XML/i }));
    expect(screen.getByText(/<infNFSe>exemplo<\/infNFSe>/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Baixar XML/i })).toBeInTheDocument();
  });

  it("campo que não temos DIZ que não temos — não vira traço no lugar do valor", () => {
    render(<NotaDetailModal nota={NFE_MAGRA} loading={false} error={null} onClose={noop} />);

    // `idNfse`, `idDps`, `xmlHash`, `lastSyncAt`, tomador… todos ausentes e todos NOMEADOS.
    expect(screen.getAllByText("não temos este dado").length).toBeGreaterThan(3);
    // A linha do tomador continua na tela (não some) e está marcada como ausente.
    expect(screen.getByText("Tomador / destinatário")).toBeInTheDocument();
  });

  it('distingue "não temos XML" de "temos e não coube"', () => {
    const { unmount } = render(<NotaDetailModal nota={NFE_MAGRA} loading={false} error={null} onClose={noop} />);
    expect(screen.getByText(/Não guardamos o XML desta nota/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ver XML/i })).not.toBeInTheDocument();
    unmount();

    render(
      <NotaDetailModal
        nota={{ ...NFSE_COMPLETA, xml: { disponivel: true, bytes: 4_000_000, conteudo: null, truncadoPorTamanho: true } }}
        loading={false} error={null} onClose={noop}
      />,
    );
    expect(screen.getByText(/grande demais para ser exibido aqui/i)).toBeInTheDocument();
    expect(screen.getByText(/Ele continua guardado/i)).toBeInTheDocument();
  });

  it("nota sem item explica POR QUE não há item, em vez de mostrar tabela vazia", () => {
    render(<NotaDetailModal nota={NFE_MAGRA} loading={false} error={null} onClose={noop} />);

    expect(screen.getByText(/resumo do DFe não traz os itens da NF-e/i)).toBeInTheDocument();
    expect(screen.getByText("sem itens registrados")).toBeInTheDocument();
  });

  it("item não classificado não finge anexo — diz que não foi classificado", () => {
    render(<NotaDetailModal nota={NFSE_COMPLETA} loading={false} error={null} onClose={noop} />);

    const tabela = screen.getByText(/CURSO EAD/).closest("table");
    expect(within(tabela).getByText("não classificado")).toBeInTheDocument();
  });

  it("erro de carga aparece — o modal não abre em branco", () => {
    render(<NotaDetailModal nota={null} loading={false} error="Falha ao carregar a nota." onClose={noop} />);
    expect(screen.getByText("Falha ao carregar a nota.")).toBeInTheDocument();
  });
});

// ── O CICLO NO DETALHE ───────────────────────────────────────────────────────
//
// O caso do dono: *"a ATIM consta uma nota; nós cancelamos essa nota, emitimos outra e depois a
// substituímos, e a nossa aba deve mostrar isso."*
//
// O defeito: a LISTA lia `ciclo` e mostrava "substituida" em âmbar; o detalhe da MESMA nota lia
// `statusEfetivo` e mostrava "cancelada" em vermelho. Duas telas discordando sobre a mesma nota.
// Estes testes cobrem a LIGAÇÃO (a tela lê a mesma leitura da lista); a regra tem teste próprio em
// `features/notas/lib/__tests__/cicloNotaTela.test.js`.

const CH_VELHA = "33045572255387580000103000000001399326088969924100";
const CH_NOVA = "33045572255387580000103000000001399426088969924101";

const SUBSTITUIDA = {
  ...NFSE_COMPLETA,
  id: "nota-13993", numero: "13993", chaveAcesso: CH_VELHA,
  status: "CANCELADA", statusEfetivo: "cancelada",
  ciclo: {
    situacao: "substituida", ehSubstituta: false,
    substitui: null, motivoSubstituicao: null,
    substituidaPor: { notaId: "nota-13994", numero: "13994", chaveAcesso: CH_NOVA, naBase: true },
    evento: {
      tipo: "canc_por_substituicao", tpEvento: "105102", nSeqEvento: 1,
      dataEvento: "2026-06-16T10:30:00.000Z", motivo: "valor da nota esta incorreto",
    },
    eventoRegistrado: true, avisos: [],
  },
  eventos: [{
    id: "ev1", tipo: "canc_por_substituicao", tpEvento: "105102", nSeqEvento: 1,
    dataEvento: "2026-06-16T10:30:00.000Z", motivo: "valor da nota esta incorreto",
    chaveSubstituta: CH_NOVA, capturadoEm: "2026-06-16T11:02:00.000Z",
  }],
};

const SUBSTITUTA = {
  ...NFSE_COMPLETA,
  id: "nota-13994", numero: "13994", chaveAcesso: CH_NOVA,
  chaveSubstituida: CH_VELHA, motivoSubstituicao: "valor da nota esta incorreto",
  ciclo: {
    situacao: "autorizada", ehSubstituta: true,
    substitui: { notaId: "nota-13993", numero: "13993", chaveAcesso: CH_VELHA, naBase: true },
    motivoSubstituicao: "valor da nota esta incorreto",
    substituidaPor: null, evento: null, eventoRegistrado: false, avisos: [],
  },
  eventos: [],
};

describe("detalhe da nota — a substituição aparece, com os dois lados", () => {
  it("a nota SUBSTITUÍDA não se apresenta como 'cancelada' em vermelho — a lista e o detalhe combinam", () => {
    const { unmount } = render(
      <NotasList notas={[{ ...SUBSTITUIDA }]} total={1} filters={FILTROS}
        onFiltersChange={noop} onApply={noop} loading={false} />,
    );
    const naLista = screen.getByText("substituida");
    expect(naLista).toHaveStyle({ color: "var(--state-warn)" });
    unmount();

    render(<NotaDetailModal nota={SUBSTITUIDA} loading={false} error={null} onClose={noop} />);
    // O chip do cabeçalho e o do bloco de ciclo dizem a MESMA palavra que a lista disse.
    const chips = screen.getAllByText("substituida");
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach((c) => expect(c).toHaveStyle({ color: "var(--state-warn)" }));
    // ⚠ E o `statusEfetivo` cru continua visível: é o campo que a APURAÇÃO lê.
    expect(screen.getByText("Situação efetiva")).toBeInTheDocument();
  });

  it("diz POR QUAL nota foi substituída, com motivo, data e o evento", () => {
    render(<NotaDetailModal nota={SUBSTITUIDA} loading={false} error={null} onClose={noop} />);

    expect(screen.getByText("Foi substituída por")).toBeInTheDocument();
    expect(screen.getByText("nº 13994")).toBeInTheDocument();
    expect(screen.getAllByText(/valor da nota esta incorreto/).length).toBeGreaterThan(0);
    expect(screen.getByText("Motivo da substituição")).toBeInTheDocument();
    // O evento com tpEvento 105102 é o fato — data e motivo vêm dele.
    expect(screen.getByText(/105102/)).toBeInTheDocument();
  });

  it("dá para NAVEGAR até a nota que passou a valer", () => {
    const onAbrirNota = jest.fn();
    render(<NotaDetailModal nota={SUBSTITUIDA} loading={false} error={null} onClose={noop} onAbrirNota={onAbrirNota} />);

    const abrir = screen.getByRole("button", { name: /Abrir esta nota/i });
    expect(abrir).toBeEnabled();
    fireEvent.click(abrir);
    expect(onAbrirNota).toHaveBeenCalledWith("nota-13994");
  });

  // ⚠ Sumir com o vínculo não é resposta; dizer que a outra nota não está no sistema é.
  it("substituta fora da base: o vínculo FICA, e o botão desabilitado diz o motivo", () => {
    const foraDaBase = {
      ...SUBSTITUIDA,
      ciclo: {
        ...SUBSTITUIDA.ciclo,
        substituidaPor: { notaId: null, numero: null, chaveAcesso: CH_NOVA, naBase: false },
        avisos: [{ codigo: "substituta_ausente", texto: "O evento aponta uma nota substituta que NÃO está na nossa base." }],
      },
    };
    render(<NotaDetailModal nota={foraDaBase} loading={false} error={null} onClose={noop} onAbrirNota={jest.fn()} />);

    expect(screen.getByText(/NÃO está na nossa base/i)).toBeInTheDocument();
    expect(screen.getAllByText(CH_NOVA).length).toBeGreaterThan(0);
    const abrir = screen.getByRole("button", { name: /Abrir esta nota/i });
    expect(abrir).toBeDisabled();
    expect(abrir).toHaveAttribute("title", expect.stringMatching(/não está no sistema/i));
    expect(screen.getAllByText(/A nota substituta não está no sistema/i).length).toBeGreaterThan(0);
  });

  it("a SUBSTITUTA declara quem ela substituiu — e ser substituta é papel, não situação", () => {
    render(<NotaDetailModal nota={SUBSTITUTA} loading={false} error={null} onClose={noop} onAbrirNota={jest.fn()} />);

    expect(screen.getByText("substituta")).toBeInTheDocument();
    expect(screen.getByText("Esta nota substitui")).toBeInTheDocument();
    expect(screen.getByText("nº 13993")).toBeInTheDocument();
    // Continua AUTORIZADA: ela é a que vale.
    expect(screen.getAllByText("autorizada").length).toBeGreaterThan(0);
    // ⚠ E não pode aparecer como "sem evento": ela não foi cancelada.
    expect(screen.queryByText(/sem evento/i)).not.toBeInTheDocument();
  });

  // O quarto estado, e o mais fácil de perder.
  it('cancelada SEM evento diz "não temos o evento", distinto de "não houve evento"', () => {
    const semEvento = {
      ...NFSE_COMPLETA,
      status: "CANCELADA", statusEfetivo: "cancelada",
      ciclo: {
        situacao: "cancelada", ehSubstituta: false, substitui: null, motivoSubstituicao: null,
        substituidaPor: null, evento: null, eventoRegistrado: false,
        avisos: [{
          codigo: "evento_nao_registrado",
          texto: "Esta nota está marcada como cancelada, mas nós não guardamos o evento de cancelamento.",
        }],
      },
      eventos: [],
    };
    render(<NotaDetailModal nota={semEvento} loading={false} error={null} onClose={noop} />);

    expect(screen.getByText(/não guardamos o evento de cancelamento/i)).toBeInTheDocument();
    expect(screen.getByText(/Nenhum evento guardado para esta nota/i)).toBeInTheDocument();
    expect(screen.getAllByText(/sem evento/i).length).toBeGreaterThan(0);
    // ⚠ NÃO pode dizer que não foi substituída: não sabemos.
    expect(screen.queryByText(/não foi cancelada nem substituída/i)).not.toBeInTheDocument();
  });

  it('nota normal responde "não foi cancelada nem substituída" — silêncio nomeado, não bloco vazio', () => {
    render(<NotaDetailModal nota={{ ...NFSE_COMPLETA, eventos: [] }} loading={false} error={null} onClose={noop} />);

    expect(screen.getByText(/não foi cancelada nem substituída/i)).toBeInTheDocument();
    expect(screen.queryByText("Foi substituída por")).not.toBeInTheDocument();
  });
});
