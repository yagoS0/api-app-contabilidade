// ⚠⚠ A LISTAGEM DIZ A VERDADE SOBRE O MESTRE — decisão do dono, 01/09/2026.
//
// > *"o meu login e senha em ambos os portais é de mestre, eu posso executar o que eu quiser,
// > emitir nota em qualquer empresa etc, apenas o meu deve fazer isso."*
//
// O servidor JÁ aceitava o admin (o bypass dos três middlewares existe desde sempre e nunca tinha
// sido exercido) — quem mentia era a LISTAGEM: ela mandava `myRole: FINANCEIRO` e
// `emissaoNfseLiberada: false` para a visita, e a tela escondia botões que o servidor aceitaria.
// É o "botão impossível" ao contrário: poder sem porta visível.
//
// ⚠ Varredura de FONTE, como `guiasDoClienteAparecem.test.js`: a rota é grande e o que se protege
// são três decisões de UMA linha cada — nenhuma quebra render nenhum se sumir.

import fs from "node:fs";
import path from "node:path";

const FONTE = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");

describe("⚠⚠ o mestre na listagem do portal do cliente", () => {
  it("⚠⚠ o papel da visita é decidido pelo ROLE: admin vira OWNER, o resto continua FINANCEIRO", () => {
    expect(FONTE).toMatch(/ehMestre \? "OWNER" : "FINANCEIRO"/);
    // E `ehMestre` é o role admin, com a comparação exata — nunca truthy, nunca isAdminLike
    // (contador comum em visita NÃO é mestre; é o "apenas o meu").
    expect(FONTE).toMatch(/ehMestre = String\(req\.auth\?\.user\?\.role \|\| ""\)\.toLowerCase\(\) === "admin"/);
  });

  it("⚠⚠ o botão de emitir aparece para o mestre em toda empresa — o espelho do bypass do servidor", () => {
    expect(FONTE).toMatch(/\(ehVisitaDoEscritorio && ehMestre\) \|\| link\.company\.emissaoClienteLiberada === true/);
  });

  it("⚠ e a flag da empresa continua mandando para todo mundo que não é o mestre", () => {
    // A cláusula do mestre é um OU sobre a leitura existente, nunca uma substituição: apagar a
    // leitura da flag abriria o botão para cliente de empresa não liberada.
    expect(FONTE).toMatch(/emissaoClienteLiberada === true/);
  });
});
