// O CICLO DE VIDA da guia, que é o que o chip da listagem desenha.
//
//                       ┌─→ gerada ─→ enviada        (terminais bons)
//   missing ────────────┤
//                       └─→ vazio                    (terminal: ausência confirmada)
//
// `conflito` = marcado sem movimento MAS há nota emitida na competência — a afirmação envelheceu.
// `na` = não exigido pelo regime → o chip nem renderiza.
//
// Réplica de `resolveNode` (`guideCompliance.js`). Se as duas divergirem, este teste deixa de
// proteger — mantenha-as juntas. O que se trava aqui é a PRECEDÊNCIA, que antes emergia de um `if`
// e fazia um marcador VAZIO ficar órfão em silêncio.

function resolveNode(node, presente, vazio, { semFaturamento = false, faturamento = 0 } = {}) {
  if (!node.required) return { ...node, ok: true, state: "na" };
  if (presente) {
    const enviada = String(presente.emailStatus || "").toUpperCase() === "SENT";
    return { ...node, ok: true, state: enviada ? "enviada" : "gerada", guideId: presente.guideId };
  }
  if (vazio || semFaturamento) {
    if (faturamento > 0) {
      return { ...node, ok: false, state: "conflito", faturamento, origem: vazio ? "guia_vazia" : "sem_faturamento" };
    }
    return { ...node, ok: true, state: "vazio", origem: vazio ? "guia_vazia" : "sem_faturamento" };
  }
  return { ...node, ok: false, state: "missing" };
}

const exigido = { required: true, ok: false, state: "missing" };
const naoExigido = { required: false, ok: true, state: "na" };

describe("ciclo de vida do nó de guia", () => {
  test("não exigido pelo regime → `na` (o chip não renderiza)", () => {
    expect(resolveNode(naoExigido).state).toBe("na");
  });

  test("exigido e sem nada → missing (vermelho: trabalho pendente)", () => {
    const r = resolveNode(exigido, undefined, undefined);
    expect(r.state).toBe("missing");
    expect(r.ok).toBe(false);
  });

  test("guia existe e NÃO foi enviada → gerada, com o guideId para o botão de enviar", () => {
    const r = resolveNode(exigido, { guideId: "g1", emailStatus: "PENDING" }, undefined);
    expect(r.state).toBe("gerada");
    expect(r.guideId).toBe("g1");
    expect(r.ok).toBe(true);
  });

  test("guia enviada → enviada", () => {
    expect(resolveNode(exigido, { guideId: "g1", emailStatus: "SENT" }, undefined).state).toBe("enviada");
  });

  test("guia real VENCE marcador vazio — o documento existe, a ausência não", () => {
    const r = resolveNode(exigido, { guideId: "g1", emailStatus: "SENT" }, { guideId: "v1" });
    expect(r.state).toBe("enviada");
  });

  test("marcador vazio sem faturamento → vazio (cinza, terminal)", () => {
    const r = resolveNode(exigido, undefined, { guideId: "v1", vazioPor: "u1" });
    expect(r.state).toBe("vazio");
    expect(r.ok).toBe(true);
    expect(r.origem).toBe("guia_vazia");
  });

  test("mês sem faturamento também resolve o DAS como vazio — e NÃO some da tela", () => {
    // Revoga a decisão antiga de "sumir com a tag": chip ausente significava duas coisas
    // diferentes e o contador não tinha como saber qual estava vendo.
    const r = resolveNode(exigido, undefined, undefined, { semFaturamento: true });
    expect(r.state).toBe("vazio");
    expect(r.origem).toBe("sem_faturamento");
  });

  test("CONFLITO: marcado vazio mas entrou nota emitida → volta a exigir ação", () => {
    const r = resolveNode(exigido, undefined, { guideId: "v1" }, { faturamento: 17640 });
    expect(r.state).toBe("conflito");
    expect(r.ok).toBe(false);          // conta como pendência no filtro do dashboard
    expect(r.faturamento).toBe(17640); // o valor aparece na mensagem
  });

  test("conflito vale também para o mês sem faturamento", () => {
    const r = resolveNode(exigido, undefined, undefined, { semFaturamento: true, faturamento: 500 });
    expect(r.state).toBe("conflito");
    expect(r.origem).toBe("sem_faturamento");
  });

  test("faturamento NÃO derruba guia que existe de verdade", () => {
    // Ter receita e ter guia é o caso NORMAL — o conflito é sobre a ausência afirmada, não sobre
    // a presença. Sem esta guarda, toda empresa com faturamento ficaria vermelha.
    const r = resolveNode(exigido, { guideId: "g1", emailStatus: "SENT" }, undefined, { faturamento: 99999 });
    expect(r.state).toBe("enviada");
  });
});
