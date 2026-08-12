// O EVENTO QUE ESCREVEMOS TEM DE USAR O NOME QUE O LEIAUTE DÁ.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// `buildEventoXml` escrevia `<chNFSeSubst>` para a chave da NFS-e substituta, no evento e105102
// (cancelamento por substituição). Esse campo NÃO EXISTE. O nome oficial é **`chSubstituta`**:
//
//   ANEXO_II-SEFIN_ADN-PEDREGEVT_EVT-SNNFSe v1.01 (gov.br/nfse → Documentação Técnica →
//   Documentação Atual, `anexo_ii-sefin_adn-pedregevt_evt-snnfse-v1-01-20260122.xlsx`), linha 29:
//     evento/pedRegEvento/infPedReg/e105102/chSubstituta — N, 1-1, tam. 50,
//     "Chave de Acesso da NFS-e substituta."
//   Busca por `chNFSeSubst` no mesmo arquivo: ZERO ocorrências.
//
// O que tornava isso invisível: `AdnXmlMetadata.parseNfseEvento` sempre LEU `chSubstituta` (o nome
// certo, o que vem nos 6 eventos reais capturados do ADN). Nós escrevíamos um nome e líamos outro,
// e nenhum dos dois lados reclamava — só o ADN reclamaria, e este caminho nunca foi exercido.
//
// ⚠ Este teste lê o CÓDIGO-FONTE de propósito. `buildEventoXml` não é exportado, e exportá-lo só
// para o teste alargaria a superfície do módulo; o que precisa ficar travado é o literal da tag,
// que é exatamente o que se reescreve à mão sem perceber. Mesmo padrão de
// `guides/__tests__/envioSemFila.test.js`.

import fs from "node:fs";
import path from "node:path";

// ⚠ Sem `import.meta.url`: o Jest da API roda em CommonJS e `import.meta` é erro de SINTAXE.
// O caminho sai do `rootDir` do Jest, que é `apps/api`.
const NFSE_SERVICE = [
  path.join(process.cwd(), "src", "application", "nfse", "NfseService.js"),
  path.join(process.cwd(), "apps", "api", "src", "application", "nfse", "NfseService.js"),
].find((p) => fs.existsSync(p));

describe("e105102 — os campos do ANEXO_II v1.01", () => {
  const fonte = fs.readFileSync(NFSE_SERVICE, "utf8");
  // O comentário do arquivo cita os nomes errados para explicar o defeito; o teste tem de olhar
  // só o CÓDIGO, senão a própria documentação derruba a suíte.
  const codigo = fonte
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");

  it("escreve a chave da substituta como <chSubstituta>", () => {
    expect(codigo).toContain("<chSubstituta>");
  });

  it("NÃO escreve <chNFSeSubst> — campo que não existe no leiaute", () => {
    expect(codigo).not.toContain("chNFSeSubst");
  });

  it("NÃO escreve <nNFSeSubst> — o fallback por NÚMERO também era inventado", () => {
    // `chSubstituta` é 1-1 (obrigatório). Não há forma válida de pedir a substituição sem a
    // chave, então o caminho certo é recusar antes, não montar XML com campo de fantasia.
    expect(codigo).not.toContain("nNFSeSubst");
  });

  it("usa a descrição oficial do evento em <xDesc>", () => {
    // Linha 26 do anexo: "Descrição do evento: Cancelamento de NFS-e por Substituição".
    expect(codigo).toContain("<xDesc>Cancelamento de NFS-e por Substituição</xDesc>");
  });
});
