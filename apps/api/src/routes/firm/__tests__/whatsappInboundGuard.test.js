import fs from "node:fs";
import path from "node:path";

// A central atende quem já escreveu. Hoje nenhuma rota firm chama os métodos
// de template diretamente; guias usam o serviço próprio com suas guardas.
// Reabrir conversa futuramente exige rever esta regra e provar a origem do destino.
test("rotas firm não introduzem envio direto de template para prospecção", () => {
  const raiz = path.resolve(__dirname, "..");
  function arquivos(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
      if (item.name === "__tests__") return [];
      const arquivo = path.join(dir, item.name);
      return item.isDirectory() ? arquivos(arquivo) : /\.js$/.test(item.name) ? [arquivo] : [];
    });
  }
  const enviosDiretos = arquivos(raiz).filter((arquivo) =>
    /\.\s*enviarTemplate(?:ComDocumento)?\s*\(/.test(fs.readFileSync(arquivo, "utf8"))
  ).map((arquivo) => path.relative(raiz, arquivo));
  expect(enviosDiretos).toEqual([]);
});
