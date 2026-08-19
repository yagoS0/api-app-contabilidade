// O ESPELHO DAS COLUNAS — amarrado à AUTORIDADE, que é o backend.
//
// ⚠⚠ SEM ESTE ARQUIVO, "espelho" É INTENÇÃO, NÃO FATO. A tela de ajuste manda para o servidor as
// CHAVES desta lista; uma chave que o backend não conheça é recusada nomeando
// (`ajuste_coluna_desconhecida`), e a divergência apareceria como *"corrigi o campo e o sistema
// disse que ele não existe"*. Uma coluna que o backend ganhasse e a lista daqui não tivesse é pior:
// ela some do formulário de ajuste e ninguém consegue corrigi-la.
//
// ⚠ O import cruzado funciona no TESTE (o Jest roda no monorepo inteiro) e **não** no código de
// produção: o Docker deste portal tem Root Directory `apps/portal-cliente-web` e `apps/api` não
// está no contexto de build. É a mesma solução de `emitir/lib/__tests__/codigoServicoDaNota.test.js`.

import { COLUNAS_DO_LOTE, CAMPOS_DE_ENDERECO, CHAVES_DO_LOTE, NOME_DO_ARQUIVO_MODELO, rotuloDaColuna } from "../colunasDoLote";
// A AUTORIDADE, importada do backend.
import { COLUNAS_LOTE, CAMPOS_ENDERECO } from "../../../../../../api/src/application/nfse/lote/colunasLote.js";
import { NOME_DO_ARQUIVO } from "../../../../../../api/src/application/nfse/lote/modeloPlanilhaLote.js";

describe("⚠⚠ o espelho bate com a lista fechada do backend", () => {
  test("as MESMAS chaves, na MESMA ordem", () => {
    expect(CHAVES_DO_LOTE).toEqual(COLUNAS_LOTE.map((c) => c.chave));
  });

  test("os MESMOS rótulos — é o que a pessoa lê no cabeçalho da planilha dela", () => {
    expect(COLUNAS_DO_LOTE.map((c) => c.rotulo)).toEqual(COLUNAS_LOTE.map((c) => c.rotulo));
  });

  test("a MESMA obrigatoriedade", () => {
    expect(COLUNAS_DO_LOTE.map((c) => c.obrigatoria)).toEqual(COLUNAS_LOTE.map((c) => c.obrigatoria));
  });

  test("o bloco de endereço é o mesmo, inclusive o `xCpl` opcional", () => {
    expect([...CAMPOS_DE_ENDERECO]).toEqual([...CAMPOS_ENDERECO]);
  });

  test("o nome do arquivo do modelo é o que o servidor gera", () => {
    expect(NOME_DO_ARQUIVO_MODELO).toBe(NOME_DO_ARQUIVO);
  });
});

describe("o que a tela precisa da lista", () => {
  test("as cinco obrigatórias continuam sendo cinco — a competência entre elas", () => {
    const obrigatorias = COLUNAS_DO_LOTE.filter((c) => c.obrigatoria).map((c) => c.chave);
    expect(obrigatorias).toEqual(["documento", "nome", "descricao", "valor", "competencia"]);
  });

  test("`rotuloDaColuna` devolve o rótulo, e a chave desconhecida sai como veio", () => {
    expect(rotuloDaColuna("cep")).toBe("CEP do tomador");
    expect(rotuloDaColuna("inventado")).toBe("inventado");
  });
});
