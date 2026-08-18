// A CARGA TRIBUTÁRIA CHEGA AO ASSISTENTE? — a prova de que a pendência tem CHAMADOR.
//
// ⚠ POR QUE ESTE ARQUIVO EXISTE, e por que ele não é o `emitirNfseWizard.test.jsx` de novo.
// Aquele monta o `<EmitirNfseWizard>` DIRETO, passando `regime` e `cadastroEmissao` na mão — ele
// prova que o assistente sabe o que fazer com os três percentuais, e continuaria VERDE com a aba
// nunca passando a prop e com a página de detalhe nunca lendo as colunas. Componente sem chamador é
// o defeito favorito desta casa (o precedente literal está em
// `companies/form/components/__tests__/cargaTributariaLigada.test.jsx`).
//
// Aqui a cadeia é exercida nos dois pontos onde ela pode partir:
//   1. `NotasFiscaisTab` → `EmitirNfseWizard`: a empresa do Lucro Presumido de fato CHEGA ao
//      assistente pelo botão "+ Emitir nota", e a pendência de carga aparece no passo 1;
//   2. `renderCompanyDetailPage` → `NotasFiscaisTab`: o objeto `cadastroEmissao` que a página monta
//      carrega as três colunas. Sem isso o assistente receberia um cadastro sem elas e diria que a
//      carga falta em TODA empresa não optante, inclusive nas configuradas.
//
// ⚠ NENHUM TESTE DESTE PROJETO EMITE NADA. O assistente é aberto e lido; `onEmitir` nunca é
// chamado, e o botão Emitir sequer existe no passo 1.

import fs from "node:fs";
import path from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotasFiscaisTab } from "../renderNotasFiscaisTab";

const CADASTRO_SEM_CARGA = {
  cnpj: "39254243000191",
  inscricaoMunicipal: "1.234.567-8",
  codigoServicoNacional: "171201",
  codigosServicoNacional: ["171201"],
  codigoServicoMunicipal: "001",
  rpsSerie: "00001",
  pTotTribFed: null,
  pTotTribEst: null,
  pTotTribMun: null,
};

// Os números da NFS-e real versionada (`docs/leiaute-nfse/nfse-nacional-substituicao.xml`,
// `opSimpNac=1`): 11,33 federal e 0,00 nos outros dois. ⚠ Zero DECLARADO é legítimo.
const CARGA_CONFIGURADA = { pTotTribFed: 11.33, pTotTribEst: 0, pTotTribMun: 0 };

/** O `notasPanel` que a aba consome, no menor formato que ela aceita. Nada aqui chama a rede. */
function painelDeNotas() {
  return {
    loading: false,
    error: null,
    reload: jest.fn(),
    dfeState: null,
    dfeSyncing: false,
    syncDfe: jest.fn(),
    clearDfeError: jest.fn(),
    adnState: null,
    adnSyncing: false,
    syncAdn: jest.fn(),
    clearAdnError: jest.fn(),
    companyId: "c-1",
    notas: [],
    notasTotal: 0,
    notasFilters: { type: "NFSE", papel: "EMIT", competencia: "2026-08", offset: 0, limit: 100 },
    setNotasFilters: jest.fn(),
    notasSummary: null,
    loadingNotas: false,
    loadNotas: jest.fn(),
    importing: false,
    importNotas: jest.fn(),
    marcarNotaStatus: jest.fn(),
    notaAbertaId: null,
    notaAberta: null,
    notaLoading: false,
    notaError: null,
    abrirNota: jest.fn(),
    fecharNota: jest.fn(),
  };
}

function abrirAba({ regime, cadastroEmissao }) {
  render(
    <NotasFiscaisTab
      notasPanel={painelDeNotas()}
      competencia="2026-08"
      regime={regime}
      codigoMunicipioIbge="3304557"
      cadastroEmissao={cadastroEmissao}
    />
  );
}

function clicarEmEmitir() {
  fireEvent.click(screen.getByRole("button", { name: /Emitir nota/ }));
}

describe("a empresa do Lucro Presumido CHEGA ao assistente pela aba Notas Fiscais", () => {
  it("o botão existe e abre o assistente — a trava do não optante não vive mais aqui", () => {
    abrirAba({ regime: "LUCRO_PRESUMIDO", cadastroEmissao: { ...CADASTRO_SEM_CARGA, ...CARGA_CONFIGURADA } });
    clicarEmEmitir();
    expect(screen.getByText("Emitir nota de serviço")).toBeInTheDocument();
    // O regime que a nota vai declarar, lido pela aba e repassado ao assistente.
    expect(screen.getAllByText(/Não optante pelo Simples Nacional \(opSimpNac 1\)/).length).toBeGreaterThan(0);
    // ⚠ Com a carga configurada, nada impede a EMPRESA de emitir.
    expect(screen.queryByText(/Esta empresa ainda não pode emitir nota de serviço/)).not.toBeInTheDocument();
  });

  it("⚠ sem a carga configurada, a pendência aparece NO PASSO 1 — não na recusa do servidor", () => {
    abrirAba({ regime: "LUCRO_PRESUMIDO", cadastroEmissao: CADASTRO_SEM_CARGA });
    clicarEmEmitir();

    const bloco = screen.getByText(/Esta empresa ainda não pode emitir nota de serviço/).closest("div");
    expect(bloco).toHaveTextContent("Carga tributária aproximada");
    expect(bloco).toHaveTextContent("federal, estadual e municipal (iss)");
    expect(bloco).toHaveTextContent("Editar cadastro → Emissão de NFS-e → Carga tributária aproximada");
    // O passo 1 é o passo de preencher: o botão Emitir nem existe ainda, e o Continuar está travado.
    expect(screen.queryByRole("button", { name: /^Emitir$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled();
  });

  it("a empresa do Simples abre o mesmo assistente e não vê nada sobre carga aproximada", () => {
    abrirAba({ regime: "SIMPLES", cadastroEmissao: CADASTRO_SEM_CARGA });
    clicarEmEmitir();
    expect(screen.getByText("Emitir nota de serviço")).toBeInTheDocument();
    expect(screen.queryByText(/Carga tributária aproximada/)).not.toBeInTheDocument();
    // Ela declara o OUTRO grupo — e esse campo continua onde estava.
    expect(screen.getByLabelText(/Total de tributos do Simples Nacional/)).toBeInTheDocument();
  });
});

// ⚠ A OUTRA METADE DA CADEIA. `cadastroEmissao` é montado campo a campo em
// `renderCompanyDetailPage.jsx` (não é o `legacyCompany` inteiro): coluna que não entre naquele
// literal simplesmente não existe para o assistente. Foi assim que `codigoMunicipioIbge` e os
// campos de NFS-e já se perderam antes — o `select` do backend voltou a trazê-los e a tela
// continuou sem ler. Mesmo formato de varredura de `app/hooks/__tests__/mensagensSemFila.test.js`.
describe("a página de detalhe passa as três colunas para a aba", () => {
  const PAGINA = [
    path.join(process.cwd(), "src", "features", "companies", "detail", "pages", "renderCompanyDetailPage.jsx"),
    path.join(process.cwd(), "apps", "web", "src", "features", "companies", "detail", "pages", "renderCompanyDetailPage.jsx"),
  ].find((p) => fs.existsSync(p));

  test("a página foi encontrada — senão esta varredura seria um teste vazio", () => {
    expect(PAGINA).toBeTruthy();
  });

  const fonte = fs.readFileSync(PAGINA, "utf8");
  // O literal `cadastroEmissao={{ … }}` — é ele, e só ele, que chega ao assistente.
  const literal = fonte.slice(
    fonte.indexOf("cadastroEmissao={{"),
    fonte.indexOf("}}", fonte.indexOf("cadastroEmissao={{")),
  );

  it.each(["pTotTribFed", "pTotTribEst", "pTotTribMun"])("%s entra no objeto `cadastroEmissao`", (campo) => {
    expect(literal).toContain(campo);
  });

  it("⚠⚠ os três vêm com `??`, nunca com `||` — 0,00 é um percentual DECLARADO", () => {
    // Com `||`, o zero conferido pelo contador (a NFS-e real declara 0,00 no estadual) viraria
    // `null`, a tela diria "falta o estadual" e mandaria redigitar o que já está gravado.
    for (const campo of ["pTotTribFed", "pTotTribEst", "pTotTribMun"]) {
      const linha = literal.split("\n").find((l) => l.includes(`${campo}:`));
      expect(linha).toBeTruthy();
      expect(linha).toContain("??");
      expect(linha).not.toContain("||");
    }
  });
});
