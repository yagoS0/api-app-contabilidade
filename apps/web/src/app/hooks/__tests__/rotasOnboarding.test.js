// As QUATRO PEÇAS do roteamento do onboarding — as duas que dá para testar sem montar o app.
//
// ⚠ Por que este teste existe: `pathToPageName` termina em `return "companies"`. Faltando um ramo,
// a URL abre o dashboard EM SILÊNCIO — sem erro, sem log, sem 404. Não há como perceber olhando; a
// página simplesmente "não existe". As outras duas peças (o ramo próprio em `setPage`, porque o
// mapa não resolve rota com id, e o bloco `if` no `App.jsx`) falham do mesmo jeito.

import { pathToPageName } from "../useManageAuthSession";

describe("pathToPageName — o funil tem ramo próprio, não cai no fallback", () => {
  test("/onboardings resolve para a lista", () => {
    expect(pathToPageName("/onboardings")).toBe("onboardings");
  });

  test("/onboardings/:id resolve para o DETALHE, não para companies", () => {
    expect(pathToPageName("/onboardings/abc-123")).toBe("onboardingDetail");
  });

  test("/onboardings/:id/editar resolve para o WIZARD", () => {
    expect(pathToPageName("/onboardings/abc-123/editar")).toBe("onboardingWizard");
  });

  // "/onboardings/" com id vazio não pode virar detalhe de ficha nenhuma — é a mesma armadilha que
  // `/companies/` já teve (tela fantasma de empresa sem id).
  test("/onboardings/ (id vazio) volta para a lista", () => {
    expect(pathToPageName("/onboardings/")).toBe("onboardings");
  });

  test("as rotas que já existiam continuam onde estavam", () => {
    expect(pathToPageName("/companies")).toBe("companies");
    expect(pathToPageName("/companies/xyz")).toBe("companyDetail");
    expect(pathToPageName("/obrigacoes")).toBe("obrigacoes");
    expect(pathToPageName("/")).toBe("companies");
  });

  test("o fallback silencioso continua existindo — e é por isso que os ramos acima importam", () => {
    expect(pathToPageName("/rota-que-nao-existe")).toBe("companies");
  });
});
