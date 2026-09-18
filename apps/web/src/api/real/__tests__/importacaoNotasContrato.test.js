import { createRealApi } from "../realApi";
import { importarNotasEmLotes } from "../importarNotasEmLotes";
import { resultadoImportacao } from "../../../features/notas/lib/resultadoImportacao";
test.each([["NFE", "nfe"], ["NFSE", "xml"]])("importação %s usa a rota própria e preserva o lote", async (type, rota) => {
  const anterior = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, importadas: 2, created: 2 }) }));
  try {
    const arquivos = [new File(["<nota/>"], "primeira.xml"), new File(["<nota/>"], "segunda.xml")];
    await createRealApi().importInvoicesXml("empresa-teste", arquivos, { type });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`/clients/empresa-teste/invoices/import/${rota}$`)), expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    expect(global.fetch.mock.calls[0][1].body.getAll("files").map(f => f.name)).toEqual(["primeira.xml", "segunda.xml"]);
  } finally { global.fetch = anterior; }
});

test.each([["NFE", 20, 47], ["NFSE", 50, 113]])("%s divide arquivos sem omissão nem repetição", async (type, limite, quantidade) => {
  const arquivos = Array.from({ length: quantidade }, (_, i) => new File(["<nota/>"], `${i}.xml`));
  const enviar = jest.fn(async (_url, { body }) => {
    const n = body.getAll("files").length;
    expect(n).toBeLessThanOrEqual(limite);
    return type === "NFE" ? { ok: true, importadas: n, emitidas: n, detalhes: [] } : { created: n, errors: [] };
  });
  const out = await importarNotasEmLotes(enviar, "empresa", arquivos, type);
  expect(enviar.mock.calls.flatMap(([, opts]) => opts.body.getAll("files").map(f => f.name))).toEqual(arquivos.map(f => f.name));
  expect(resultadoImportacao(out, type).mensagem).toContain(`${quantidade} nova(s)`);
});

test("falha no segundo lote conserva totais e motivos, sem enviar o terceiro nem repetir", async () => {
  const enviar = jest.fn().mockResolvedValueOnce({ ok: true, importadas: 19, recusadas: 1, detalhes: [{ arquivo: "outra.xml", resultado: "recusada", motivo: "outro_estabelecimento" }] }).mockRejectedValueOnce(new Error("request_failed_500"));
  const out = await importarNotasEmLotes(enviar, "empresa", Array.from({ length: 60 }, (_, i) => new File(["<nota/>"], `${i}.xml`)), "NFE");
  expect(enviar).toHaveBeenCalledTimes(2);
  expect(out).toMatchObject({ ok: false, importadas: 19, recusadas: 1 });
  const resultado = resultadoImportacao(out, "NFE");
  expect(resultado.mensagem).toContain("19 nova(s)");
  expect(resultado.mensagem).toContain("não foram enviados");
  expect(resultado.mensagem).not.toContain("request_failed");
  expect(resultado.problemas).toHaveLength(1);
});

test("erro de limite informado pelo servidor chega ao contador", async () => {
  const enviar = jest.fn().mockRejectedValue({ payload: { message: "Cada arquivo pode ter até 512 MB." } });
  const out = await importarNotasEmLotes(enviar, "empresa", [new File(["a"], "grande.zip")], "NFE");
  expect(out.mensagem).toContain("Cada arquivo pode ter até 512 MB.");
  expect(out.ok).toBe(false);
});

test("resposta vazia interrompe o envio sem anunciar sucesso", async () => {
  const enviar = jest.fn().mockResolvedValue({});
  const out = await importarNotasEmLotes(enviar, "empresa", Array.from({ length: 21 }, () => new File(["a"], "nota.xml")), "NFE");
  expect(enviar).toHaveBeenCalledTimes(1);
  expect(out.ok).toBe(false);
  expect(out.mensagem).toContain("Não foi possível confirmar");
});

test("progresso conta só respostas confirmadas e conserva o lote interrompido", async () => {
  let confirmar;
  const enviar = jest.fn().mockImplementationOnce(() => new Promise(resolve => { confirmar = resolve; })).mockRejectedValueOnce(new Error("rede"));
  const progresso = jest.fn();
  const tarefa = importarNotasEmLotes(enviar, "empresa", Array.from({ length: 45 }, (_, i) => new File(["a"], `${i}.xml`)), "NFE", progresso);
  expect(progresso.mock.lastCall[0]).toMatchObject({ etapa: "processando", loteAtual: 1, lotesConcluidos: 0, totalLotes: 3, arquivosConcluidos: 0 });
  confirmar({ importadas: 18, duplicadas: 1, recusadas: 1, detalhes: [] });
  await tarefa;
  expect(progresso.mock.lastCall[0]).toMatchObject({ etapa: "interrompida", loteAtual: 2, lotesConcluidos: 1, arquivosConcluidos: 20, resultadoDesconhecido: true, totais: { novas: 18, duplicadas: 1, recusadas: 1 } });
});

test("ZIP único não conclui antes da resposta do servidor", async () => {
  let confirmar;
  const progresso = jest.fn();
  const tarefa = importarNotasEmLotes(() => new Promise(resolve => { confirmar = resolve; }), "empresa", [new File(["zip"], "notas.zip")], "NFE", progresso);
  expect(progresso.mock.lastCall[0].lotesConcluidos).toBe(0);
  confirmar({ importadas: 350, detalhes: [] });
  await tarefa;
  expect(progresso.mock.lastCall[0]).toMatchObject({ etapa: "concluida", lotesConcluidos: 1, arquivosConcluidos: 1, totais: { novas: 350 } });
});

test("sessão desmontada não envia os próximos lotes", async () => {
  let ativa = true;
  const enviar = jest.fn(async () => { ativa = false; return { importadas: 20 }; });
  const out = await importarNotasEmLotes(enviar, "empresa", Array.from({ length: 21 }, () => new File(["a"], "nota.xml")), "NFE", undefined, () => ativa);
  expect(enviar).toHaveBeenCalledTimes(1);
  expect(out).toMatchObject({ ok: false, importadas: 20 });
});
