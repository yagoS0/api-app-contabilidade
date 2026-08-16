// EDITAR UM LANÇAMENTO COMPOSTO NÃO PODE APAGAR AS LINHAS QUE SOBRAM.
//
// O ✎ da linha abria SEMPRE o `DraftEntryRow`, que é um editor de **1 débito / 1 crédito / 1
// valor**. Num lançamento de três linhas — `D principal · D juros · C total`, que é a forma da
// provisão de parcelamento — ele lia `lines.find(D)` e `lines.find(C)`, montava um payload de duas
// linhas, e o `PUT /entries` (que faz `deleteMany` + `createMany`) apagava a linha de juros do
// banco. Sem erro, sem aviso, sem confirmação — e a tela SABIA que era composto: ela desenha
// "2D / 1C ▶" na própria linha.
//
// ⚠ O que esta suíte protege é o NÚMERO DE LINHAS E OS VALORES que chegam ao `onUpdate`. Não é
// sobre como o lançamento é composto — a forma não muda aqui [[nao-mudar-forma-lancamentos]]; é
// sobre não destruí-la. Um teste que olhasse só o total (1.200 = 1.200 nos dois casos, porque o
// editor de 1 linha repete o mesmo valor nos dois lados) passaria com o defeito de volta.

import { render, screen, fireEvent } from "@testing-library/react";
import { AccountRow } from "../renderAccountingEntriesParts.jsx";

const CONTAS = [
  { codigo: "265", nome: "Parcelamento a Recolher", tipo: "PASSIVO", analitica: true },
  { codigo: "501", nome: "Juros sobre Parcelamento", tipo: "DESPESA", analitica: true },
  { codigo: "553", nome: "Parcelamento a Pagar", tipo: "PASSIVO", analitica: true },
  { codigo: "5", nome: "Caixa", tipo: "ATIVO", analitica: true },
];

// A provisão de adesão do parcelamento: principal + juros de um lado, o total do outro.
function composto(over = {}) {
  return {
    id: "e-parc",
    data: "2026-07-31T00:00:00.000Z",
    competencia: "2026-07",
    historico: "PROVISÃO PARCSN 07/2026",
    tipo: "PROVISAO",
    subtipo: "PARC_DAS",
    origem: "MANUAL",
    status: "RASCUNHO",
    statusPagamento: "ABERTO",
    lines: [
      { id: "l1", conta: "265", tipo: "D", valor: 1000 },
      { id: "l2", conta: "501", tipo: "D", valor: 200 },
      { id: "l3", conta: "553", tipo: "C", valor: 1200 },
    ],
    totalD: 1200,
    totalC: 1200,
    ...over,
  };
}

function simples() {
  return {
    id: "e-simples",
    data: "2026-07-10T00:00:00.000Z",
    competencia: "2026-07",
    historico: "ALUGUEL 07/2026",
    tipo: "DESPESA",
    origem: "MANUAL",
    status: "RASCUNHO",
    lines: [
      { id: "s1", conta: "265", tipo: "D", valor: 300 },
      { id: "s2", conta: "5", tipo: "C", valor: 300 },
    ],
    totalD: 300,
    totalC: 300,
  };
}

function montar(entry, onUpdate = jest.fn().mockResolvedValue({ ok: true })) {
  render(
    <table><tbody>
      <AccountRow
        entry={entry}
        accounts={CONTAS}
        onUpdate={onUpdate}
        onDelete={jest.fn()}
        saving={false}
        onSearchHistoricos={jest.fn().mockResolvedValue([])}
        onGetHistoricosByCode={jest.fn().mockResolvedValue([])}
      />
    </tbody></table>,
  );
  return { onUpdate };
}

function editar() {
  fireEvent.click(screen.getByTitle("Editar lançamento"));
}

function salvar() {
  return screen.getByRole("button", { name: /^Salvar$/ });
}

describe("✎ num lançamento COMPOSTO", () => {
  it("⚠ salva as TRÊS linhas — a de juros não pode sumir do payload", async () => {
    const { onUpdate } = montar(composto());
    editar();
    fireEvent.click(salvar());

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [entryId, payload] = onUpdate.mock.calls[0];
    expect(entryId).toBe("e-parc");
    expect(payload.lines).toHaveLength(3);

    const juros = payload.lines.find((l) => l.conta === "501");
    expect(juros).toBeTruthy();
    expect(juros.tipo).toBe("D");
    expect(juros.valor).toBe(200);

    // E o lançamento continua fechando: 1.000 + 200 = 1.200.
    const somaD = payload.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + l.valor, 0);
    const somaC = payload.lines.filter((l) => l.tipo === "C").reduce((s, l) => s + l.valor, 0);
    expect(somaD).toBe(1200);
    expect(somaC).toBe(1200);
  });

  it("abre com as três linhas à vista — não com um resumo de duas", () => {
    montar(composto());
    editar();

    // As três contas do lançamento estão editáveis, cada uma com o seu valor.
    const contas = screen.getAllByPlaceholderText("Cód. ou nome").map((i) => i.value);
    expect(contas).toEqual(["265", "501", "553"]);
    expect(screen.getByText("Juros sobre Parcelamento")).toBeInTheDocument();
  });

  it("preserva tipo e subtipo — a edição é das linhas, não da classificação", () => {
    const { onUpdate } = montar(composto());
    editar();
    fireEvent.click(salvar());

    const payload = onUpdate.mock.calls[0][1];
    expect(payload.tipo).toBe("PROVISAO");
    expect(payload.subtipo).toBe("PARC_DAS");
  });

  it("desbalancear BLOQUEIA o Salvar e diz de quanto é a diferença", () => {
    const { onUpdate } = montar(composto());
    editar();

    // Zera o juros: Σ D passa a 1.000 contra Σ C 1.200.
    const valores = screen.getAllByPlaceholderText("0,00");
    fireEvent.change(valores[1], { target: { value: "0" } });

    expect(salvar()).toBeDisabled();
    expect(screen.getByText(/Diferença: R\$ 200,00/)).toBeInTheDocument();
    fireEvent.click(salvar());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("cancelar não grava nada", () => {
    const { onUpdate } = montar(composto());
    editar();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByTitle("Editar lançamento")).toBeInTheDocument();
  });
});

describe("✎ num lançamento SIMPLES continua como estava", () => {
  it("abre a linha de 1 débito / 1 crédito / 1 valor", () => {
    montar(simples());
    editar();

    // O editor de N linhas não aparece aqui: 1D/1C cabe na linha da tabela.
    expect(screen.getByPlaceholderText("D")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("C")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Cód. ou nome")).not.toBeInTheDocument();
  });
});
