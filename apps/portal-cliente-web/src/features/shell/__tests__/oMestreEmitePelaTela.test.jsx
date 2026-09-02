// ⚠⚠ O MESTRE EMITE PELO PORTAL DO CLIENTE — e era a TELA que recusava (02/09/2026).
//
// Relato do dono: *"esse meu usuario, no portal do cliente deve ter todos os poderes, inclusive de
// emitir notas"* e, sobre a entrega anterior, *"nao esta feito pois ao logar nao consigo emitir"*.
//
// ⚠⚠ O SERVIDOR JÁ CONCEDIA. Medido em produção no mesmo dia, com `yago@altan.company`
// (`role: admin`, `FIRM`, `podeAbrirPortalDoCliente: true`):
//
//   GET /client/companies                 -> 200 · 34 empresas · myRole OWNER
//                                            · emissaoNfseLiberada true em 34 de 34
//   POST .../notas/<inexistente>/cancelar -> 404 nota_nao_encontrada
//
// ⚠ O 404 é a prova do portão SEM praticar ato fiscal: `ensureEmissaoNfseAutorizada` roda ANTES da
// busca da nota (`routes/client/index.js`, linhas 2010 × 2016), então chegar a "não encontrei a
// nota" quer dizer que a autorização passou.
//
// O que bloqueava era `AppShell`: ele passava `visitaDoEscritorio={ehVisitaDoEscritorio(user)}`
// para a `NotasPage`, e o mestre também satisfaz essa leitura (FIRM + marca da porta). Os dois
// botões — "Emitir nota" e "Emissão em Lote" — nasciam `disabled`.
//
// ⚠ Este é o "botão impossível" AO CONTRÁRIO, e o backend já tinha o mesmo cuidado escrito:
// *"Mandar OWNER daqui faria a TELA oferecer emissão que o servidor recusaria"*. A metade que
// faltava era a simétrica — a tela escondendo o que o servidor aceita.

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import fs from "node:fs";
import path from "node:path";
import { NotasPage } from "../../notas/NotasPage";
import { ehVisitaDoEscritorio, ehMestreDoEscritorio } from "../../../api/accountGate";

// ⚠ `__dirname`, não `import.meta` — o jest desta casa transpila para CJS.
const CASCA = fs.readFileSync(path.join(__dirname, "../AppShell.jsx"), "utf8");

const MESTRE = { accountType: "FIRM", podeAbrirPortalDoCliente: true, role: "admin" };
const VISITA = { accountType: "FIRM", podeAbrirPortalDoCliente: true, role: "contador" };
const CLIENTE = { accountType: "CLIENT", podeAbrirPortalDoCliente: false, role: "user" };

const EMPRESA = {
  companyId: "pc-1",
  razao: "EMPRESA TESTE LTDA",
  cnpj: "11222333000181",
  myRole: "OWNER",
  emissaoNfseLiberada: true,
};

function montar(visitaDoEscritorio) {
  return render(
    <NotasPage
      empresa={EMPRESA}
      competencia="2026-09"
      aoTrocarCompetencia={jest.fn()}
      aoReaproveitar={jest.fn()}
      aoEmitir={jest.fn()}
      aoPrepararLote={jest.fn()}
      visitaDoEscritorio={visitaDoEscritorio}
    />
  );
}

describe("a leitura: mestre × visita × cliente", () => {
  it("⚠⚠ o MESTRE é `admin` — e ele também é uma visita do escritório", () => {
    // As duas coisas são verdade ao mesmo tempo, e é por isso que a casca precisa das DUAS
    // leituras: a marca da porta continua descrevendo a sessão (a topbar diz "· visita do
    // escritório"), e o `role` é o que decide o PODER.
    expect(ehVisitaDoEscritorio(MESTRE)).toBe(true);
    expect(ehMestreDoEscritorio(MESTRE)).toBe(true);
  });

  it("⚠ a visita SEM `admin` não vira mestre — é o «apenas o meu» do dono", () => {
    expect(ehVisitaDoEscritorio(VISITA)).toBe(true);
    expect(ehMestreDoEscritorio(VISITA)).toBe(false);
  });

  it("o cliente comum não é nem uma coisa nem outra", () => {
    expect(ehVisitaDoEscritorio(CLIENTE)).toBe(false);
    expect(ehMestreDoEscritorio(CLIENTE)).toBe(false);
  });

  it("⚠ ausência não é permissão, nos dois sentidos", () => {
    expect(ehMestreDoEscritorio(null)).toBe(false);
    expect(ehMestreDoEscritorio({})).toBe(false);
    expect(ehMestreDoEscritorio({ role: "ADMIN" })).toBe(true); // o banco pode gravar em caixa alta
  });
});

describe("⚠⚠ a CASCA passa a leitura combinada — é ela que desabilitava o mestre", () => {
  it("a prop da NotasPage exclui o mestre", () => {
    // ⚠ Varredura de fonte: o defeito era UMA expressão nesta linha, e um teste de render da casca
    //   inteira exigiria sessão, api e roteamento — nenhum deles tem a ver com a decisão.
    expect(CASCA).toMatch(
      /visitaDoEscritorio=\{ehVisitaDoEscritorio\(user\) && !ehMestreDoEscritorio\(user\)\}/
    );
  });

  it("⚠ e a marca da topbar NÃO foi mexida — o mestre continua sabendo que está no portal do cliente", () => {
    // Ele lê os números de UMA empresa; sem a marca, conclui coisas erradas sobre a carteira.
    expect(CASCA).toMatch(/ehVisitaDoEscritorio\(user\) \? " · visita do escritório"/);
  });
});

describe("os botões da tela de Notas", () => {
  it("⚠⚠ MESTRE: «Emitir nota» e «Emissão em Lote» HABILITADOS", () => {
    montar(false); // o que a casca passa para o mestre
    expect(screen.getByRole("button", { name: /Emitir nota/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Emissão em Lote/i })).toBeEnabled();
  });

  it("⚠ VISITA comum: os dois continuam desabilitados, com o motivo no `title`", () => {
    montar(true);
    const emitir = screen.getByRole("button", { name: /Emitir nota/i });
    const lote = screen.getByRole("button", { name: /Emissão em Lote/i });
    expect(emitir).toBeDisabled();
    expect(lote).toBeDisabled();
    // ⚠ Botão desabilitado e MUDO é pior que botão ausente: ninguém sabe o que fazer.
    expect(emitir.getAttribute("title")).toMatch(/visita do escritório/i);
    expect(lote.getAttribute("title")).toMatch(/visita do escritório/i);
  });
});
