import { formatCompetencia, deslocarCompetencia, competenciaAtual } from "../../../../lib/competencia";

// ⚠ ABAS QUE VIVEM NUMA COMPETÊNCIA — e são as ÚNICAS que mostram o seletor.
//
// O plano dizia "todas as abas acompanham". "Todas" ao pé da letra não é o que se quer: Cadastro,
// Documentos, Anotações, Plano de Contas e Situação Fiscal não têm mês nenhum, e um seletor que não
// comanda nada é pior que seletor nenhum — a pessoa muda o mês, a tela não muda, e passa a duvidar
// do controle também onde ele funciona.
//
// Aba entra nesta lista quando passa a FILTRAR por competência, e cada uma teve de ceder o seu
// controle local (era o mesmo defeito repetido cinco vezes: dois seletores para um valor):
//
//   lancamentos     ← setas ◀ ▶ sobre a tabela + input no painel de filtros
//   circular        ← já usava a do painel; o ano da matriz acompanha
//   cadastroFiscal  ← `useState(competenciaAnterior())` PRÓPRIO, em dois `input type="month"`
//   guides          ← `filterCompetencia`, cujo "ver todas" só existia apagando o campo
//   notasFiscais    ← campo dentro de um form com botão "Filtrar" (discordava da tabela até o clique)
//
// Parcelamento fica de fora de propósito: lá a competência é a de ABERTURA de um parcelamento que
// se está criando — um dado sendo escrito, não um período sendo olhado. Amarrá-la ao header faria
// o seletor da tela mudar o conteúdo de um formulário.
//
// Obrigações também: o `CalendarioGrid` navega por mês com controle próprio, que já é o único
// daquela tela e serve à página principal do calendário do mesmo jeito.
const TABS_COM_COMPETENCIA = new Set(["lancamentos", "circular", "cadastroFiscal", "guides", "notasFiscais"]);

// Navegação da empresa em 2 níveis: grupos grandes (Anotações, Contabilidade, Fiscal, Empresa)
// e, abaixo, as sub-abas do grupo ativo. A aba ativa continua vindo do segmento da URL (activeTab);
// clicar num grupo navega pro seu 1º sub-tab. Nada de roteamento novo — só reagrupa o header.
const GROUPS = [
  {
    // ANOTAÇÕES VEM PRIMEIRO, e no primeiro nível — não é sub-aba de Cadastro.
    // O raciocínio do dono: se a empresa tem alguma particularidade, isso precisa ser sabido antes
    // de mexer em qualquer número. Enterrada dentro de "Empresa" ela só era vista por quem fosse
    // procurar; e quem vai procurar já sabe o que tem lá. Por isso é também a aba de entrada.
    key: "anotacoes",
    label: "Anotações",
    tabs: [{ key: "anotacoes", label: "Anotações" }],
  },
  {
    key: "contabilidade",
    label: "Contabilidade",
    // Plano de Contas NÃO é sub-aba: abre por dentro de Lançamentos (menu Configurações).
    // A rota /plano-contas segue válida — só não tem botão próprio aqui.
    tabs: [
      { key: "lancamentos", label: "Lançamentos" },
      { key: "circular", label: "Circular" },
      { key: "parcelamento", label: "Parcelamento" },
      // Obrigações fica em Contabilidade e NÃO em Fiscal de propósito: obrigação é o serviço que o
      // escritório entrega até uma data, não tributo a pagar. O cabeçalho do CalendarioFiscalService
      // argumenta isso — guia é do cliente, obrigação é do contador.
      { key: "obrigacoes", label: "Obrigações" },
    ],
  },
  {
    key: "fiscal",
    label: "Fiscal",
    // Cadastro absorve Sugestão e Pendências (viram sub-abas INTERNAS do painel Cadastro).
    // Q63: ordem = Notas Fiscais → Apuração → Guias → Situação Fiscal (a 1ª também é o destino
    // ao clicar no grupo "Fiscal").
    tabs: [
      { key: "notasFiscais", label: "Notas Fiscais" },
      // Só apuramos Simples hoje — no Lucro Presumido esta aba é escondida (ver soApuraSimples).
      { key: "cadastroFiscal", label: "Apuração", soApuraSimples: true },
      { key: "guides", label: "Guias" },
      { key: "sitfis", label: "Situação Fiscal" },
    ],
  },
  {
    // Abre a FICHA (read-only). Editar é um botão dentro dela, que leva à aba `edit`.
    key: "cadastro",
    // Grupo = "Empresa" (ficha, documentos, anotações). Antes chamava "Cadastro", mesmo nome da
    // sub-aba fiscal e da tela de ficha — a palavra apontava para três lugares diferentes.
    label: "Empresa",
    // Documentos (contrato social, cartão CNPJ, inscrições) mora aqui: é cadastral, não fiscal.
    // Anotações SAIU daqui — virou grupo próprio, primeiro de todos.
    tabs: [
      { key: "cadastro", label: "Cadastro" },
      { key: "documentos", label: "Documentos" },
    ],
  },
];


// Abas que não são sub-aba de ninguém, mas pertencem a um grupo (o grupo fica destacado).
// `edit` abre pela ficha (botão Editar) e `planoContas` por Lançamentos → Configurações.
const TAB_TO_GROUP = { edit: "cadastro", planoContas: "contabilidade" };

// Q63: a aba "Apuração" só existe pro Simples — ainda não apuramos Lucro Presumido/Real no app.
// O regime vem do cadastro legado (mesma fonte da tag do card) ou do próprio company.
function isSimplesCompany(company) {
  const regime = company?.regimeTributario
    || company?.tipoTributario
    || company?.legacyCompany?.regimeTributario
    || company?.legacyCompany?.tipoTributario;
  // Sem regime cadastrado não escondemos nada (não sabemos o suficiente pra tirar a aba).
  if (!regime) return true;
  return String(regime).trim().toUpperCase() === "SIMPLES";
}

// O seletor de competência da empresa. Um só controle, no header, para as abas que têm mês.
function CompetenciaSwitcher({ competencia, onChange }) {
  // ⚠ Não se navega para além do mês corrente: não há o que apurar num mês que não terminou, e
  // uma tela vazia de outubro/2027 se parece com erro de carga. O limite é do CONTROLE, não do
  // dado — competência que já veio à frente (vinda de link ou de estado antigo) continua exibida.
  const teto = competenciaAtual();
  const proxima = deslocarCompetencia(competencia, 1);
  const noTeto = competencia >= teto;

  return (
    <div className="company-topbar__competencia" role="group" aria-label="Competência">
      <button
        type="button"
        className="company-topbar__competencia-nav"
        onClick={() => onChange(deslocarCompetencia(competencia, -1))}
        aria-label="Competência anterior"
        title="Competência anterior"
      >
        ‹
      </button>
      <span className="company-topbar__competencia-valor" aria-live="polite">
        {formatCompetencia(competencia)}
      </span>
      <button
        type="button"
        className="company-topbar__competencia-nav"
        onClick={noTeto ? undefined : () => onChange(proxima)}
        disabled={noTeto}
        aria-label="Próxima competência"
        /* Opção desabilitada sempre diz por quê (princípio 7: ausência nunca é resposta). */
        title={noTeto ? "Este é o mês corrente — não há competência posterior para trabalhar" : "Próxima competência"}
      >
        ›
      </button>
    </div>
  );
}

export function CompanySectionHeader({
  company, activeTab, onBack, onTabChange, canEditCompany = false,
  competencia, onCompetenciaChange,
}) {
  const simples = isSimplesCompany(company);
  const mostraCompetencia = Boolean(competencia && onCompetenciaChange && TABS_COM_COMPETENCIA.has(activeTab));
  const groups = GROUPS.map((g) => ({
    ...g,
    tabs: g.tabs.filter((t) => !t.soApuraSimples || simples),
  }));
  const activeGroup =
    groups.find((g) => g.tabs.some((t) => t.key === activeTab))
    || groups.find((g) => g.key === TAB_TO_GROUP[activeTab])
    || groups[0];
  const subTabs = activeGroup.tabs;

  return (
    <header className="company-section-header">
      {/* Voltar fica FORA da barra (pílula) — só a seta, mesmo padrão de design. */}
      <button type="button" className="company-section-header__back" onClick={onBack} aria-label="Voltar" title="Voltar">
        ←
      </button>

      {/* Barra em pílula: nome da empresa + os 3 grupos juntos. */}
      <div className="company-topbar">
        <div className="company-topbar__brand">
          <strong className="company-topbar__name">{company?.razao || "Empresa"}</strong>
          <span className="company-topbar__cnpj">{company?.cnpj || "CNPJ não informado"}</span>
        </div>
        <nav className="company-topbar__nav" aria-label="Grupos da empresa">
          {groups.map((group) => {
            const isActive = group.key === activeGroup.key;
            const isDisabled = group.requiresEdit && !canEditCompany;
            return (
              <button
                key={group.key}
                type="button"
                className={`company-topbar__link${isActive ? " is-active" : ""}`}
                onClick={isDisabled ? undefined : () => onTabChange(group.tabs[0].key)}
                disabled={isDisabled}
                aria-current={isActive ? "page" : undefined}
                title={isDisabled ? "Apenas admin ou contador pode editar." : undefined}
              >
                {group.label}
              </button>
            );
          })}
        </nav>

        {/* ⚠ TERCEIRA coluna do grid, não ao lado do nome (o plano dizia "ao lado do nome/CNPJ").
            O `.company-topbar` é `1fr auto 1fr` justamente para o menu ficar centrado de verdade
            sem ser empurrado pelo nome da empresa; um quarto filho entre marca e menu jogaria o
            menu para a coluna da folga e descentralizaria o header em TODAS as abas. A folga da
            direita já existia vazia, e o controle global fica no mesmo nível hierárquico do menu. */}
        {mostraCompetencia && (
          <CompetenciaSwitcher competencia={competencia} onChange={onCompetenciaChange} />
        )}
      </div>

      {/* Nível 2 — sub-abas do grupo ativo, em formato de aba (Chrome). Oculto quando o grupo
          tem só 1 (ex.: Cadastro → abre direto a ficha). */}
      {subTabs.length > 1 && (
        <nav className="company-section-header__subtabs" aria-label={`Seções de ${activeGroup.label}`}>
          <div className="company-section-header__subtabs-pill">
            {subTabs.map((tab) => {
              const isActive = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`company-section-header__subtab${isActive ? " is-active" : ""}`}
                  onClick={isActive ? undefined : () => onTabChange(tab.key)}
                  aria-current={isActive ? "page" : undefined}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
}
