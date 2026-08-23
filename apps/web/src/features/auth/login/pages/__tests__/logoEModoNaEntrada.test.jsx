// A TELA DE ENTRADA DO ESCRITÓRIO — duas correções de 23/08/2026, e as duas são sobre o que a tela
// AFIRMA a quem não é de tecnologia.
//
// 1. ⚠ Ela se chamava **"Portal Firm"** — o nome de scaffold, em inglês, na primeira tela que o
//    contador abre todo dia. Virou a logo da Altan.
//
// 2. ⚠⚠ Ela imprimia **"Modo da API: real"** para o usuário final. Diagnóstico nosso vazando na
//    porta de entrada: quem lê "real" não aprende nada, e quem lê "mock" precisa saber. O dono
//    mandou indicar SÓ quando é demonstração.
//
// ⚠⚠ O CASO QUE ESTE ARQUIVO EXISTE PARA TRAVAR É O DO MEIO. São TRÊS modos (`api/client.js`), não
// dois, e `real_with_mock_fallback` **tenta o real primeiro** — ele fala com o backend de verdade e
// só cai para o mock quando não há resposta. Chamá-lo de "demonstração" diria ao contador que os
// números na tela são fictícios enquanto ele olha dados de produção. Um `apiMode !== "real"` passa
// nos dois testes óbvios e erra exatamente aqui.
//
// ⚠ Experimento executado: trocando a condição por `apiMode !== "real"`, esta suíte fica **1
// vermelho** (o caso do fallback); restaurada, 7 verdes.

import { render, screen } from "@testing-library/react";
import { LoginPage } from "../renderLoginPage";

const NOME_DA_MARCA = "Altan Contabilidade";

function abrir(apiMode) {
  return render(
    <LoginPage
      apiMode={apiMode}
      identifier=""
      password=""
      onIdentifierChange={() => {}}
      onPasswordChange={() => {}}
      onSubmit={() => {}}
      authLoading={false}
      error={null}
    />
  );
}

describe('⚠ "Portal Firm" saiu, a logo ficou', () => {
  it("a marca é um gráfico COM NOME acessível", () => {
    abrir("mock");
    expect(screen.getByRole("img", { name: NOME_DA_MARCA })).toBeInTheDocument();
  });

  it("o nome de scaffold não aparece em lugar nenhum da página", () => {
    abrir("real");
    expect(document.body.textContent).not.toMatch(/Portal Firm/i);
  });

  it("⚠ o `<h2>` FICA — é a hierarquia da página, não decoração", () => {
    abrir("real");
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });
});

describe("⚠⚠ o modo da API só aparece quando é DEMONSTRAÇÃO", () => {
  it('com "mock", a tela diz que é demonstração', () => {
    abrir("mock");
    expect(screen.getByText("Modo demonstração")).toBeInTheDocument();
  });

  it('com "real", a tela não diz NADA sobre modo', () => {
    abrir("real");
    expect(screen.queryByText(/modo/i)).toBeNull();
  });

  it('⚠⚠ com "real_with_mock_fallback" TAMBÉM não — ele fala com o backend de verdade', () => {
    // Este é o caso que um `!== "real"` erraria: a tela chamaria de fictício um número que veio
    // de produção.
    abrir("real_with_mock_fallback");
    expect(document.body.textContent).not.toMatch(/demonstração/i);
  });

  it("⚠ e o rótulo técnico antigo não voltou por nenhuma porta", () => {
    for (const modo of ["mock", "real", "real_with_mock_fallback"]) {
      const { unmount } = abrir(modo);
      expect(document.body.textContent).not.toMatch(/Modo da API/i);
      unmount();
    }
  });
});
