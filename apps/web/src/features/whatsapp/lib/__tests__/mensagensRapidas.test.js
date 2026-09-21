import { descricaoMensagem, lerUsosMensagens, registrarUsoMensagem, ultimasOrientacoes, normalizarBuscaMensagem } from "../mensagensRapidas";
beforeEach(() => localStorage.clear());
test("guarda somente chave e contagem por usuário, sem compartilhar preferências", () => {
  registrarUsoMensagem("usuario-a", "orientacao:autorizacao");
  registrarUsoMensagem("usuario-a", "orientacao:autorizacao");
  expect(lerUsosMensagens("usuario-a")).toEqual({ "orientacao:autorizacao": 2 });
  expect(lerUsosMensagens("usuario-b")).toEqual({});
  expect(JSON.parse(localStorage.getItem(localStorage.key(0)))).toEqual({ "orientacao:autorizacao": 2 });
});
test("sem usuário não lê preferências globais e mantém uso somente na sessão", () => {
  expect(registrarUsoMensagem(null, "formulario:ABERTURA", {})).toEqual({ "formulario:ABERTURA": 1 });
  expect(localStorage.length).toBe(0); expect(lerUsosMensagens(null)).toEqual({});
});
test("armazenamento bloqueado ou corrompido não impede uso de mensagem", () => {
  const bloqueado = { getItem: () => { throw Error("bloqueado"); }, setItem: () => { throw Error("bloqueado"); } };
  expect(lerUsosMensagens("u", bloqueado)).toEqual({});
  expect(registrarUsoMensagem("u", "orientacao:cnpj", {}, bloqueado)).toEqual({ "orientacao:cnpj": 1 });
  let memoria = registrarUsoMensagem("u", "orientacao:cnpj", {}, bloqueado);
  memoria = registrarUsoMensagem("u", "orientacao:cnpj", memoria, bloqueado);
  memoria = registrarUsoMensagem("u", "orientacao:autorizacao", memoria, bloqueado);
  expect(memoria).toEqual({ "orientacao:cnpj": 2, "orientacao:autorizacao": 1 });
  const invalido = { getItem: () => '{"orientacao:cnpj":-1,"texto":"conteúdo","orientacao:ok":2}' };
  expect(lerUsosMensagens("u", invalido)).toEqual({ "orientacao:ok": 2 });
});
test("descrição legível nunca usa texto com marcadores como explicação", () => {
  expect(descricaoMensagem({ tipo: "ORIENTACAO", chave: "cnpj", texto: "{{nome}} {{cnpj}}" })).toBe("Pedir o CNPJ para conferir os dados públicos da empresa.");
  expect(descricaoMensagem({ tipo: "ORIENTACAO", chave: "custom", texto: "{{nome}}" })).not.toContain("{{");
  expect(descricaoMensagem({ dados: { descricao: "Ensinar a assinar o contrato." } })).toBe("Ensinar a assinar o contrato.");
  expect(normalizarBuscaMensagem("  Procuração ")).toBe("procuracao");
});
test("a última orientação aprovada conserva prioridade sobre rascunho novo", () => {
  const base = { tipo: "ORIENTACAO", chave: "cnpj" };
  const atual = { ...base, versao: 2, aprovadoEm: "2026-09-01" };
  expect(ultimasOrientacoes([{ ...base, versao: 1, aprovadoEm: "2026-08-01" }, atual, { ...base, versao: 3, aprovadoEm: null }])).toEqual([atual]);
});
