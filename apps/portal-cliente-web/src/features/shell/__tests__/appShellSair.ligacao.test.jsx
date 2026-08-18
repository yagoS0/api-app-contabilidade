// A LIGAÇÃO DO "SAIR" — o histórico de descrições é APAGADO de verdade, por um clique real.
//
// ⚠ `esquecerTodasAsDescricoes` só tem UM chamador em todo o app (`AppShell.sair`), e uma função de
// apagamento que ninguém chama é indistinguível de nada: o teste da lib ao lado
// (`emitir/lib/__tests__/descricoesRecentes.test.js`) prova que ela apaga; este prova que ela É
// CHAMADA. Componente sem chamador é o defeito favorito deste projeto.
//
// ⚠ O QUE ESTÁ EM JOGO NÃO É CACHE: a lista guarda NOME e CNPJ de tomadores, e este portal é usado
// em computador compartilhado. É o mesmo motivo de `salvarEmpresa(null)` e `limparSessao` estarem
// na mesma linha.
//
// ⚠ A limpeza mora no `finally` de `AppShell.sair` — "Sair" que não sai porque o servidor não
// respondeu é pior que erro visível. Esse ramo NÃO é exercido aqui, e o motivo é que ele não é
// alcançável de fora: `realApi.logout` engole a própria falha ("best-effort: mesmo falhando, a
// casca limpa o token local", `api/real/realApi.js:128`), então `api.logout()` nunca rejeita. Uma
// rejeição forçada testaria um estado que a camada de API não produz — e `sair()` não tem `catch`,
// de modo que a rejeição inventada escaparia como "unhandled". O `finally` é redundância
// deliberada, e fica registrado como tal em vez de virar um teste sobre um mundo que não existe.
//
// ⚠ NENHUMA CHAMADA DE REDE: `api.getCompanies` e `api.logout` são espiões.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { AppShell } from "../AppShell";

let fetchOriginal;

beforeEach(() => {
  window.localStorage.clear();
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
  jest.spyOn(api, "getCompanies").mockResolvedValue([]);
  jest.spyOn(api, "logout").mockResolvedValue(undefined);
});

afterEach(() => {
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});

function semearDuasEmpresas() {
  window.localStorage.setItem(
    "pcw.descricoes.pc-001",
    JSON.stringify([{ descricao: "Consultoria", doc: "11222333000181", nome: "PADARIA DO JOAO ME", em: "2026-08-18T12:00:00.000Z" }])
  );
  window.localStorage.setItem(
    "pcw.descricoes.pc-002",
    JSON.stringify([{ descricao: "Assessoria", doc: "44555666000177", nome: "OUTRA SA", em: "2026-08-18T12:00:00.000Z" }])
  );
}

async function renderizarEClicarEmSair() {
  render(<AppShell user={{ defaultClientId: "pc-001" }} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Sair" }));
  await act(async () => {});
}

test("clicar em Sair apaga o histórico de descrições de TODAS as empresas", async () => {
  semearDuasEmpresas();
  await renderizarEClicarEmSair();

  await waitFor(() => expect(window.localStorage.getItem("pcw.descricoes.pc-001")).toBeNull());
  expect(window.localStorage.getItem("pcw.descricoes.pc-002")).toBeNull();
  const sobrou = Object.keys(window.localStorage)
    .map((k) => `${k}=${window.localStorage.getItem(k)}`)
    .join("|");
  expect(sobrou).not.toMatch(/PADARIA DO JOAO/);
  expect(sobrou).not.toMatch(/11222333000181/);
});
