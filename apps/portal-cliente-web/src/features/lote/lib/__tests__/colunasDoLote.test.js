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

import {
  COLUNAS_DO_LOTE,
  CAMPOS_DA_REVISAO,
  CAMPOS_DE_ENDERECO,
  CHAVES_DO_LOTE,
  NOME_DO_ARQUIVO_MODELO,
  rotuloDaColuna,
} from "../colunasDoLote";
// A AUTORIDADE, importada do backend.
import {
  COLUNAS_LOTE,
  CAMPOS_DA_REVISAO as CAMPOS_DA_REVISAO_BACKEND,
  CAMPOS_ENDERECO,
} from "../../../../../../api/src/application/nfse/lote/colunasLote.js";
import { NOME_DO_ARQUIVO } from "../../../../../../api/src/application/nfse/lote/modeloPlanilhaLote.js";

describe("⚠⚠ o espelho bate com a lista fechada do backend", () => {
  test("as MESMAS chaves de COLUNA, na MESMA ordem", () => {
    expect(CHAVES_DO_LOTE).toEqual(COLUNAS_LOTE.map((c) => c.chave));
  });

  test("os MESMOS rótulos — é o que a pessoa lê no cabeçalho da planilha dela", () => {
    expect(COLUNAS_DO_LOTE.map((c) => c.rotulo)).toEqual(COLUNAS_LOTE.map((c) => c.rotulo));
  });

  test("a MESMA obrigatoriedade", () => {
    expect(COLUNAS_DO_LOTE.map((c) => c.obrigatoria)).toEqual(COLUNAS_LOTE.map((c) => c.obrigatoria));
  });

  // ⚠⚠ A LISTA DO AJUSTE É A QUE O SERVIDOR VALIDA. Uma chave a mais aqui vira
  // `ajuste_coluna_desconhecida` na cara de quem corrigiu; uma a menos some do formulário, e
  // ninguém consegue corrigir o campo que a pendência pede.
  test("⚠⚠ os MESMOS campos de REVISÃO, na mesma ordem e com o mesmo `naPlanilha`", () => {
    expect(CAMPOS_DA_REVISAO.map((c) => c.chave)).toEqual(CAMPOS_DA_REVISAO_BACKEND.map((c) => c.chave));
    expect(CAMPOS_DA_REVISAO.map((c) => c.rotulo)).toEqual(CAMPOS_DA_REVISAO_BACKEND.map((c) => c.rotulo));
    expect(CAMPOS_DA_REVISAO.map((c) => c.naPlanilha)).toEqual(
      CAMPOS_DA_REVISAO_BACKEND.map((c) => c.naPlanilha)
    );
  });

  test("o bloco de endereço é o mesmo, inclusive o `xCpl` opcional", () => {
    expect([...CAMPOS_DE_ENDERECO]).toEqual([...CAMPOS_ENDERECO]);
  });

  test("o nome do arquivo do modelo é o que o servidor gera", () => {
    expect(NOME_DO_ARQUIVO_MODELO).toBe(NOME_DO_ARQUIVO);
  });
});

describe("o que a tela precisa das listas", () => {
  // ⚠⚠ QUATRO COLUNAS, TODAS OBRIGATÓRIAS. Dono (20/08/2026): *"não precisamos de nada do tomador,
  // apenas o CNPJ ou CPF."* Eram doze até então.
  test("⚠⚠ a PLANILHA tem quatro colunas, e todas são obrigatórias", () => {
    expect(COLUNAS_DO_LOTE.map((c) => c.chave)).toEqual(["documento", "descricao", "valor", "competencia"]);
    expect(COLUNAS_DO_LOTE.every((c) => c.obrigatoria)).toBe(true);
  });

  // ⚠ Elas não sumiram do fluxo: mudaram de lugar. É a revisão que as pede, e só quando o cadastro
  // de tomador e a consulta à Receita não responderem.
  test("⚠⚠ nome, e-mail e endereço só existem na REVISÃO", () => {
    const soNaRevisao = CAMPOS_DA_REVISAO.filter((c) => !c.naPlanilha).map((c) => c.chave);
    expect(soNaRevisao).toEqual(["nome", "email", "cMun", "cep", "xLgr", "nro", "xBairro", "xCpl"]);
    for (const chave of soNaRevisao) expect(CHAVES_DO_LOTE).not.toContain(chave);
  });

  // ⚠ *"Retire o campo de atividade — o cliente não sabe escolher isso"* (dono). O código de serviço
  // sai do CADASTRO da empresa; nem a planilha nem a revisão o oferecem.
  test("⚠ não há campo de atividade / código de serviço em nenhuma das duas listas", () => {
    const todas = [...CHAVES_DO_LOTE, ...CAMPOS_DA_REVISAO.map((c) => c.chave)];
    for (const proibida of ["atividade", "cTribNac", "codigoServicoNacional"]) {
      expect(todas).not.toContain(proibida);
    }
  });

  // ⚠ *"Código do IBGE é abstração"* (dono). O rótulo do campo diz MUNICÍPIO, não código — e quem o
  // preenche é o `SeletorMunicipio`, que devolve o código junto da escolha.
  test("⚠ o campo do município se chama “Município do tomador”, nunca “código IBGE”", () => {
    expect(rotuloDaColuna("cMun")).toBe("Município do tomador");
    expect(rotuloDaColuna("cMun")).not.toMatch(/IBGE|código/i);
  });

  test("`rotuloDaColuna` devolve o rótulo, e a chave desconhecida sai como veio", () => {
    expect(rotuloDaColuna("cep")).toBe("CEP do tomador");
    expect(rotuloDaColuna("inventado")).toBe("inventado");
  });
});
