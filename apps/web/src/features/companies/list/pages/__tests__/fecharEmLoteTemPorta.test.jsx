import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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


const selecionar = (nome) => fireEvent.click(screen.getByRole('checkbox', {name: 'Selecionar ' + nome}));
const botaoDeFechar = () => screen.queryByRole('button', {name: /Fechar as \d+ selecionadas aptas/});

test('a faixa Carteira inteira foi removida e nenhuma ação aparece sem seleção', async () => {
  montar();
  await screen.findByText(/ALFA PRONTA/);
  expect(screen.queryByRole('group', {name:'Pendências da carteira'})).not.toBeInTheDocument();
  expect(screen.queryByText('CARTEIRA INTEIRA')).not.toBeInTheDocument();
  expect(botaoDeFechar()).toBeNull();
});
test('fechamento continua acessível para as empresas selecionadas aptas', async () => {
  montar();
  selecionar(PRONTA_A.razao);
  selecionar(PRONTA_B.razao);
  await waitFor(() => expect(botaoDeFechar()).toHaveTextContent('Fechar as 2 selecionadas aptas'));
  selecionar(PRONTA_B.razao);
  expect(botaoDeFechar()).toHaveTextContent('Fechar as 1 selecionadas aptas');
});
test('empresa bloqueada selecionada não entra no lote', async () => {
  montar();
  selecionar(PRONTA_A.razao);
  selecionar(COM_PROBLEMA.razao);
  await waitFor(() => expect(botaoDeFechar()).toHaveTextContent('Fechar as 1 selecionadas aptas'));
});
test('busca retira do lote quem não está mais visível', async () => {
  montar();
  selecionar(PRONTA_A.razao);
  selecionar(PRONTA_B.razao);
  await waitFor(() => expect(botaoDeFechar()).toHaveTextContent('Fechar as 2 selecionadas aptas'));
  fireEvent.change(screen.getByPlaceholderText(/Cl[íi]nica/i), {target:{value:'ALFA'}});
  expect(botaoDeFechar()).toHaveTextContent('Fechar as 1 selecionadas aptas');
});
test('cancelar a confirmação não fecha nenhuma empresa', async () => {
  const fecharFechamentoContabil=jest.fn();
  const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);
  try {
    montar({fecharFechamentoContabil});
    selecionar(PRONTA_A.razao);
    await waitFor(() => expect(botaoDeFechar()).toBeInTheDocument());
    fireEvent.click(botaoDeFechar());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(PRONTA_A.razao));
    expect(fecharFechamentoContabil).not.toHaveBeenCalled();
  } finally { confirm.mockRestore(); }
});
