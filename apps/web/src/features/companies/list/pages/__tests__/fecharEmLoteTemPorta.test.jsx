// ⚠⚠ O FECHAMENTO CONTÁBIL EM LOTE EXISTIA E NÃO TINHA PORTA — de 25/07/2026 a 27/08/2026.
//
// `renderCompaniesHomePage.jsx` condicionava o botão a `travaFiltro === "prontas"`. As chaves que os
// chips atribuem são `all`, `problema`, `fechar`, `apurar`, `fechada` e `enviar` — **`"prontas"`
// nunca é atribuída a `travaFiltro` em lugar nenhum**. A palavra só existia em
// `contagemTravas.prontas` e no guard de `fecharAsProntas`.
//
// ⚠ Conferido no NAVEGADOR antes do conserto: clicando o chip "☑ Falta fechar · 2" no dashboard
// rodando, o botão não aparecia. O código do lote está inteiro — sequencial, revalidando no servidor,
// contando recusas em vez de abortar no primeiro erro — e ninguém conseguia acioná-lo.
//
// ⚠⚠ E O `features/companies/CLAUDE.md` DESCREVIA O BOTÃO COMO SE ELE ESTIVESSE NA TELA. É o modo de
// falhar mais caro desta base: a documentação afirma um recurso, ninguém duvida dela, e o recurso não
// existe. Por isso a guarda é de LIGAÇÃO — ela clica o chip e procura o botão.
//
// ⚠ O que este arquivo NÃO mede é a regra do lote (sequencial, recusa, relatório): aquilo é do
// servidor. Aqui se mede a PORTA.

import { render, screen, fireEvent } from "@testing-library/react";
import { CompaniesHomePage } from "../renderCompaniesHomePage.jsx";

/**
 * ⚠ `apuracao.apurada: true` é o que põe a empresa em "Falta fechar" — e é deliberado no
 * `estadoApuracao`: sem prova de que apurou, o honesto é "ainda não apurou". Sem isso a carteira
 * inteira nasceria em âmbar no dia 1 do mês.
 */
function empresa(companyId, razao, over = {}) {
  return {
    companyId,
    razao,
    cnpj: "11222333000181",
    legacyCompany: { regimeTributario: "SIMPLES", certStorageKey: "k", certExpiresAt: "2099-01-01" },
    guideCompliance: { das: { required: true, state: "gerada", ok: true, guideId: `g-${companyId}` } },
    fiscalSituacao: "REGULAR",
    fiscalCheckedAt: new Date().toISOString(),
    notasEmitidas: { total: 0 },
    apuracao: { apurada: true },
    ...over,
  };
}

const PRONTA_A = empresa("a", "ALFA PRONTA LTDA");
const PRONTA_B = empresa("b", "BETA PRONTA LTDA");
// ⚠ Apurada, mas com lançamento em branco: o servidor recusaria. Ela entra no chip "Falta fechar"?
// Não — `blockers` a manda para "Problema", que é o certo. Ela existe aqui para provar que o número
// do botão NÃO é o número do chip.
const COM_PROBLEMA = empresa("c", "GAMA TRAVADA LTDA");

const CARTEIRA = [PRONTA_A, PRONTA_B, COM_PROBLEMA];

/** A resposta de `getCarteiraFechamento`: quem dá para fechar de verdade. */
function travas() {
  return {
    ok: true,
    empresas: [
      { companyId: "a", razao: PRONTA_A.razao, podeFechar: true, fechado: false, blockers: [] },
      { companyId: "b", razao: PRONTA_B.razao, podeFechar: true, fechado: false, blockers: [] },
      { companyId: "c", razao: COM_PROBLEMA.razao, podeFechar: false, fechado: false, blockers: ["lancamento em branco"] },
    ],
  };
}

// ⚠⚠ A CARTEIRA ABRE NO CALENDÁRIO desde 01/09/2026 (dono: *"sempre que abrir abre no
// Calendário, sendo o modo Tabela selecionável"*), e TUDO que este arquivo mede — os chips de
// APURAÇÃO DO MÊS e o botão de fechar em lote — vive na visão de TABELA. Por isso o helper troca
// de visão logo depois de montar: sem isso os seis casos aqui mediriam a ausência dos controles
// numa tela que simplesmente não é a deles, e ficariam verdes pelo motivo errado no dia em que o
// botão voltasse a sumir de verdade.
// ⚠ Quem trava o padrão (Calendário) é `carteiraAbreNoCalendario.test.jsx` — aqui não se afirma
// nada sobre qual visão abre, só se navega até a que interessa.
function irParaTabela() {
  fireEvent.click(screen.getByRole("button", { name: /^Tabela$/ }));
}

function montar(api = {}) {
  const r = render(
    <CompaniesHomePage
      user={{ name: "Contador" }}
      companies={CARTEIRA}
      loadingCompanies={false}
      onCreateCompany={jest.fn()}
      onRefreshCompanies={jest.fn()}
      onOpenCompany={jest.fn()}
      onLogout={jest.fn()}
      dashboardCompetencia="2026-07"
      onChangeCompetencia={jest.fn()}
      api={{ getCarteiraFechamento: jest.fn(async () => travas()), ...api }}
    />,
  );
  irParaTabela();
  return r;
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom sempre tem, mas o app não conta com isso */ }
});

const chip = (texto) => screen.getByRole("button", { name: new RegExp(texto, "i") });
const botaoDeFechar = () => screen.queryByRole("button", { name: /Fechar as \d+/ });

describe("⚠⚠ o botão de fechar em lote TEM porta", () => {
  it("⚠⚠ ele aparece ao clicar o chip 'Falta fechar' — o caso que estava morto", async () => {
    montar();
    await screen.findByText(/ALFA PRONTA/);
    expect(botaoDeFechar()).toBeNull();

    fireEvent.click(chip("Falta fechar"));
    expect(botaoDeFechar()).toBeInTheDocument();
  });

  it("⚠ e some fora do recorte — a intenção original fica de pé", () => {
    // O comentário do botão diz por quê: *"um botão de fechar em lote solto na barra seria fácil de
    // clicar sem ter olhado quem vai ser fechado"*. O recorte É o ter olhado.
    montar();
    expect(botaoDeFechar()).toBeNull();
  });

  it("⚠ nenhum chip atribui a chave `prontas` — a condição morta não pode voltar", () => {
    // A varredura é sobre os chips REAIS da tela: se alguém reintroduzir `travaFiltro === "prontas"`,
    // o caso de cima cai; se alguém criar um chip "Prontas", este aqui avisa que a história mudou.
    montar();
    const nomes = screen.getAllByRole("button").map((b) => b.textContent.trim());
    expect(nomes.some((n) => /^Prontas/i.test(n))).toBe(false);
  });
});

describe("⚠⚠ o número do botão é o das que ESTÃO NA TELA e dá para fechar", () => {
  it("⚠ ele pode ser MENOR que o do chip, e isso é correto", async () => {
    // "Falta fechar" é estado de APURAÇÃO; `podeFechar` é o CONTÁBIL. A empresa com lançamento em
    // branco cai em "Problema" e não entra na conta — se entrasse, o servidor a recusaria e o
    // contador leria "3" no botão e "2 fechadas" no relatório.
    montar();
    await screen.findByText(/ALFA PRONTA/);
    fireEvent.click(chip("Falta fechar"));
    expect(botaoDeFechar().textContent).toMatch(/Fechar as 2/);
  });

  it("⚠⚠ e ele age sobre as VISÍVEIS, não sobre a carteira inteira", async () => {
    // Este é o defeito que o conserto NÃO podia introduzir: `contagemTravas.prontas` conta a
    // carteira toda. Filtrando a busca para uma empresa só, o botão tem de dizer 1.
    montar();
    await screen.findByText(/ALFA PRONTA/);
    fireEvent.click(chip("Falta fechar"));

    const busca = screen.getByPlaceholderText(/Cl[íi]nica/i);
    fireEvent.change(busca, { target: { value: "ALFA" } });
    expect(botaoDeFechar().textContent).toMatch(/Fechar as 1/);
  });

  it("sem nenhuma pronta à vista, o botão não existe", async () => {
    montar();
    await screen.findByText(/ALFA PRONTA/);
    fireEvent.click(chip("Falta fechar"));
    fireEvent.change(screen.getByPlaceholderText(/Cl[íi]nica/i), { target: { value: "GAMA" } });
    expect(botaoDeFechar()).toBeNull();
  });
});
