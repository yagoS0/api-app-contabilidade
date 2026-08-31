// ⚠⚠ TRÊS DEFEITOS DA TELA DE LOTE, ACHADOS EM TESTE DE USABILIDADE (31/08/2026)
//
// Os três são varreduras da FONTE, não de comportamento — e a escolha é deliberada: o que eles
// protegem são três `if` que, removidos, não quebram nenhum render. O defeito só apareceria numa
// sequência longa no navegador (emitir → subir outra planilha), que é exatamente como foi achado.
//
// ⚠ É o mesmo arranjo de `saidasDoClienteNoFluxo.test.js`, que varre a fonte da rota.

import fs from "node:fs";
import path from "node:path";
// ⚠ `mensagemDeErro`, e não o mapa cru: `MENSAGENS` não é exportado, e testar pelo caminho REAL
// (código → frase) é o que prova que a entrada nova está no lugar em que a tela vai procurá-la.
import { mensagemDeErro } from "../../../lib/mensagens";

// ⚠ `__dirname` e não `import.meta` — o jest desta casa transpila para CJS, e `import.meta` não
// existe lá. É o mesmo arranjo de `guias/__tests__/chipDaGuiaTemCor.test.js`.
const FONTE_PAGINA = fs.readFileSync(path.join(__dirname, "../LotePlanilhaPage.jsx"), "utf8");

describe("⚠⚠ o relatório de um lote NÃO sobrevive à planilha seguinte", () => {
  /**
   * Achado: depois de emitir, subir outra planilha mostrava a conferência das linhas NOVAS com o
   * relatório do lote ANTIGO embaixo — números de nota, botões de DANFSe — e o botão "Emitir N
   * notas" DESAPARECIA (`{lote ? <RelatorioDoLote/> : <BlocoDeEmissao/>}`), deixando a tela sem
   * saída até sair e voltar.
   *
   * ⚠ O motivo já estava escrito no efeito de troca de EMPRESA: relatório de um lote visível sob
   * outro contexto faz acreditar que se emitiu o que não se emitiu. Valia para a empresa e não
   * valia para o arquivo — e é o arquivo que muda com mais frequência.
   */
  it("`escolherArquivo` zera o lote, o reconhecido e o erro de emissão", () => {
    const inicio = FONTE_PAGINA.indexOf("function escolherArquivo");
    expect(inicio).toBeGreaterThan(-1);
    const corpo = FONTE_PAGINA.slice(inicio, FONTE_PAGINA.indexOf("\n  }", inicio));
    for (const zera of ["setLote(null)", "setReconhecido(false)", "setErroEmissao(null)"]) {
      expect(corpo).toContain(zera);
    }
  });

  it("⚠ e continua zerando o que já zerava — leitura, recusa, ajuste em aberto e os ajustes", () => {
    const inicio = FONTE_PAGINA.indexOf("function escolherArquivo");
    const corpo = FONTE_PAGINA.slice(inicio, FONTE_PAGINA.indexOf("\n  }", inicio));
    for (const zera of ["setLeitura(null)", "setRecusa(null)", "setEmAjuste(null)", "setAjustes({})"]) {
      expect(corpo).toContain(zera);
    }
  });
});

describe("⚠⚠ o `Baixar` da DANFSe só existe na linha EMITIDA", () => {
  /**
   * Achado: numa linha **recusada pela Receita** o botão aparecia e entregava um PDF — DANFSe de
   * nota que não existe. A recusa acontece DEPOIS da reserva do número, então a linha recusada
   * PODE ter `serviceInvoiceId`; a guarda só olhava o id.
   *
   * ⚠ A pergunta certa é a do desfecho. Mesma disciplina de `estadoDaLinhaDoLote.js`: a tela só
   * REBAIXA, nunca promove.
   */
  it("a guarda pergunta pelo DESFECHO, não só pela presença do id", () => {
    const inicio = FONTE_PAGINA.indexOf("function BotaoDanfseDaLinha");
    expect(inicio).toBeGreaterThan(-1);
    const corpo = FONTE_PAGINA.slice(inicio, inicio + 1400);
    expect(corpo).toContain('linha?.desfecho !== "emitida"');
    // ⚠ E o id continua sendo exigido: sem ele não há o que pedir ao servidor.
    expect(corpo).toContain("!linha?.serviceInvoiceId");
  });
});

describe("⚠⚠ as recusas do lote têm frase própria — nunca o erro genérico", () => {
  /**
   * Achado: o 503 da integração desligada caía em `internal_error` — *"Algo deu errado do nosso
   * lado. Tente de novo em instantes."* — e o cliente tentaria de novo para sempre, porque não há
   * nada do lado dele para dar certo.
   *
   * ⚠ `mensagemDeErro` resolve por CÓDIGO e **não lê** `err.message`, de propósito (ela nunca
   * devolve texto cru do servidor). Sem a entrada no mapa, o conserto que o backend escreveu não
   * chega ao olho de ninguém — é a lição já escrita no `arquivo_grande_demais`.
   */
  it("`emissao_lote_desligada` tem frase, e ela diz QUEM resolve", () => {
    const generica = mensagemDeErro({ code: "codigo_que_nao_existe" });
    const frase = mensagemDeErro({ code: "emissao_lote_desligada" });
    // ⚠ O que se prova é que ela NÃO é a genérica — era nela que o 503 caía.
    expect(frase).not.toBe(generica);
    // Quem liga a integração é o escritório, não o cliente.
    expect(frase).toMatch(/escrit[óo]rio/i);
    // ⚠ E não pode convidar a repetir: repetir não resolve nada aqui.
    expect(frase).not.toMatch(/tente de novo|tentar novamente/i);
  });

  it("`nada_a_retentar` tem frase — o lote inteiro já virou nota é BOA notícia", () => {
    const generica = mensagemDeErro({ code: "codigo_que_nao_existe" });
    expect(mensagemDeErro({ code: "nada_a_retentar" })).not.toBe(generica);
  });

  it("⚠ e o `internal_error` continua sendo o que era — a entrada nova não sequestrou o genérico", () => {
    expect(mensagemDeErro({ code: "internal_error" })).toMatch(/nosso lado|tente de novo/i);
  });
});
