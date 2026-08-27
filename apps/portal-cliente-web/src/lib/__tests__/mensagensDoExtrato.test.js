// ⚠⚠ AS FRASES DO EXTRATO ESTÃO PENDURADAS NOS CÓDIGOS QUE O SERVIDOR REALMENTE MANDA?
//
// `mensagemDeErro` resolve por CÓDIGO e **não lê `err.message`**, de propósito ("nunca devolve
// texto cru do servidor"). Consequência: uma frase pendurada num código que não existe **nunca
// aparece** — e a recusa cai no `padrao`, perdendo o conserto que o backend escreveu.
//
// ⚠ ISTO NÃO É HIPÓTESE: a primeira versão do bloco do extrato em `mensagens.js` inventou três
// nomes com prefixo `ofx_` que não existem em lugar nenhum do backend. Este teste é a rede que
// teria pego, e é uma AMARRAÇÃO TEXTUAL — o backend não é importável daqui (cruzar apps quebra o
// boot), mesma disciplina do teste que amarra `"autorizada"` à `whereFaturamentoEmit`.

import fs from "node:fs";
import path from "node:path";
import { mensagemDeErro } from "../mensagens.js";

const FONTE_DO_SERVICO = fs.readFileSync(
  path.join(
    __dirname, "..", "..", "..", "..",
    "api", "src", "application", "declarados", "ImportOfxService.js",
  ),
  "utf8",
);

const FONTE_DA_ROTA = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "api", "src", "routes", "client", "index.js"),
  "utf8",
);

const PADRAO = "PADRAO_DO_TESTE";

describe("⚠⚠ os códigos do extrato existem no backend", () => {
  // Os que a TELA promete traduzir. Cada um tem de estar escrito na fonte do lado de lá.
  const DO_SERVICO = ["arquivo_vazio", "nenhuma_transacao", "extrato_grande_demais"];
  const DA_ROTA = ["arquivo_grande_demais", "arquivo_invalido", "ofx_import_falhou"];

  it.each(DO_SERVICO)("`%s` é um código real de `RECUSA_DO_IMPORT`", (codigo) => {
    expect(FONTE_DO_SERVICO).toContain(`"${codigo}"`);
  });

  it.each(DA_ROTA)("`%s` é um código real da rota de import", (codigo) => {
    expect(FONTE_DA_ROTA).toContain(`"${codigo}"`);
  });

  it.each([...DO_SERVICO, ...DA_ROTA])("`%s` tem frase, e ela NÃO é o padrão", (codigo) => {
    const frase = mensagemDeErro({ code: codigo, status: 400 }, PADRAO);
    expect(frase).not.toBe(PADRAO);
    // ⚠ e não é o código cru vazando para a tela
    expect(frase).not.toBe(codigo);
    expect(frase.length).toBeGreaterThan(20);
  });

  // ⚠⚠ A CONTRAPROVA: sem esta, o teste acima passaria com um dicionário que traduz qualquer coisa.
  it("⚠ código inventado CAI no padrão — é assim que a lacuna se manifesta", () => {
    expect(mensagemDeErro({ code: "ofx_sem_transacoes", status: 400 }, PADRAO)).toBe(PADRAO);
  });

  // ⚠⚠ A VARREDURA INVERSA — a que faltava, e a que teria pegado `file_required` sem frase.
  //
  // A de cima pergunta *"esta frase está pendurada num código real?"*. Esta pergunta *"todo código
  // que a rota devolve tem frase?"*. São perguntas diferentes, e o defeito de 26/08/2026 estava na
  // segunda: `file_required` era emitido pela rota e não existia no dicionário, então o cliente lia
  // o `padrao` — sem saber o que houve nem o que fazer.
  it("⚠⚠ TODO código que a rota do OFX devolve tem frase no dicionário", () => {
    const bloco = FONTE_DA_ROTA.slice(
      FONTE_DA_ROTA.indexOf("receberArquivoDoExtrato"),
      FONTE_DA_ROTA.indexOf("ofx_import_falhou") + 200,
    );
    expect(bloco.length).toBeGreaterThan(200);
    const codigos = [...new Set([...bloco.matchAll(/error:\s*"([a-z_]+)"/g)].map((m) => m[1]))];
    // ⚠ se a varredura não achar nada, ela não está provando coisa nenhuma
    expect(codigos.length).toBeGreaterThanOrEqual(3);
    for (const codigo of codigos) {
      expect(mensagemDeErro({ code: codigo, status: 400 }, PADRAO)).not.toBe(PADRAO);
    }
  });

  it("⚠⚠ a frase do arquivo grande diz o CONSERTO, não só o problema", () => {
    const frase = mensagemDeErro({ code: "arquivo_grande_demais", status: 413 }, PADRAO);
    expect(frase).toMatch(/períodos menores/i);
  });

  it("⚠ o 413 sem código conhecido NÃO viraria 'erro do nosso lado'", () => {
    // 413 não é 5xx: sem código, cairia no padrão — que é por isso que o `error` no corpo importa.
    expect(mensagemDeErro({ status: 413 }, PADRAO)).toBe(PADRAO);
  });
});
