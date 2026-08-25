// A ENGRENAGEM DE CONFIGURAÇÃO NA ABA NOTAS FISCAIS — pedido do dono, 19/08/2026:
//
// > *"a aba nova que criei no fiscal de emissão de NFS-e deve ser uma engrenagem de configuração
// > na aba Notas Fiscais."*
//
// ⚠ O QUE MUDOU FOI A ENTRADA, NÃO O DESTINO — e é isso que este arquivo prova. A tela de
// configuração continua na MESMA rota (`/companies/:id/emissao-nfse`); o que saiu foi a aba irmã no
// grupo Fiscal. Transformá-la em modal teria perdido o que o próprio dono pediu na mensagem
// anterior: Ctrl+clique abrindo em nova guia (mais o link copiável e o voltar do navegador).
//
// Por isso a engrenagem é um `<a href>` de verdade, com a MESMA regra de clique das abas
// (`components/ui/cliqueDeLink.js`): clique simples navega por dentro do app, Ctrl/Cmd/Shift/Alt e
// botão do meio são do navegador.

import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotasFiscaisTab } from "../renderNotasFiscaisTab";
import { companyTabPath } from "../../../companies/detail/lib/rotasDaEmpresa";

const URL_CONFIG = companyTabPath("empresa-1", "emissaoNfse");

function painelDeNotas() {
  return {
    loading: false, error: null, reload: jest.fn(),
    dfeState: null, dfeSyncing: false, syncDfe: jest.fn(), clearDfeError: jest.fn(),
    adnState: null, adnSyncing: false, syncAdn: jest.fn(), clearAdnError: jest.fn(),
    companyId: "empresa-1",
    notas: [], notasTotal: 0,
    notasFilters: { type: "NFSE", papel: "EMIT", competencia: "2026-08", offset: 0, limit: 100 },
    setNotasFilters: jest.fn(),
    notasSummary: null, loadingNotas: false, loadNotas: jest.fn(),
    importing: false, importNotas: jest.fn(), marcarNotaStatus: jest.fn(),
    notaAbertaId: null, notaAberta: null, notaLoading: false, notaError: null,
    abrirNota: jest.fn(), fecharNota: jest.fn(),
  };
}

function abrirAba(props = {}) {
  const onAbrirConfiguracaoEmissao = jest.fn();
  render(
    <NotasFiscaisTab
      notasPanel={painelDeNotas()}
      competencia="2026-08"
      regime="SIMPLES"
      hrefConfiguracaoEmissao={URL_CONFIG}
      onAbrirConfiguracaoEmissao={onAbrirConfiguracaoEmissao}
      {...props}
    />
  );
  return { onAbrirConfiguracaoEmissao };
}

function clicar(elemento, init = {}) {
  const evento = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  fireEvent(elemento, evento);
  return evento;
}

describe("a engrenagem está na aba, e leva à tela certa", () => {
  it("aparece na aba Notas Fiscais e aponta para a rota da configuração", () => {
    abrirAba();
    const engrenagem = screen.getByTestId("engrenagem-emissao-nfse");
    expect(engrenagem.tagName).toBe("A");
    // ⚠ A URL sai de `companyTabPath`, a MESMA fonte da navegação por clique. Montar a string à
    // parte faria o link levar a um lugar e o clique a outro na primeira correção.
    expect(engrenagem).toHaveAttribute("href", "/companies/empresa-1/emissao-nfse");
  });

  // ⚠ ÍCONE SOZINHO NÃO SE EXPLICA. O dono está cortando texto de tela, então o rótulo acessível é
  // o canal — sem ele isto é um desenho clicável, e quem usa leitor de tela ouviria só "link".
  it("diz o que é, para o leitor de tela e para quem passa o mouse", () => {
    abrirAba();
    const engrenagem = screen.getByRole("link", { name: "Configurar a emissão de NFS-e desta empresa" });
    expect(engrenagem).toHaveAttribute("title");
    expect(engrenagem.getAttribute("title")).toMatch(/série da DPS|carga tributária/i);
  });

  it("o clique normal navega por dentro do app, sem recarregar a página", () => {
    const { onAbrirConfiguracaoEmissao } = abrirAba();
    const evento = clicar(screen.getByTestId("engrenagem-emissao-nfse"));
    expect(evento.defaultPrevented).toBe(true);
    expect(onAbrirConfiguracaoEmissao).toHaveBeenCalled();
  });

  test.each([
    ["Ctrl (Windows/Linux)", { ctrlKey: true }],
    ["Cmd (Mac)", { metaKey: true }],
    ["Shift (nova janela)", { shiftKey: true }],
    ["clique do meio", { button: 1 }],
  ])("%s NÃO é interceptado — quem abre a guia é o navegador", (_nome, init) => {
    const { onAbrirConfiguracaoEmissao } = abrirAba();
    const evento = clicar(screen.getByTestId("engrenagem-emissao-nfse"), init);
    expect(evento.defaultPrevented).toBe(false);
    // E a tela atual não muda: quem clicou com Ctrl quer a outra guia, não sair desta.
    expect(onAbrirConfiguracaoEmissao).not.toHaveBeenCalled();
  });

  // ⚠ Prop ausente = "esta tela não recebeu a URL". Um link para lugar nenhum é pior que nenhum
  // link: no Ctrl+clique ele abriria uma guia quebrada.
  it("sem a URL, a engrenagem não é desenhada", () => {
    abrirAba({ hrefConfiguracaoEmissao: null });
    expect(screen.queryByTestId("engrenagem-emissao-nfse")).not.toBeInTheDocument();
  });

  // ⚠ Verde é CONCLUÍDO neste app e âmbar é PENDÊNCIA. Configuração não é nem uma nem outra — ela
  // não pede ação hoje, então não pode competir com o que pede.
  it("não usa cor de estado (nem verde, nem âmbar)", () => {
    abrirAba();
    const style = screen.getByTestId("engrenagem-emissao-nfse").getAttribute("style") || "";
    expect(style).not.toMatch(/state-ok|state-warn|state-danger|var(--success)|#FFB347/i);
    expect(style).toContain("var(--text-faint)");
  });
});

// ⚠ A engrenagem configura a emissão de NFS-e. Na janela de NF-e (capturada da SEFAZ) não há
// emissão para configurar — ela ali seria um controle que não pertence à tela.
describe("ela pertence à janela de NFS-e", () => {
  it("não aparece na janela de notas de compra (NF-e)", () => {
    // ⚠ `hasInscricaoEstadual` SAIU da aba em 23/08/2026 — a janela de NF-e aparece sempre. A prop
    // condicionava a janela à IE e escondia as notas de COMPRA das 3 de 3 empresas que as têm
    // (nenhuma tem IE). O rótulo mudou junto: "venda" → "compra", porque 47 de 47 NF-e da base
    // são `papel: "DEST"`. Ver o cabeçalho de `renderNotasFiscaisTab.jsx`.
    abrirAba();
    fireEvent.click(screen.getByRole("button", { name: /Notas de compra/ }));
    expect(screen.queryByTestId("engrenagem-emissao-nfse")).not.toBeInTheDocument();
  });
});
