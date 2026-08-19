// A ABA "EMISSÃO DE NFS-e" ESTÁ LIGADA? — as TRÊS peças, e o salvar que é só dela.
//
// Pedido do dono (19/08/2026): *"configuração de notas na aba do contador está ficando muito
// grande, vamos separar ela em uma aba própria"* … *"ele ganha o próprio salvar"*.
//
// ⚠ POR QUE ESTE ARQUIVO EXISTE. Componente sem chamador é o defeito favorito desta base: a aba
// pode existir, ter teste próprio verde, e não estar em lugar nenhum da tela. E aba nova exige
// TRÊS peças — entrada em `GROUPS`, o par `SEGMENT_TO_TAB`/`TAB_TO_SEGMENT` e o bloco `if` na
// página. ⚠ Faltando o par, a URL cai em Anotações **sem erro nenhum** (foi o destino de
// `/calendario` e `/pendencias` por um tempo). Cada peça tem um teste aqui.

import fs from "node:fs";
import path from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CompanySectionHeader } from "../renderCompanyDetailHeader";
import { EmissaoNfseTab } from "../renderEmissaoNfseTab";
import { SEGMENT_TO_TAB, TAB_TO_SEGMENT, companyTabPath } from "../../lib/rotasDaEmpresa";

const EMPRESA = {
  companyId: "empresa-1",
  razao: "ACME SERVICOS LTDA",
  cnpj: "12.345.678/0001-90",
  legacyCompany: { regimeTributario: "SIMPLES" },
};

describe("peça 1 — a aba existe no menu da empresa (GROUPS)", () => {
  it("aparece no grupo Fiscal, com a URL da rota dela", () => {
    render(
      <CompanySectionHeader
        company={EMPRESA} activeTab="notasFiscais" onBack={jest.fn()}
        onTabChange={jest.fn()} canEditCompany
      />
    );
    expect(screen.getByRole("link", { name: "Emissão de NFS-e" }))
      .toHaveAttribute("href", "/companies/empresa-1/emissao-nfse");
  });

  it("clicar nela navega para `emissaoNfse`", () => {
    const onTabChange = jest.fn();
    render(
      <CompanySectionHeader
        company={EMPRESA} activeTab="notasFiscais" onBack={jest.fn()}
        onTabChange={onTabChange} canEditCompany
      />
    );
    fireEvent.click(screen.getByRole("link", { name: "Emissão de NFS-e" }));
    expect(onTabChange).toHaveBeenCalledWith("emissaoNfse");
  });

  // ⚠ Ela NÃO é `soApuraSimples`: os campos são sobre EMITIR nota de serviço, não sobre o regime.
  // Escondê-la do Lucro Presumido tiraria a configuração de quem também emite NFS-e — e a carga
  // tributária aproximada é justamente do NÃO optante.
  it("aparece também no Lucro Presumido", () => {
    render(
      <CompanySectionHeader
        company={{ ...EMPRESA, legacyCompany: { regimeTributario: "LUCRO_PRESUMIDO" } }}
        activeTab="notasFiscais" onBack={jest.fn()} onTabChange={jest.fn()} canEditCompany
      />
    );
    expect(screen.getByRole("link", { name: "Emissão de NFS-e" })).toBeInTheDocument();
    // e a aba Apuração continua escondida — a prova de que o filtro por regime não foi afrouxado
    expect(screen.queryByRole("link", { name: "Apuração" })).not.toBeInTheDocument();
  });
});

describe("peça 2 — o PAR de segmentos (sem ele a URL cai em Anotações em silêncio)", () => {
  it("o segmento vira a aba e a aba vira o segmento", () => {
    expect(SEGMENT_TO_TAB["emissao-nfse"]).toBe("emissaoNfse");
    expect(TAB_TO_SEGMENT.emissaoNfse).toBe("emissao-nfse");
  });

  it("a ida e a volta fecham", () => {
    const url = companyTabPath("empresa-1", "emissaoNfse");
    expect(url).toBe("/companies/empresa-1/emissao-nfse");
    expect(SEGMENT_TO_TAB[url.split("/").pop()]).toBe("emissaoNfse");
  });
});

// ⚠ Varredura de fonte, no mesmo formato de `cargaTributariaNoAssistente.test.jsx`: o que importa
// aqui é o que a PÁGINA passa, e renderizá-la inteira arrastaria meia dúzia de hooks de rede.
describe("peça 3 — o bloco `if` da página, e o que ele passa para a aba", () => {
  const PAGINA = [
    path.join(process.cwd(), "src", "features", "companies", "detail", "pages", "renderCompanyDetailPage.jsx"),
    path.join(process.cwd(), "apps", "web", "src", "features", "companies", "detail", "pages", "renderCompanyDetailPage.jsx"),
  ].find((p) => fs.existsSync(p));

  it("a página foi encontrada — senão esta varredura seria um teste vazio", () => {
    expect(PAGINA).toBeTruthy();
  });

  const fonte = fs.readFileSync(PAGINA, "utf8");

  it("existe o ramo da aba — sem ele, as outras duas peças levam a lugar nenhum", () => {
    expect(fonte).toContain('companyDetailTab === "emissaoNfse"');
    expect(fonte).toContain("<EmissaoNfseTab");
  });

  const bloco = fonte.slice(
    fonte.indexOf("<EmissaoNfseTab"),
    fonte.indexOf("/>", fonte.indexOf("emissaoClienteSaving={editPanel?.emissaoClienteSaving}", fonte.indexOf("<EmissaoNfseTab"))),
  );

  // ⚠ O SALVAR DA ABA É O DA ROTA PRÓPRIA. Se a página passasse `editPanel.onSubmit`, a aba
  // mandaria a empresa inteira — e a rota do cadastro recusaria com 400 por falta de CNPJ, razão
  // social e CNAE, num formulário que não tem nenhum dos três.
  it("recebe o salvar PRÓPRIO (`onSalvarEmissaoNfse`), não o do cadastro", () => {
    expect(bloco).toContain("onSalvarEmissaoNfse");
    // `onSubmit=` como PROP — o comentário do arquivo cita o nome de propósito, ao explicar por que
    // ele não entra aqui.
    expect(bloco).not.toMatch(/onSubmit=/);
  });

  it("recebe o portão do cliente como bloco à parte, com o handler da rota dele", () => {
    expect(bloco).toContain("emissaoCliente={selectedCompany?.emissaoCliente}");
    expect(bloco).toContain("onSetEmissaoCliente");
  });
});

describe("o salvar da aba grava, e só grava o que é dela", () => {
  function abrir(props = {}) {
    const onSalvar = jest.fn(async () => ({ ok: true }));
    render(
      <EmissaoNfseTab
        company={{ razao: "ACME", legacyCompany: { rpsSerie: "00001", codigoServicoMunicipal: "001" } }}
        onSalvar={onSalvar}
        {...props}
      />
    );
    return { onSalvar };
  }

  it("os campos chegam na aba com o que está gravado", () => {
    abrir();
    expect(screen.getByLabelText("Série da DPS", { exact: false })).toHaveValue("00001");
    expect(screen.getByLabelText("Código municipal do serviço", { exact: false })).toHaveValue("001");
  });

  it("salvar manda os sete campos — e SÓ eles", async () => {
    const { onSalvar } = abrir();
    fireEvent.change(screen.getByLabelText("Série da DPS", { exact: false }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar configuração de emissão/i }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalled());
    expect(Object.keys(onSalvar.mock.calls[0][0]).sort()).toEqual([
      "codigoServicoMunicipal", "codigoServicoNacional", "codigosServicoNacional",
      "pTotTribEst", "pTotTribFed", "pTotTribMun", "rpsSerie",
    ]);
  });

  // ⚠⚠ A LIBERAÇÃO AO CLIENTE NÃO VIAJA NO SALVAR. Ela tem rota própria, com confirmação e
  // auditoria de quem/quando: um campo a mais aqui faria o ato fiscal viajar junto de troca de
  // código de serviço, e a confirmação perderia o sentido.
  it("o portão do cliente NÃO entra no que a aba salva", async () => {
    const onSetEmissaoCliente = jest.fn(async () => ({ ok: true }));
    const { onSalvar } = abrir({
      emissaoCliente: { liberada: true, liberadaEm: "2026-08-18T12:00:00.000Z", liberadaPor: "u1", liberadaPorNome: "Contador" },
      onSetEmissaoCliente,
    });
    // o bloco está na tela, como bloco à parte
    expect(screen.getByTestId("estado-emissao-cliente")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Série da DPS", { exact: false }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar configuração de emissão/i }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalled());

    const campos = onSalvar.mock.calls[0][0];
    expect(campos).not.toHaveProperty("emissaoCliente");
    expect(campos).not.toHaveProperty("liberada");
    // e salvar a configuração não mexe no portão
    expect(onSetEmissaoCliente).not.toHaveBeenCalled();
  });

  it("sem alteração não há o que salvar — e a tela diz isso, em vez de só desabilitar", () => {
    abrir();
    expect(screen.getByRole("button", { name: /Salvar configuração de emissão/i })).toBeDisabled();
    expect(screen.getByText(/Nada para salvar/i)).toBeInTheDocument();
  });

  it("sem permissão de edição a aba não oferece campo nenhum", () => {
    render(<EmissaoNfseTab company={{ razao: "ACME", legacyCompany: {} }} onSalvar={jest.fn()} podeEditar={false} />);
    expect(screen.queryByLabelText("Série da DPS", { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText(/Apenas admin ou contador/i)).toBeInTheDocument();
  });
});
