// AS ABAS DA EMPRESA SÃO LINKS DE VERDADE — pedido do dono, 19/08/2026:
//
// > *"ao apertar control + uma das abas, abrir em uma nova guia do navegador aquela aba que
// > clicamos."*
//
// ⚠ O QUE ESTE ARQUIVO PROVA, e por que ele não testa "o Ctrl+clique abre uma guia". Abrir a guia
// é trabalho do NAVEGADOR, e é justamente por isso que a aba virou `<a href>` em vez de ganhar um
// `if (event.ctrlKey) window.open(...)`. O que se pode (e se precisa) provar aqui é a condição que
// entrega isso de graça: existe um `href` de verdade, ele é a URL CERTA daquela aba, e o clique
// com modificador NÃO é interceptado — sem `preventDefault`, quem decide é o navegador.
//
// Prova também a ligação: as abas do header renderizam COM href (uma aba nova que esqueça o par em
// `TAB_TO_SEGMENT` cai aqui, em vez de cair em Anotações em silêncio na tela do contador).

import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CompanySectionHeader } from "../renderCompanyDetailHeader";
import { Tabs } from "../../../../../components/ui/Tabs";
import { SEGMENT_TO_TAB, companyTabPath } from "../../lib/rotasDaEmpresa";

const EMPRESA = {
  companyId: "empresa-1",
  razao: "ACME SERVICOS LTDA",
  cnpj: "12.345.678/0001-90",
  legacyCompany: { regimeTributario: "SIMPLES" },
};

function montarHeader(activeTab, props = {}) {
  const onTabChange = jest.fn();
  render(
    <CompanySectionHeader
      company={EMPRESA}
      activeTab={activeTab}
      onBack={jest.fn()}
      onTabChange={onTabChange}
      canEditCompany
      {...props}
    />
  );
  return { onTabChange };
}

// Um clique de verdade, com os modificadores que o navegador usa para abrir em outra guia.
function clicar(elemento, init = {}) {
  const evento = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  fireEvent(elemento, evento);
  return evento;
}

describe("a aba de navegação é um <a href> com a URL da aba", () => {
  test("cada sub-aba do grupo Fiscal leva a URL da sua rota", () => {
    montarHeader("notasFiscais");
    expect(screen.getByRole("link", { name: "Notas Fiscais" }))
      .toHaveAttribute("href", "/companies/empresa-1/notas-fiscais");
    expect(screen.getByRole("link", { name: "Guias" }))
      .toHaveAttribute("href", "/companies/empresa-1/guides");
    expect(screen.getByRole("link", { name: "Situação Fiscal" }))
      .toHaveAttribute("href", "/companies/empresa-1/sitfis");
  });

  test("o href sai de `companyTabPath` — a MESMA fonte que a navegação por clique usa", () => {
    montarHeader("notasFiscais");
    expect(screen.getByRole("link", { name: "Auditoria" }))
      .toHaveAttribute("href", companyTabPath("empresa-1", "auditoria"));
  });

  test("o grupo leva à URL da sua PRIMEIRA sub-aba — o mesmo destino do clique", () => {
    montarHeader("anotacoes");
    const grupos = screen.getByRole("navigation", { name: "Grupos da empresa" });
    expect(within(grupos).getByRole("link", { name: "Contabilidade" }))
      .toHaveAttribute("href", companyTabPath("empresa-1", "lancamentos"));
    expect(within(grupos).getByRole("link", { name: "Fiscal" }))
      .toHaveAttribute("href", companyTabPath("empresa-1", "notasFiscais"));
    expect(within(grupos).getByRole("link", { name: "Empresa" }))
      .toHaveAttribute("href", companyTabPath("empresa-1", "cadastro"));
  });

  // ⚠ ESTE É O TESTE QUE PEGA A ABA NOVA MAL LIGADA. Aba declarada em `GROUPS` sem o par em
  // `TAB_TO_SEGMENT` renderiza sem href, vira `<button>` e — na tela do contador — a URL cai em
  // Anotações sem erro nenhum. Aqui ela cai como aba sem link.
  test.each(["anotacoes", "lancamentos", "notasFiscais", "cadastro"])(
    "no grupo aberto por %s, TODA aba desenhada tem URL própria e conhecida",
    (aba) => {
      montarHeader(aba);
      const abas = document.querySelectorAll(".app-tab");
      expect(abas.length).toBeGreaterThan(0);
      for (const el of abas) {
        expect(el.tagName).toBe("A");
        const href = el.getAttribute("href") || "";
        const segmento = href.replace("/companies/empresa-1/", "");
        expect(SEGMENT_TO_TAB[segmento]).toBeDefined();
      }
    }
  );
});

describe("o clique NORMAL continua sendo SPA; o com modificador é do navegador", () => {
  test("clique simples: não navega o browser (preventDefault) e troca de aba pelo app", () => {
    const { onTabChange } = montarHeader("notasFiscais");
    const evento = clicar(screen.getByRole("link", { name: "Guias" }));
    expect(evento.defaultPrevented).toBe(true);
    expect(onTabChange).toHaveBeenCalledWith("guides");
  });

  test.each([
    ["Ctrl (Windows/Linux)", { ctrlKey: true }],
    ["Cmd (Mac)", { metaKey: true }],
    ["Shift (nova janela)", { shiftKey: true }],
    ["Alt", { altKey: true }],
  ])("%s: NÃO é interceptado — sem preventDefault e sem troca de aba no app", (_nome, init) => {
    const { onTabChange } = montarHeader("notasFiscais");
    const evento = clicar(screen.getByRole("link", { name: "Guias" }), init);
    // Sem `preventDefault` o navegador segue o href — é ele quem abre a guia nova.
    expect(evento.defaultPrevented).toBe(false);
    // E a tela atual NÃO muda de aba: quem clicou com Ctrl quer a outra guia, não sair desta.
    expect(onTabChange).not.toHaveBeenCalled();
  });

  test("clique do MEIO (botão 1) também passa direto para o navegador", () => {
    const { onTabChange } = montarHeader("notasFiscais");
    const evento = clicar(screen.getByRole("link", { name: "Guias" }), { button: 1 });
    expect(evento.defaultPrevented).toBe(false);
    expect(onTabChange).not.toHaveBeenCalled();
  });

  test("a aba ATIVA continua sendo link (para o Ctrl+clique), mas o clique normal não recarrega", () => {
    const { onTabChange } = montarHeader("notasFiscais");
    const ativa = screen.getByRole("link", { name: "Notas Fiscais" });
    expect(ativa).toHaveAttribute("aria-current", "page");
    const evento = clicar(ativa);
    // ⚠ `preventDefault` também na ativa: sem ele, clicar na aba já aberta seguiria o href e
    // recarregaria a página inteira.
    expect(evento.defaultPrevented).toBe(true);
    expect(onTabChange).not.toHaveBeenCalled();
    // Com Ctrl, ela abre em outra guia como qualquer link.
    const comCtrl = clicar(ativa, { ctrlKey: true });
    expect(comCtrl.defaultPrevented).toBe(false);
  });
});

describe("nem toda aba pode virar link", () => {
  // ⚠ AS ABAS DE VISÃO CONTINUAM `<button>`. São as do dashboard (Simples/Presumido/Outros), as
  // visões do calendário e o recorte de período dos relatórios: elas trocam o que a tela mostra
  // SEM navegar, e não existe URL para elas. Com `href`, o Ctrl+clique abriria uma guia quebrada.
  test("`mode=view` IGNORA o href, mesmo quando alguém o passa", () => {
    render(
      <Tabs
        mode="view"
        ariaLabel="Regimes"
        active="simples"
        onChange={jest.fn()}
        items={[
          { key: "simples", label: "Simples Nacional", href: "/companies?regime=simples" },
          { key: "presumido", label: "Lucro Presumido", href: "/companies?regime=presumido" },
        ]}
      />
    );
    expect(screen.queryByRole("link")).toBeNull();
    const botao = screen.getByRole("button", { name: "Lucro Presumido" });
    expect(botao.tagName).toBe("BUTTON");
    expect(botao).not.toHaveAttribute("href");
    // O par certo de ARIA continua o de seletor de visão, não o de navegação.
    expect(screen.getByRole("button", { name: "Simples Nacional" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  test("aba DESABILITADA continua `<button>` — `<a>` não tem disabled", () => {
    render(
      <Tabs
        ariaLabel="Seções"
        active="a"
        onChange={jest.fn()}
        items={[
          { key: "a", label: "Aberta", href: "/companies/x/cadastro" },
          { key: "b", label: "Trancada", href: "/companies/x/edit", disabled: true, title: "Sem permissão" },
        ]}
      />
    );
    const trancada = screen.getByRole("button", { name: "Trancada" });
    expect(trancada).toBeDisabled();
    expect(trancada).not.toHaveAttribute("href");
  });

  test("item sem href continua `<button>` (nada quebra em quem não passou URL)", () => {
    render(
      <Tabs
        ariaLabel="Seções"
        active="a"
        onChange={jest.fn()}
        items={[{ key: "a", label: "Uma" }, { key: "b", label: "Outra" }]}
      />
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Outra" })).toBeInTheDocument();
  });
});
