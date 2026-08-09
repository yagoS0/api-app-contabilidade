// NENHUMA MENSAGEM PODE PROMETER UMA FILA QUE NÃO EXISTE.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// `POST /firm/guides/:guideId/liberar-cliente` chama `runGuideEmailWorkerSelected` de forma
// SÍNCRONA. Esse worker toma um lock global (`guides_email_lock`, TTL 5 min). Com o lock preso —
// envio de verdade em andamento, ou processo morto com o TTL ainda correndo — ele devolve
// `{ skipped: true, reason: "lock_active" }`, e a rota respondia ao contador:
//
//     "Guia liberada; envio de e-mail ocupado no momento — ficará em fila."
//
// **Não existe fila.** O laço automático foi REMOVIDO na Q55 (`server.js`: "nada roda sozinho") e
// nada drena `emailNextRetryAt`. A guia simplesmente não saía, e o contador ia embora tranquilo
// achando que o cliente ia receber. Sucesso reportado sobre trabalho não feito — a pior forma do
// erro, e a mesma do defeito que o commit a61649d0 corrigiu no envio em lote.
//
// O teste trava as DUAS pontas:
//   1. o TEXTO (as funções de `guideEmailCopy.js`, fonte única das frases);
//   2. o CÓDIGO das rotas — nenhuma string de resposta pode voltar a falar em fila ou em envio
//      automático. A frase é fácil de reescrever à mão no lugar de uso; foi assim que ela ganhou
//      quatro cópias.

import fs from "node:fs";
import path from "node:path";
import {
  GUIA_AGUARDA_ENVIO_MANUAL,
  SEM_REENVIO_AUTOMATICO,
  mensagemEnvioFalhou,
  mensagemEnvioNaoFeitoPorLock,
} from "../guideEmailCopy.js";

// ⚠ Nada de `import.meta.url` aqui: o Jest da API roda em CommonJS e `import.meta` é erro de
// SINTAXE — o arquivo inteiro morre antes do primeiro teste (mesma armadilha documentada em
// `apps/web/CLAUDE.md`). O caminho sai do `rootDir` do Jest, que é `apps/api`.
const ROTAS_FIRM = [
  path.join(process.cwd(), "src", "routes", "firm", "index.js"),
  path.join(process.cwd(), "apps", "api", "src", "routes", "firm", "index.js"),
].find((p) => fs.existsSync(p));

describe("lock preso NÃO produz mensagem de fila", () => {
  const msg = mensagemEnvioNaoFeitoPorLock("Guia liberada ao cliente, mas ");

  test("diz, com todas as letras, que o e-mail NÃO foi enviado", () => {
    expect(msg).toMatch(/NÃO foi enviado/);
  });

  test("⚠ não promete fila, nem processamento, nem tentativa futura", () => {
    expect(msg).not.toMatch(/fila/i);
    expect(msg).not.toMatch(/processamento/i);
    expect(msg).not.toMatch(/ser[áa] tentad/i);
  });

  test("oferece o que dá para oferecer: tentar de novo, e o prazo do lock", () => {
    // O TTL do lock é de 5 minutos (`guideEmailWorker.js`). Dizer "tente mais tarde" sem o prazo
    // devolveria o contador à mesma dúvida.
    expect(msg).toMatch(/5 minutos/);
    expect(msg).toContain(SEM_REENVIO_AUTOMATICO);
  });

  test("a frase-base afirma a consequência de NÃO clicar de novo", () => {
    // "Não há reenvio automático" sozinho é técnico demais; o que o contador precisa saber é o que
    // acontece se ele fechar a tela agora.
    expect(SEM_REENVIO_AUTOMATICO).toMatch(/não sai/i);
  });
});

describe("falha concreta mostra o motivo", () => {
  test("o motivo entra na mensagem", () => {
    expect(mensagemEnvioFalhou("smtp_timeout")).toMatch(/smtp_timeout/);
  });

  test("sem motivo, ainda assim não inventa fila", () => {
    const m = mensagemEnvioFalhou(null);
    expect(m).toMatch(/NÃO foi enviado/);
    expect(m).not.toMatch(/fila/i);
  });
});

describe("guia processada aguarda envio MANUAL", () => {
  test("não diz 'colocada na fila' nem 'envio automático'", () => {
    // O texto antigo do upload trazia as duas frases falsas na mesma linha.
    expect(GUIA_AGUARDA_ENVIO_MANUAL).not.toMatch(/fila/i);
    expect(GUIA_AGUARDA_ENVIO_MANUAL).not.toMatch(/autom[áa]tic/i);
  });

  test("aponta para onde o envio realmente acontece", () => {
    expect(GUIA_AGUARDA_ENVIO_MANUAL).toMatch(/lote|Liberar ao cliente/i);
  });
});

// A GUARDA QUE PEGA A REESCRITA À MÃO.
//
// As frases acima só protegem quem as usa. Quem escreve a string direto na rota — que é como as
// quatro cópias nasceram — passa por baixo. Então varremos os literais de string do arquivo de
// rotas de escritório atrás da promessa.
describe("as rotas de escritório não escrevem a promessa à mão", () => {
  test("o arquivo de rotas foi encontrado — senão esta guarda seria um teste vazio", () => {
    // Guarda contra o pior desfecho possível para uma varredura: o caminho muda, o arquivo não é
    // lido, e a suíte passa verde sem verificar nada. Ausência não é resposta, nem aqui.
    expect(ROTAS_FIRM).toBeTruthy();
  });

  const fonte = fs.readFileSync(ROTAS_FIRM, "utf8");

  /** Literais de string do arquivo (aspas simples/duplas/template), sem comentários. */
  function literaisDeString(codigo) {
    const semComentarios = codigo
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    return semComentarios.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g) || [];
  }

  const literais = literaisDeString(fonte);

  test("nenhum literal fala em 'fila' de e-mail", () => {
    // ⚠ "fila" existe legitimamente no arquivo em OUTRO domínio (fila de transmissão do PGDAS-D,
    // que É uma fila de verdade, com worker próprio). Por isso o casamento exige o contexto de
    // e-mail/envio de guia na mesma frase.
    const suspeitos = literais.filter(
      (s) => /fila/i.test(s) && /(e-?mail|envio|guia)/i.test(s),
    );
    expect(suspeitos).toEqual([]);
  });

  test("nenhum literal promete envio automático de guia", () => {
    const suspeitos = literais.filter(
      (s) => /(envio autom[áa]tico|ser[áa] tentado depois|tentado mais tarde)/i.test(s),
    );
    expect(suspeitos).toEqual([]);
  });

  test("o ramo do lock usa a cópia do domínio, não texto solto", () => {
    expect(fonte).toMatch(/mensagemEnvioNaoFeitoPorLock/);
  });
});
