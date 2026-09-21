jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { criarRecursosComerciais } from "../RecursosComerciaisService.js";
const gestor = { id: "gestor", role: "contador" };
function banco(rows) {
  const db = { recursoComercial: { deleteMany: jest.fn(async ({ where }) => {
    const indice = rows.findIndex(r => r.id === where.id && r.versao === where.versao && r.aprovadoEm === where.aprovadoEm);
    if (indice < 0) return { count: 0 };
    rows.splice(indice, 1); return { count: 1 };
  }) } };
  return { rows, db, servico: criarRecursosComerciais({ db }) };
}
test("excluir uma versão em rascunho conserva a publicada e outra chave", async () => {
  const aprovado = { id: "v1", versao: 1, aprovadoEm: new Date() }, outro = { id: "outro", versao: 2, aprovadoEm: null };
  const f = banco([aprovado, { id: "v2", versao: 2, aprovadoEm: null }, outro]);
  await expect(f.servico.excluirRascunho("v2", 2, gestor)).resolves.toEqual({ excluido: true });
  expect(f.rows).toEqual([aprovado, outro]);
  expect(f.db.recursoComercial.deleteMany).toHaveBeenCalledWith({ where: { id: "v2", versao: 2, aprovadoEm: null } });
});
test("aprovação entre a leitura da tela e o DELETE protege a mesma versão", async () => {
  const r = { id: "v2", versao: 2, aprovadoEm: null }, f = banco([r]);
  r.aprovadoEm = new Date();
  await expect(f.servico.excluirRascunho("v2", 2, gestor)).rejects.toMatchObject({ code: "rascunho_indisponivel", status: 409 });
  expect(f.rows).toEqual([r]);
});
test.each([undefined, null, "2", 0, -1, 1.5, 2147483648])("sem versão válida (%s) não escreve", async versao => {
  const f = banco([{ id: "v2", versao: 2, aprovadoEm: null }]);
  await expect(f.servico.excluirRascunho("v2", versao, gestor)).rejects.toMatchObject({ code: "versao_necessaria" });
  expect(f.db.recursoComercial.deleteMany).not.toHaveBeenCalled();
});
test.each([undefined, null, "", "   "])("sem ID (%s) nunca permite DELETE amplo", async id => {
  const f = banco([{ id: "v2", versao: 2, aprovadoEm: null }]);
  await expect(f.servico.excluirRascunho(id, 2, gestor)).rejects.toMatchObject({ code: "recurso_necessario" });
  expect(f.db.recursoComercial.deleteMany).not.toHaveBeenCalled();
});
test.each([undefined, { id: "operador", role: "assistente" }, { role: "contador" }])("somente gestor pode descartar (%j)", async user => {
  const f = banco([]);
  await expect(f.servico.excluirRascunho("v2", 2, user)).rejects.toMatchObject({ code: "forbidden", status: 403 });
  expect(f.db.recursoComercial.deleteMany).not.toHaveBeenCalled();
});
test("versão diferente ou repetição da exclusão não apaga outro conteúdo", async () => {
  const f = banco([{ id: "v2", versao: 2, aprovadoEm: null }]);
  await expect(f.servico.excluirRascunho("v2", 1, gestor)).rejects.toMatchObject({ status: 409 });
  await f.servico.excluirRascunho("v2", 2, gestor);
  await expect(f.servico.excluirRascunho("v2", 2, gestor)).rejects.toMatchObject({ status: 409 });
});
