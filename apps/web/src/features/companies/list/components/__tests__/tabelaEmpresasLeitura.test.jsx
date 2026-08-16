// A TABELA DA CARTEIRA PRECISA DIZER O QUE ELA ESTÁ MOSTRANDO.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// Três relatos chegaram como "defeito de dado" e, medidos no código, eram todos defeito de LEITURA
// — a tela sabia a verdade e não a escrevia em lugar nenhum:
//
//   1. *"o chip diz 'Todas · 33' e só aparecem linhas 'Falta apurar'"*  → é ORDENAÇÃO, não filtro.
//      A ordem padrão (`campo: "urgencia"`) não corresponde a nenhuma coluna, então nenhum
//      cabeçalho ganhava o ▲ e a lista parecia não estar ordenada por nada.
//   2. *"a PHAOS tem 'Falta apurar', 'Com pendência' E 'Guias concluídas' ao mesmo tempo"* → os
//      três são verdadeiros; são EIXOS INDEPENDENTES (o mês na nossa mão · a dívida com a Receita ·
//      o que já saiu para o cliente). Nenhum deles pode calar os outros.
//   3. a tabela vazia afirmava "Nenhuma empresa encontrada para os filtros atuais" também durante a
//      carga, também quando o servidor recusou e também numa carteira sem nenhuma empresa — as três
//      coisas que `lib/falhaDeCarga.js` existe para manter separadas.
//
// Testa-se a LIGAÇÃO (o que a tela afirma), não as regras — elas já têm teste próprio em `../lib/`.
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { CompaniesTable } from "../renderCompaniesTable.jsx";

/**
 * O clique de copiar é `async` (a API do clipboard devolve Promise) e ainda agenda um `setTimeout`
 * para devolver o botão ao repouso. Sem drenar as duas coisas dentro de `act`, o React avisa que
 * houve `setState` fora dele — e o aviso viraria paisagem, que é como um teste deixa de servir.
 */
async function clicarECHegarAoFim(elemento) {
  await act(async () => {
    fireEvent.click(elemento);
    await Promise.resolve();
  });
}

/** Empresa "normal": Simples, apurada não, uma guia por gerar, situação fiscal consultada hoje. */
function empresa(over = {}) {
  return {
    companyId: "c1",
    razao: "ACME LTDA",
    cnpj: "11222333000181",
    legacyCompany: { regimeTributario: "SIMPLES", certStorageKey: "k", certExpiresAt: "2099-01-01" },
    guideCompliance: { das: { required: true, state: "missing", ok: false } },
    fiscalSituacao: "REGULAR",
    fiscalCheckedAt: new Date().toISOString(),
    notasEmitidas: { total: 1234567.89 },
    apuracao: { apurada: false },
    ...over,
  };
}

function montar(props = {}) {
  return render(
    <CompaniesTable
      companies={[empresa()]}
      travas={null}
      competencia="2026-07"
      onOpenCompany={jest.fn()}
      acoesGuia={{}}
      busca=""
      {...props}
    />,
  );
}

describe("CNPJ: máscara para o olho, dígitos para o e-CAC", () => {
  test("a tela mostra COM máscara", () => {
    montar();
    expect(screen.getByText("11.222.333/0001-81")).toBeInTheDocument();
  });

  test("⚠ o botão de copiar entrega os 14 dígitos SEM máscara — é o que o e-CAC aceita", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    montar();
    await clicarECHegarAoFim(screen.getByRole("button", { name: /Copiar o CNPJ de ACME LTDA sem máscara/ }));
    expect(writeText).toHaveBeenCalledWith("11222333000181");
  });

  test("a razão social também é copiável — é a outra ação repetida do dia", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    montar();
    await clicarECHegarAoFim(screen.getByRole("button", { name: /Copiar a razão social de ACME LTDA/ }));
    expect(writeText).toHaveBeenCalledWith("ACME LTDA");
  });

  test("⚠ sem `navigator.clipboard` o botão NÃO finge que copiou", async () => {
    // Contexto inseguro (http://ip:porta, que é como o portal roda em rede local) não expõe a API.
    // Um "copiado" falso aqui manda o contador colar o conteúdo ANTERIOR num campo de CNPJ.
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    montar();
    const botao = screen.getByRole("button", { name: /Copiar o CNPJ de ACME LTDA sem máscara/ });
    await clicarECHegarAoFim(botao);
    expect(screen.getByTitle(/Não foi possível copiar/)).toBeInTheDocument();
  });
});

describe("a lista diz QUANTAS mostra e POR QUE está nesta ordem", () => {
  test("⚠ o critério de ordenação vem escrito — ordenada ≠ filtrada", () => {
    // O relato do "chip Todas · 33 com a lista pela metade" nasceu daqui: sem esta frase, "as
    // pendentes no topo" é indistinguível de "só as pendentes".
    montar();
    // Aparece DUAS vezes de propósito: na barra visível e no `<caption>` (que é lido pelo leitor de
    // tela e não é pintado). As duas saem do mesmo `ROTULO_ORDEM`, então não podem divergir.
    expect(screen.getAllByText(/pendência — o mais urgente primeiro/).length).toBeGreaterThanOrEqual(2);
  });

  test("⚠ 'Exibindo X de N' aparece quando os filtros escondem alguém", () => {
    montar({ totalSemFiltro: 33 });
    expect(screen.getByText(/Exibindo/)).toBeInTheDocument();
    expect(screen.getByText(/de 33 empresas/)).toBeInTheDocument();
  });

  test("sem filtro escondendo ninguém, não há 'de N' — número redundante é ruído", () => {
    montar({ totalSemFiltro: 1 });
    expect(screen.queryByText(/Exibindo/)).not.toBeInTheDocument();
    expect(screen.getByText(/empresa$/)).toBeInTheDocument();
  });

  test("os cabeçalhos declaram a ordenação em `aria-sort` — o ▲ é só pixel", () => {
    montar();
    // Nenhuma coluna está ativa por padrão: a ordem é "urgência", que não é coluna nenhuma.
    for (const nome of ["Empresa", "Apuração", "Situação fiscal", "Guias", "Notas"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(nome) })).toHaveAttribute("aria-sort", "none");
    }
    fireEvent.click(screen.getByRole("button", { name: /Empresa/ }));
    expect(screen.getByRole("columnheader", { name: /Empresa/ })).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByRole("button", { name: /Empresa/ }));
    expect(screen.getByRole("columnheader", { name: /Empresa/ })).toHaveAttribute("aria-sort", "descending");
  });

  test("dá para voltar à ordem por pendência sem recarregar a página", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /Notas/ }));
    fireEvent.click(screen.getByRole("button", { name: /Voltar à ordem por pendência/ }));
    expect(screen.getAllByText(/pendência — o mais urgente primeiro/).length).toBeGreaterThanOrEqual(2);
  });
});

describe("⚠ TRÊS EIXOS INDEPENDENTES — o caso PHAOS", () => {
  test("'Falta apurar' + 'Com pendência' + 'Guias concluídas' convivem, e isso é correto", () => {
    // Apuração pendente (nosso mês), dívida na Receita (do cliente) e todas as guias já entregues
    // são três fatos que não se contradizem. A tabela não pode calar nenhum deles.
    montar({
      companies: [empresa({
        razao: "PHAOS CONSULTORIA",
        fiscalSituacao: "COM_PENDENCIA",
        apuracao: { apurada: false },
        guideCompliance: { das: { required: true, state: "enviada", ok: true } },
      })],
    });
    const linha = screen.getByRole("row", { name: /PHAOS CONSULTORIA/ });
    expect(within(linha).getByText(/Falta apurar/)).toBeInTheDocument();
    expect(within(linha).getByText(/Com pendência/)).toBeInTheDocument();
    expect(within(linha).getByText(/Guias concluídas/)).toBeInTheDocument();
  });

  test("cada coluna diz QUAL pergunta responde — é o que separa os eixos na leitura", () => {
    montar();
    expect(screen.getByText("como está o mês?")).toBeInTheDocument();
    expect(screen.getByText("e com a Receita?")).toBeInTheDocument();
    expect(screen.getByText("o que falta entregar?")).toBeInTheDocument();
  });
});

describe("⚠ TRÊS VAZIOS, TRÊS RESPOSTAS (a doutrina de `lib/falhaDeCarga.js`)", () => {
  test("carregando NÃO afirma 'nenhuma empresa'", () => {
    montar({ companies: [], carregando: true });
    expect(screen.queryByText(/Nenhuma empresa/)).not.toBeInTheDocument();
  });

  test("servidor recusou → a falha aparece com o motivo, não um vazio bem-educado", () => {
    montar({ companies: [], erroDeCarga: "O servidor demorou demais para responder." });
    expect(screen.getByText(/Não foi possível carregar a carteira de empresas/)).toBeInTheDocument();
    expect(screen.getByText(/O servidor demorou demais para responder\./)).toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma empresa nesta carteira ainda/)).not.toBeInTheDocument();
  });

  test("filtros escondendo tudo → diz quantas existem e oferece o desfazer", () => {
    const onLimparFiltros = jest.fn();
    montar({ companies: [], totalSemFiltro: 33, onLimparFiltros });
    expect(screen.getByText(/Nenhuma das/)).toBeInTheDocument();
    // Dois "Limpar filtros" nesta situação: o da barra de contagem e o do próprio vazio. Os dois
    // chamam o mesmo handler — o do vazio existe para o desfazer estar ONDE o problema aparece.
    const botoes = screen.getAllByRole("button", { name: "Limpar filtros" });
    fireEvent.click(botoes[botoes.length - 1]);
    expect(onLimparFiltros).toHaveBeenCalled();
  });

  test("carteira realmente vazia → não manda caçar filtro que não existe", () => {
    montar({ companies: [], totalSemFiltro: 0 });
    expect(screen.getByText(/Nenhuma empresa nesta carteira ainda/)).toBeInTheDocument();
    expect(screen.queryByText(/filtros atuais/)).not.toBeInTheDocument();
  });
});

describe("acessibilidade da linha", () => {
  test("⚠ 'Acessar' carrega o nome da empresa — trinta botões idênticos não distinguem nada", () => {
    montar();
    expect(screen.getByRole("button", { name: "Acessar ACME LTDA" })).toBeInTheDocument();
  });

  test("o selo A1 anuncia a frase inteira, não as duas letras", () => {
    montar({ companies: [empresa({ legacyCompany: { regimeTributario: "SIMPLES", certStorageKey: null } })] });
    expect(screen.getByRole("img", { name: /sem certificado A1 cadastrado/ })).toBeInTheDocument();
  });

  test("⚠ 'Consultar' é AÇÃO e continua sendo um botão — não virou rótulo", () => {
    // A affordance foi corrigida (borda tracejada → chrome de botão), mas trocar o botão por um
    // rótulo "não consultado" tiraria da tela a única forma de consultar UMA empresa sem entrar
    // nela. O `title` diz que é paga ANTES do clique; a confirmação nomeada vem depois.
    montar({ companies: [empresa({ fiscalSituacao: null, fiscalCheckedAt: null })] });
    const botao = screen.getByRole("button", { name: /Consultar/ });
    expect(botao.tagName).toBe("BUTTON");
    expect(botao).toHaveAttribute("title", expect.stringMatching(/consulta paga/i));
  });
});
