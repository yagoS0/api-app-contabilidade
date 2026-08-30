// ⚠⚠ OS IDS DO MOCK TÊM DE SER ÚNICOS DENTRO DE CADA LISTA (30/08/2026).
//
// ⚠ ESTE TESTE NASCEU DE UM DEFEITO REAL, achado no console do navegador e por nada mais: uma linha
// nova do casamento reusou o `dec-12`, que já era o débito da PAPELARIA CENTRAL. React avisa
// (*"Encountered two children with the same key"*) e **segue renderizando** — a lista pode duplicar
// ou OMITIR uma linha, e omitir aqui significa um débito do extrato sumindo da tela do contador
// sem erro nenhum.
//
// ⚠ Nenhuma suíte pegava: o teste de componente monta a lista com fixture própria, e o `npm run
// build` não olha dado. Quem paga é quem edita o mock — que é o caminho normal de toda feature
// nova deste projeto.

import { createMockApi } from "../mockApi";

const api = createMockApi();

const duplicados = (ids) => {
  const vistos = new Set();
  const repetidos = new Set();
  for (const id of ids) {
    if (vistos.has(id)) repetidos.add(id);
    vistos.add(id);
  }
  return [...repetidos];
};

describe("⚠⚠ o mock não repete id dentro da mesma lista", () => {
  it("o casamento débito × nota: cada DÉBITO aparece uma vez", async () => {
    const r = await api.getConferenciaCasamentos("emp-1");
    const ids = (r.linhas || []).map((l) => l.debito?.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(duplicados(ids)).toEqual([]);
  });

  it("as regras do fornecedor", async () => {
    const r = await api.getConferenciaRegras("emp-1");
    expect(duplicados((r.regras || []).map((x) => x.id))).toEqual([]);
  });

  it("o extrato de lançados por regra", async () => {
    const r = await api.getLancadosPorRegra("emp-1", "2026-08");
    expect(duplicados((r.linhas || []).map((x) => x.id))).toEqual([]);
  });

  it("as saídas que o cliente acrescentou", async () => {
    const r = await api.getConferenciaSaidasDoCliente("emp-1");
    expect(duplicados((r.saidas || []).map((x) => x.id))).toEqual([]);
  });

  it("a fila de conferência", async () => {
    const r = await api.getConferenciaFila("emp-1", { competencia: "2026-07" });
    expect(duplicados((r.itens || []).map((x) => x.id))).toEqual([]);
  });
});
