// O SALVAR DO CADASTRO NÃO PODE DESFAZER O SALVAR DA ABA DE EMISSÃO.
//
// ⚠ POR QUE ESTE TESTE EXISTE, e ele guarda um defeito que só aparece na SEGUNDA ação.
//
// A partir de 19/08/2026 há dois caminhos de escrita sobre a mesma empresa: `PATCH .../emissao-nfse`
// (a aba, com os sete campos dela) e o `PATCH /firm/companies/:id` do cadastro, que manda a empresa
// INTEIRA a partir do `editCompanyForm`. Esse formulário é remapeado **só quando muda de empresa** —
// então, sem um conserto explícito, esta sequência perderia trabalho em silêncio:
//
//   1. o contador abre a aba Cadastro (o form é semeado com a série antiga);
//   2. vai à aba Emissão de NFS-e e salva a série nova (grava pela rota própria);
//   3. volta ao Cadastro, troca o telefone e clica em "Salvar alterações";
//   4. o payload leva a série ANTIGA, que o form nunca soube ter mudado — e a grava por cima.
//
// O conserto é uma linha: depois de salvar pela rota da aba, o `editCompanyForm` recebe o que foi
// gravado. Este teste tranca essa linha. ⚠ Ele varre a FONTE (mesmo formato de
// `mensagensSemFila.test.js`) porque montar o workspace inteiro exigiria api, feedback e router —
// e o que precisa ser provado aqui é o que o handler faz, não como o React o chama.

import fs from "node:fs";
import path from "node:path";

const HOOK = [
  path.join(process.cwd(), "src", "app", "hooks", "useManageCompaniesWorkspace.js"),
  path.join(process.cwd(), "apps", "web", "src", "app", "hooks", "useManageCompaniesWorkspace.js"),
].find((p) => fs.existsSync(p));

test("o arquivo foi encontrado — senão esta varredura seria um teste vazio", () => {
  expect(HOOK).toBeTruthy();
});

const fonte = fs.readFileSync(HOOK, "utf8");
const corpo = fonte.slice(
  fonte.indexOf("async function handleUpdateEmissaoNfse"),
  fonte.indexOf("async function handleSuspendCompany"),
);

describe("handleUpdateEmissaoNfse", () => {
  test("existe e chama a ROTA PRÓPRIA da aba", () => {
    expect(corpo).toContain("api.updateEmissaoNfse(");
  });

  // ⚠ Se ele caísse no `updateCompany`, a aba mandaria a empresa inteira: a rota do cadastro
  // recusaria com 400 por falta de CNPJ, razão social, CNAE e endereço — que a aba não tem.
  test("NÃO usa o salvar do cadastro", () => {
    expect(corpo).not.toContain("api.updateCompany(");
  });

  // ⚠ A LINHA QUE ESTE ARQUIVO EXISTE PARA GUARDAR.
  test("atualiza o formulário do cadastro com o que foi gravado", () => {
    expect(corpo).toContain("editCompanyForm.setForm");
    for (const campo of ["rpsSerie", "codigoServicoMunicipal", "pTotTribFed", "pTotTribEst", "pTotTribMun", "codigosServicoNacional"]) {
      expect(corpo).toContain(campo);
    }
  });

  // ⚠⚠ O BENEFÍCIO MUNICIPAL TEM DE ESTAR NA MESMA LINHA (dono, 20/08/2026), e aqui o preço do
  // esquecimento é maior que nos demais: salvar o benefício pela aba e depois clicar em "Salvar
  // alterações" no cadastro mandaria os campos velhos (vazios) e o APAGARIA — sem nada mudar na
  // tela. Benefício apagado por engano é a nota saindo com imposto cheio sem ninguém ter pedido.
  test("atualiza também o benefício municipal — campo novo aqui é campo apagado depois", () => {
    for (const campo of [
      "beneficioMunicipalNumero",
      "beneficioMunicipalTipoReducao",
      "beneficioMunicipalPRedBC",
    ]) {
      expect(corpo).toContain(campo);
    }
  });

  test("recarrega a carteira — a aba lê o gravado a partir do payload da empresa", () => {
    expect(corpo).toContain("await loadCompanies()");
  });
});

// ⚠ A OUTRA METADE DO MESMO DEFEITO: os sete campos têm de continuar no formulário do cadastro.
// `buildCompanyPayload` manda a empresa inteira e campo ausente vira `null` — tirá-los de lá faria
// o "Salvar alterações" APAGAR a configuração de emissão de quem foi só trocar o telefone.
describe("os campos continuam no estado do formulário do cadastro", () => {
  const FORM = [
    path.join(process.cwd(), "src", "features", "companies", "form", "hooks", "useManageCompanyForm.js"),
    path.join(process.cwd(), "apps", "web", "src", "features", "companies", "form", "hooks", "useManageCompanyForm.js"),
  ].find((p) => fs.existsSync(p));

  test("o arquivo foi encontrado", () => {
    expect(FORM).toBeTruthy();
  });

  test("`mapCompanyToEditForm` continua trazendo os campos de emissão", () => {
    const src = fs.readFileSync(FORM, "utf8");
    const mapa = src.slice(src.indexOf("export function mapCompanyToEditForm"));
    expect(mapa).toContain("mapCompanyToEmissaoNfseForm(company)");
  });
});
