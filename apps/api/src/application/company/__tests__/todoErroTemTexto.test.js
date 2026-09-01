// ⚠⚠ A ARMADILHA: TODO CÓDIGO DE RECUSA DO CADASTRO TEM DE TER TEXTO EM PORTUGUÊS.
//
// Este teste não confere uma frase — ele confere que **não existe código órfão**. Ele é a razão
// de a Fase 3 não envelhecer: sem ele, o próximo `return { ok:false, error:"company_algo_novo" }`
// escrito por qualquer pessoa volta a chegar à tela em `snake_case`, e ninguém descobre até um
// contador ler "company_algo_novo" no meio de um formulário.
//
// Foi exatamente assim que os 48 códigos deste caminho ficaram sem tradução: cada um deles foi
// acrescentado sozinho, num commit em que ninguém estava pensando em mensagem de tela.
//
// ⚠ Ele varre a FONTE, não uma lista escrita à mão. Uma lista à mão precisaria ser atualizada
// junto — e é a atualização que se esquece.

import fs from "node:fs";
import path from "node:path";
import { codigosDeCadastroConhecidos } from "@contabilidade/shared/erros-cadastro-empresa";

// ⚠ `__dirname`, nao `import.meta.url`: o jest desta app transpila ESM para CJS, e ali
//   `import.meta` nao existe. E o molde ja usado por `auditoriaNaoEscreve.test.js`.
//   Daqui (`src/application/company/__tests__`) o `src/` esta tres niveis acima.
const RAIZ = path.resolve(__dirname, "../../..");

/** Os arquivos que produzem recusa no caminho do cadastro de empresa. */
const FONTES = [
  "application/company/companyProfile.js",
  "application/companies/CompanyProvisioningService.js",
];

function codigosDoArquivo(rel) {
  const texto = fs.readFileSync(path.join(RAIZ, rel), "utf8");
  const achados = new Set();
  // `return { ok: false, error: "company_x" }` e `new CompanyProvisioningError("owner_y", …)`
  for (const m of texto.matchAll(/error:\s*"([a-z0-9_]+)"/g)) achados.add(m[1]);
  for (const m of texto.matchAll(/CompanyProvisioningError\(\s*"([a-z0-9_]+)"/g)) achados.add(m[1]);
  return achados;
}

describe("todo erro do cadastro chega à tela em português", () => {
  const conhecidos = new Set(codigosDeCadastroConhecidos());

  test.each(FONTES)("%s — nenhum código sem texto", (rel) => {
    const codigos = [...codigosDoArquivo(rel)];
    // Prova que a varredura está achando algo: se o regex quebrar, ela passaria vazia e verde.
    expect(codigos.length).toBeGreaterThan(5);

    const semTexto = codigos.filter((c) => !conhecidos.has(c));
    // ⚠ A mensagem do `expect` NOMEIA os órfãos — quem quebrar este teste amanhã precisa saber
    //   qual código escrever, não que "algo" faltou.
    expect({ arquivo: rel, semTexto }).toEqual({ arquivo: rel, semTexto: [] });
  });

  test("⚠ os três códigos GERADOS por template também têm texto", () => {
    // `company_${snakeCasePercentual(campo)}_invalid` — o regex acima não os vê, porque no fonte
    // eles são uma interpolação. Mudando o nome lá, este teste é quem cai.
    for (const c of [
      "company_p_tot_trib_fed_invalid",
      "company_p_tot_trib_est_invalid",
      "company_p_tot_trib_mun_invalid",
    ]) {
      expect(conhecidos.has(c)).toBe(true);
    }
  });

  test("código desconhecido devolve null — nunca uma frase inventada", async () => {
    const { mensagemDoErroDeCadastro } = await import("@contabilidade/shared/erros-cadastro-empresa");
    expect(mensagemDoErroDeCadastro("codigo_que_nao_existe", {})).toBeNull();
    expect(mensagemDoErroDeCadastro("", {})).toBeNull();
    expect(mensagemDoErroDeCadastro(null, null)).toBeNull();
  });

  test("o endereço NOMEIA os campos que faltam, a partir do `details`", async () => {
    const { mensagemDoErroDeCadastro } = await import("@contabilidade/shared/erros-cadastro-empresa");
    const um = mensagemDoErroDeCadastro("company_endereco_required_fields_missing", {
      details: ["endereco.cep"],
    });
    expect(um).toBe("Falta CEP no endereço.");

    const dois = mensagemDoErroDeCadastro("company_endereco_required_fields_missing", {
      details: ["endereco.cep", "endereco.numero"],
    });
    expect(dois).toBe("Faltam CEP e Número no endereço.");

    // ⚠ SEM `details` a frase ainda diz o QUE houve — só não inventa QUAL campo.
    const sem = mensagemDoErroDeCadastro("company_endereco_required_fields_missing", {});
    expect(sem).toBe("O endereço está incompleto.");
    expect(sem).not.toMatch(/CEP|Número/);
  });
});
