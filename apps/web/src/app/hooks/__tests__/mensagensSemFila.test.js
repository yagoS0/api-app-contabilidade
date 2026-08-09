// NENHUMA MENSAGEM DA TELA PODE PROMETER UMA FILA QUE NÃO EXISTE.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// O laço automático de envio saiu na Q55 (`server.js`: "nada roda sozinho") e nada drena
// `emailNextRetryAt`. Mesmo assim, `useManageCompaniesWorkspace` respondia ao contador com:
//
//   • "Guia colocada na fila de reenvio."
//   • "Guia recalculada e enviada para a fila de e-mail."
//   • "Guia recalculada, mas o envio automático está ocupado no momento."
//
// As três descrevem um mecanismo inexistente. O backend tem a guarda equivalente
// (`api/.../__tests__/envioSemFila.test.js`, que varre `routes/firm/index.js`); esta é a metade do
// front, e ela é necessária porque **o texto que o contador lê é montado AQUI**, não lá.
//
// ⚠ Havia um segundo defeito, mais silencioso, no mesmo lugar: `loadGuides` abre com
// `feedback.clearFeedback()`, e as três mensagens eram setadas ANTES dele. Ou seja: nem a promessa
// falsa chegava à tela — o clique não devolvia retorno nenhum. Por isso o teste também trava a
// ORDEM (mensagem depois do recarregamento).

import fs from "node:fs";
import path from "node:path";

const HOOK = [
  path.join(process.cwd(), "src", "app", "hooks", "useManageCompaniesWorkspace.js"),
  path.join(process.cwd(), "apps", "web", "src", "app", "hooks", "useManageCompaniesWorkspace.js"),
].find((p) => fs.existsSync(p));

/** Literais de string do arquivo, sem comentários (é lá que as frases antigas foram explicadas). */
function literaisDeString(codigo) {
  const semComentarios = codigo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return semComentarios.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g) || [];
}

describe("mensagens de envio de guia no workspace", () => {
  test("o hook foi encontrado — senão esta varredura seria um teste vazio", () => {
    expect(HOOK).toBeTruthy();
  });

  const fonte = fs.readFileSync(HOOK, "utf8");
  const literais = literaisDeString(fonte);

  test("nenhum literal fala em 'fila' de e-mail/envio de guia", () => {
    const suspeitos = literais.filter((s) => /fila/i.test(s) && /(e-?mail|envio|guia|reenvio)/i.test(s));
    expect(suspeitos).toEqual([]);
  });

  test("nenhum literal promete envio automático", () => {
    const suspeitos = literais.filter((s) => /envio autom[áa]tic|ser[áa] tentad|em processamento/i.test(s));
    expect(suspeitos).toEqual([]);
  });

  test("⚠ a mensagem vem DEPOIS do recarregamento, senão `clearFeedback` a apaga", () => {
    // `loadGuides` começa com `feedback.clearFeedback()`. Qualquer `setMessage`/`setError`
    // imediatamente ANTES de um `await loadGuides(...)` é engolido — o clique fica mudo.
    const engolidas = [];
    const linhas = fonte.split("\n");
    linhas.forEach((linha, i) => {
      if (!/await loadGuides\(/.test(linha)) return;
      // Olha as 3 linhas anteriores: um set de feedback grudado no reload é o padrão do defeito.
      const antes = linhas.slice(Math.max(0, i - 3), i).join("\n");
      if (/feedback\.(setMessage|setError)\s*\(/.test(antes)) engolidas.push(i + 1);
    });
    expect(engolidas).toEqual([]);
  });
});
