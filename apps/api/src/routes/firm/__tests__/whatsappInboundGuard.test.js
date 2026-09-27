import fs from "node:fs";
import path from "node:path";

// Retomada contextual foi autorizada no plano PWA. Sua única rota resolve o destino
// da conversa autorizada, exige prévia aprovada no canal e intenção idempotente.
// A prova de envio ao telefone do servidor e janela mantida fechada fica no teste HTTP.
test("somente a retomada contextual pode usar template nas rotas firm", () => {
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
  expect(enviosDiretos).toEqual(["whatsappConversas.js"]);
});
