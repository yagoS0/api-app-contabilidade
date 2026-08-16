// O MODAL "FOLHA / PRÓ-LABORE" NO MODO MOCK — e o `TypeError` cru que ele exibia.
//
// `getPayrollTemplate` existia só no `realApi`. Em "Funções → + Folha / Pró-labore", no lugar da
// tabela aparecia **"api.getPayrollTemplate is not a function"**: a folha, primeiro item do
// check-list de fechamento, era o único fluxo grande da aba impossível de conferir offline.
// É o mesmo defeito do `getBaixaTemplate`, e contraria o `apps/web/CLAUDE.md`: *"toda feature nova
// deve ter implementação em AMBOS"*.
//
// ⚠ O que esta suíte protege é a PARIDADE COM O CONTRATO DO BACKEND
// (`apps/api/src/application/accounting/payrollTemplate.js` + `GET /payroll/template`), campo por
// campo. Mock que responde diferente do real esconde defeito — foi exatamente o que aconteceu com
// o `principalPerParcela` do wizard, que o mock derivava e o real nunca derivou.

import { render, screen } from "@testing-library/react";
import { createMockApi } from "../../../../../api/mock/mockApi";
import { PayrollEntryModal } from "../renderAccountingEntriesParts.jsx";

describe("mockApi.getPayrollTemplate — o par que faltava", () => {
  const api = createMockApi();
  let companyId;

  // Sem `resetModules` de propósito: o template é LEITURA (não escreve em `Map` nenhum), e os
  // estados do mock são de módulo — recarregá-lo a cada teste só custaria tempo.
  beforeAll(async () => {
    const empresas = await api.listCompanies();
    companyId = empresas[0].companyId;
  });

  it("⚠ existe — sem ela o modal abre vazio com um TypeError no lugar da tabela", () => {
    expect(typeof api.getPayrollTemplate).toBe("function");
  });

  it("devolve o envelope da rota: { ok, template }", async () => {
    const res = await api.getPayrollTemplate(companyId, "PROLABORE", "2026-07");
    expect(res.ok).toBe(true);
    expect(res.template).toBeTruthy();
  });

  it("o template tem os MESMOS campos do backend — nada a mais, nada a menos", async () => {
    const { template } = await api.getPayrollTemplate(companyId, "FOLHA", "2026-07");

    expect(Object.keys(template).sort()).toEqual(
      ["baixa", "competencia", "historicoTemplate", "inssGuide", "kind", "label", "lines"].sort(),
    );
    expect(template.kind).toBe("FOLHA");
    expect(template.label).toBe("Folha de Pagamento");
    expect(template.competencia).toBe("2026-07");

    // A linha, campo por campo — é o que o modal lê para montar cada `row`.
    for (const line of template.lines) {
      expect(Object.keys(line).sort()).toEqual(
        ["accountCode", "accountName", "historico", "label", "role", "side", "value"].sort(),
      );
      expect(["D", "C"]).toContain(line.side);
      expect(line.value).toBe(0);
    }
    // Os papéis da FOLHA, na ordem do backend.
    expect(template.lines.map((l) => l.role)).toEqual(["salary", "inss", "fgts", "irrf", "liquid"]);

    expect(Object.keys(template.baixa).sort()).toEqual(
      ["creditAccountCode", "creditAccountName", "debitAccountCode", "debitAccountName", "historico"].sort(),
    );
  });

  it("o histórico resolve {{competencia}} para MM/AAAA, como o backend", async () => {
    const { template } = await api.getPayrollTemplate(companyId, "PROLABORE", "2026-07");
    expect(template.historicoTemplate).toBe("PRÓ-LABORE - {{competencia}}");
    expect(template.lines[0].historico).toBe("VR REF PRO LAB FP 07/2026");
    expect(template.baixa.historico).toBe("PAGO PRO-LAB 07/2026");
  });

  it("a conta sai do PLANO DE CONTAS da empresa — não é inventada", async () => {
    const plano = await api.getChartOfAccounts(companyId);
    const { template } = await api.getPayrollTemplate(companyId, "PROLABORE", "2026-07");

    const codigos = new Set(plano.map((c) => String(c.codigo)));
    for (const line of template.lines) {
      // ⚠ `null` é resposta legítima: é o que o real devolve quando o plano não casa com nenhuma
      // dica. O que não pode existir é código que não está no plano.
      if (line.accountCode !== null) expect(codigos.has(String(line.accountCode))).toBe(true);
    }
    // A baixa credita o caixa/banco — a dica "caixa" casa com a conta 5 do plano do mock.
    expect(template.baixa.creditAccountCode).toBe("5");
    expect(template.baixa.creditAccountName).toBe("Caixa");
  });

  it("⚠ o débito da baixa é a conta do LÍQUIDO — o mesmo `debitFromRole` do backend", async () => {
    const { template } = await api.getPayrollTemplate(companyId, "PROLABORE", "2026-07");
    const liquid = template.lines.find((l) => l.role === "liquid");
    expect(template.baixa.debitAccountCode).toBe(liquid.accountCode);
    expect(template.baixa.debitAccountName).toBe(liquid.accountName);
  });

  it("kind desconhecido recusa com o CÓDIGO do servidor, não com um objeto vazio", async () => {
    await expect(api.getPayrollTemplate(companyId, "DECIMO", "2026-07"))
      .rejects.toMatchObject({ code: "UNKNOWN_PAYROLL_KIND" });
  });
});

describe("o modal quando o template não carrega", () => {
  function abrir(onLoadTemplate) {
    render(
      <PayrollEntryModal
        accounts={[]}
        defaultCompetencia="2026-07"
        onLoadTemplate={onLoadTemplate}
        onSave={jest.fn()}
        saving={false}
        onClose={jest.fn()}
      />,
    );
  }

  it("⚠ mostra frase humana — o TypeError fica no console, não na tela", async () => {
    // Exatamente o erro que o mock sem par produzia.
    abrir(jest.fn().mockRejectedValue(new TypeError("api.getPayrollTemplate is not a function")));

    expect(await screen.findByText(/Não foi possível carregar o modelo de folha/i)).toBeInTheDocument();
    expect(screen.queryByText(/is not a function/)).not.toBeInTheDocument();
  });

  it("a recusa NOMEADA do servidor continua chegando inteira", async () => {
    // Mensagem escrita para gente não pode virar mensagem genérica: `UNKNOWN_PAYROLL_KIND` diz o
    // que fazer, e engoli-la seria trocar um silêncio por outro.
    const err = new Error("Tipo de folha desconhecido: DECIMO.");
    err.code = "UNKNOWN_PAYROLL_KIND";
    abrir(jest.fn().mockRejectedValue(err));

    expect(await screen.findByText(/Tipo de folha desconhecido: DECIMO\./)).toBeInTheDocument();
  });
});
