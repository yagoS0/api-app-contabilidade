import { avisosMock, revisaoMock, corrigirMock, conferirMock, retomarMock } from "../pagamentoClienteCorrecaoMock";
beforeEach(() => localStorage.clear());
test("correção tem revisão, isolamento e histórico após reconferir", () => {
 expect(() => corrigirMock("A", "2026-09", { motivo: "", versao: "1" }, {})).toThrow();
 const antes = { entries: [{ historico: "Anterior" }] }, depois = { entries: [{ historico: "Corrigido" }] };
 corrigirMock("A", "2026-09", { motivo: "Corrigir", versao: "1" }, antes);
 expect(avisosMock("A").total).toBe(1); expect(avisosMock("B").total).toBe(0); expect(avisosMock("A", { competencia: "2026-10" }).total).toBe(0);
 expect(() => conferirMock("A", "2026-09", "1", depois)).toThrow();
 conferirMock("A", "2026-09", revisaoMock("A", "2026-09"), depois);
 expect(avisosMock("A").total).toBe(0); expect(avisosMock("A").historico[0]).toMatchObject({ antes, depois, status: "RESOLVIDA" });
});
test("retomada não inventa confirmação nem baixa real", () => { expect(() => retomarMock("A", "inexistente")).toThrow(); });

test("pagamento segue mês do pagamento, mesmo com competência tributária diferente", () => {
 localStorage.setItem("altan:demo:avisos-contabeis:A", JSON.stringify({ versoes: {}, correcoes: [], historico: [], pagamentos: [{ id: "p", origem: "CLIENTE", competencia: "2026-08", competenciaPagamento: "2026-09" }] }));
 expect(avisosMock("A", { competencia: "2026-09" }).pagamentos).toEqual([expect.objectContaining({ id: "p" })]);
 expect(avisosMock("A", { competencia: "2026-08" }).pagamentos).toEqual([]);
 expect(avisosMock("B", { competencia: "2026-09" }).total).toBe(0);
});
