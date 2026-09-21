import { criarMockComercial } from "../../../../api/mock/comercialMock";
test("mock respeita versão, exclusão de rascunho e preservação de versão aprovada", async () => {
  const api = criarMockComercial({ onboardings: new Map(), persistir: jest.fn() });
  const body = { tipo: "ORIENTACAO", chave: "cnpj", titulo: "Pedir CNPJ", texto: "Informe o CNPJ.", dados: {} };
  const publicada = (await api.comercial("/recursos", body)).recurso;
  await api.comercial(`/recursos/${publicada.id}/aprovar`, {});
  const rascunho = (await api.comercial("/recursos", { ...body, titulo: "Revisão" })).recurso;
  await expect(api.comercial(`/recursos/${publicada.id}`, { versao: publicada.versao }, "DELETE")).rejects.toThrow("foi aprovado");
  await expect(api.comercial(`/recursos/${rascunho.id}`, { versao: rascunho.versao + 1 }, "DELETE")).rejects.toThrow("mudou");
  await expect(api.comercial(`/recursos/${rascunho.id}`, { versao: rascunho.versao }, "DELETE")).resolves.toMatchObject({ excluido: true });
  expect((await api.comercial("/recursos")).recursos).toEqual([publicada]);
});
