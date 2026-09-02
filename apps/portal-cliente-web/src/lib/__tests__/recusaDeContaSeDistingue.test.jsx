// ⚠⚠ AS DUAS RECUSAS DE CONTA DIZEM O MESMO — e agora se distinguem onde isso serve (31/08/2026).
//
// Achado em teste de usabilidade: `not_a_client` e `forbidden_account_type` mostram a MESMA frase,
// "o que dificulta o diagnóstico".
//
// ⚠⚠ A FRASE CONTINUA A MESMA, DE PROPÓSITO. As duas descrevem a mesma situação por lados
// diferentes — uma é a nossa trava de produto (`accountGate.js`, decidida no navegador) e a outra
// é a recusa do SERVIDOR (`requireAccountType`) —, e para quem lê o CONSERTO É IDÊNTICO: usar o
// portal do escritório. Duas redações fariam a pessoa procurar uma diferença que não existe.
//
// O que faltava era a distinção existir para QUEM DIAGNOSTICA. Ela foi para o DOM, como
// `data-status`, `data-estado-nota` e `data-situacao-fiscal` já fazem nesta casa.

import { render, screen } from "@testing-library/react";
import { AlertaErro } from "../../components/ui";
import { mensagemDeErro } from "../mensagens";

const DA_TELA = { code: "not_a_client" };
const DO_SERVIDOR = { code: "forbidden_account_type" };

test("⚠ a FRASE é a mesma nas duas — e é a resposta certa, porque a saída é a mesma", () => {
  expect(mensagemDeErro(DA_TELA)).toBe(mensagemDeErro(DO_SERVIDOR));
  expect(mensagemDeErro(DA_TELA)).toMatch(/portal do escrit[óo]rio/i);
});

test("⚠⚠ mas o CÓDIGO viaja no DOM — é ele que diz de que lado a porta fechou", () => {
  const { unmount } = render(<AlertaErro erro={DA_TELA} />);
  expect(screen.getByRole("alert").getAttribute("data-erro-codigo")).toBe("not_a_client");
  unmount();

  render(<AlertaErro erro={DO_SERVIDOR} />);
  expect(screen.getByRole("alert").getAttribute("data-erro-codigo")).toBe("forbidden_account_type");
});

test("⚠ erro sem código não fabrica atributo vazio", () => {
  // `data-erro-codigo=""` seria pior que a ausência: parece um código que não existe.
  render(<AlertaErro erro={new Error("qualquer coisa")} padrao="Não foi possível entrar." />);
  expect(screen.getByRole("alert").hasAttribute("data-erro-codigo")).toBe(false);
});

test("⚠ e o código NÃO aparece na tela — distinção de suporte não é texto para quem só quer entrar", () => {
  render(<AlertaErro erro={DA_TELA} />);
  expect(screen.getByRole("alert").textContent).not.toMatch(/not_a_client/);
});
