import { formatCompetencia, deslocarCompetencia, competenciaAtual } from "../../../../lib/competencia";
import { BackButton } from "../../../../components/ui/BackButton";
import { Tabs } from "../../../../components/ui/Tabs";
// ⚠ O `href` DAS ABAS SAI DAQUI, da MESMA fonte que a navegação por clique usa (`openCompanyTab`
// chama `companyTabPath` também). Montar "/companies/" + id + "/" + segmento aqui funcionaria hoje
// e divergiria na primeira correção — o link levaria a um lugar e o clique a outro.
import { companyTabPath } from "../lib/rotasDaEmpresa";
import { mostraApuracaoDoSimples } from "../../../apuracao-lp/lib/regimeDaAba";

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
// ⚠ `auditoria` entra aqui porque a auditoria É por competência — ela responde "as notas DESTE mês
// batem?". Sem o seletor, a aba mostraria sempre o mês default e não haveria como conferir outro.
// ⚠ `conferencia` entra aqui porque a FILA é por competência: ela responde "as despesas DESTE mês
// já foram conferidas?". Sem o seletor, a aba mostraria sempre o mês default e não haveria como
// conferir outro. ⚠ O recorte "sem competência" é um botão DENTRO da aba, não um valor do seletor —
// ele não é um mês, e pô-lo aqui faria o seletor global mudar de significado.
const TABS_COM_COMPETENCIA = new Set(["lancamentos", "conferencia", "circular", "cadastroFiscal", "guides", "notasFiscais", "auditoria"]);

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
      // ⚠ CONFERÊNCIA fica em CONTABILIDADE, e logo depois de Lançamentos — não em Fiscal. O que
      // sai dela é `AccountingEntry` (débito na despesa, crédito no caixa), e o contador chega
      // nela vindo de Lançamentos. Em Fiscal ela pareceria conferência de nota, que é a Auditoria.
      { key: "conferencia", label: "Conferência" },
      // ⚠⚠ AQUI FICAVA "FLUXO DE CAIXA", E ELE FOI REMOVIDO EM 29/08/2026 — decisão do dono, com a
      // tela na frente: *"para o contador não vai existir fluxo de caixa, pode eliminar isso da
      // aba"*. Não é defeito: a aba tinha 40 testes verdes e foi conferida no navegador em 27/08.
      // ⚠ O fluxo continua existindo, e só no PORTAL DO CLIENTE — é dele a pergunta "o que entra e
      // sai". O contador chega ao mesmo dinheiro pela Conferência (o que virou lançamento) e pelas
      // Guias (o que vence). Reintroduzir a aba aqui é reabrir uma decisão, não completar um
      // trabalho. ⚠ O segmento `/fluxo-de-caixa` continua respondendo em `rotasDaEmpresa.js`,
      // apontando para Lançamentos: link antigo não pode virar tela em branco.
      { key: "circular", label: "Circular" },
      { key: "parcelamento", label: "Parcelamento" },
      // Obrigações fica em Contabilidade e NÃO em Fiscal de propósito: obrigação é o serviço que o
      // escritório entrega até uma data, não tributo a pagar. O cabeçalho do CalendarioFiscalService
      // argumenta isso — guia é do cliente, obrigação é do contador.
      { key: "obrigacoes", label: "Obrigações" },
      // Relatórios fica em Contabilidade porque relata o que foi LANÇADO. É a única aba com
      // intervalo próprio — ver o comentário em TABS_COM_COMPETENCIA logo acima.
      { key: "relatorios", label: "Relatórios" },
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
      // ⚠ AUDITORIA VEM ANTES DE APURAÇÃO, e a ordem é o argumento: o dono pediu uma auditoria
      // *pré-apuração* ("entender se a nota está correta ou não, baseado na atividade e baseado na
      // data de emissão"). Ela lê as notas que a apuração vai somar; posta depois, seria conferência
      // do que já foi fechado. ⚠ E ela NÃO é `soApuraSimples`: as cinco perguntas são sobre a NOTA
      // (código de serviço, data, ISS, numeração da DPS), não sobre o regime — esconder a aba do
      // Lucro Presumido tiraria a conferência de quem também emite NFS-e.
      { key: "auditoria", label: "Auditoria" },
      // ⚠⚠ ELA DEIXOU DE SER `soApuraSimples` EM 27/08/2026, e não é afrouxamento: a aba agora
      // DESPACHA por regime (`telaDeApuracao`, em `features/apuracao-lp/lib/regimeDaAba.js`).
      // Empresa do Simples continua vendo o PGDAS-D; a do Presumido/Real vê a apuração dela; e
      // empresa SEM regime continua no ramo do Simples, exatamente como antes.
      // ⚠ Esconder errava barato (some uma aba); despachar erra caro (mostra a apuração de outro
      // regime). Por isso a leitura virou regra com teste próprio, e não um `if` aqui.
      { key: "cadastroFiscal", label: "Apuração" },
      { key: "guides", label: "Guias" },
      { key: "sitfis", label: "Situação Fiscal" },
      // ⚠⚠ `emissaoNfse` NÃO ENTRA AQUI — e a ausência é decisão, não esquecimento (dono,
      // 19/08/2026, no mesmo dia em que a aba nasceu):
      //
      //   > *"a aba nova que criei no fiscal de emissão de NFS-e deve ser uma engrenagem de
      //   > configuração na aba Notas Fiscais."*
      //
      // A TELA continua existindo, na MESMA rota (`/companies/:id/emissao-nfse`): o que mudou foi
      // a ENTRADA — hoje é a engrenagem no topo da aba Notas Fiscais
      // (`features/notas/components/renderNotasFiscaisTab.jsx`), que é onde o contador está quando
      // pensa em configurar emissão. Por isso o par em `SEGMENT_TO_TAB`/`TAB_TO_SEGMENT` e o bloco
      // `if` da página FICARAM: sem eles a URL cairia em Anotações em silêncio e todo link já
      // guardado morreria. ⚠ Devolver a entrada para cá é criar DUAS portas para a mesma tela.
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
      // ⚠ VEIO DE DENTRO DA APURAÇÃO em 24/08/2026, a pedido do dono ("muitas abas"). Lá ela era a
      // seção "Perfil fiscal", um TERCEIRO nível de navegação sem URL. É cadastro — atividades
      // permitidas por CNAE, anexo e ISS —, não o trabalho do mês, e por isso mora ao lado da ficha.
      //
      // ⚠ Continua `soApuraSimples`, exatamente como era: o painel resolve ANEXO DO SIMPLES por
      // CNAE, e oferecê-lo ao Lucro Presumido mostraria uma tela que não decide nada para ele — o
      // mesmo argumento que já tirou o espelho da DEFIS do Presumido.
      //
      // ⚠ Fora de `TABS_COM_COMPETENCIA` de propósito: atividade permitida é cadastro da empresa,
      // não do mês. Um seletor de competência aqui sugeriria que a lista muda por competência.
      { key: "perfilFiscal", label: "Perfil fiscal", soApuraSimples: true },
      { key: "documentos", label: "Documentos" },
      // Cofre de senhas + "outras informações". Fica em Empresa, ao lado de Documentos, porque é
      // dado CADASTRAL (onde o escritório entra em nome do cliente), não trabalho do mês — e é
      // onde o contador já procura dado de empresa. NÃO tem competência: fora de
      // TABS_COM_COMPETENCIA de propósito.
      { key: "credenciais", label: "Senhas e acessos" },
    ],
  },
];


// Abas que não são sub-aba de ninguém, mas pertencem a um grupo (o grupo fica destacado).
// `edit` abre pela ficha (botão Editar) e `planoContas` por Lançamentos → Configurações.
// ⚠ `emissaoNfse` entra AQUI, e não em `GROUPS`: ela é uma tela do grupo Fiscal que se abre pela
// ENGRENAGEM da aba Notas Fiscais (dono, 19/08/2026), como `edit` se abre pelo botão Editar da
// ficha e `planoContas` por Lançamentos → Configurações. Sem esta linha o header cairia no primeiro
// grupo (Anotações) enquanto a tela de configuração estivesse aberta — o menu apontando para um
// lugar e a tela mostrando outro.
const TAB_TO_GROUP = { edit: "cadastro", planoContas: "contabilidade", emissaoNfse: "fiscal" };

// ⚠⚠ `isSimplesCompany` SAIU DAQUI EM 27/08/2026 e virou `mostraApuracaoDoSimples`, em
// `features/apuracao-lp/lib/regimeDaAba.js` — regra pura, com teste próprio e AMARRADA ao backend.
//
// O que ela fazia de errado, e que não importava enquanto só escondia uma aba: comparava
// `=== "SIMPLES"` EXATO. A `Company` grava `SIMPLES` e o `CadastroFiscal` grava `SIMPLES_NACIONAL`
// — a MESMA empresa tinha dois regimes conforme a fonte lida. Agora que o regime escolhe QUAL TELA
// renderiza, isso passaria a mostrar a apuração do regime errado.
//
// ⚠ O que NÃO mudou, de propósito: empresa sem regime continua no ramo do Simples (era
// `if (!regime) return true`). E `soApuraSimples` continua existindo — hoje só o "Perfil fiscal" o
// usa, e lá o motivo é outro (aquele painel resolve ANEXO DO SIMPLES).

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
  const simples = mostraApuracaoDoSimples(company);
  // O id da empresa é o mesmo que está na URL (`selectedCompany` é achado por `companyId`), então
  // o `href` de cada aba é literalmente a URL para onde o clique navega.
  const companyId = company?.companyId;
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
      {/* Voltar fica FORA da barra (pílula), à esquerda — a posição não mudou.
          ⚠ O que mudou: era só a seta, num quadrado de 40×40 com raio 12. O resto do app usava
          "← Voltar" numa pílula de 33px com raio 14, e a seta sozinha aqui obrigava a reaprender
          onde é a saída ao entrar na empresa. Agora é o mesmo `BackButton` das outras 12 telas. */}
      <BackButton onClick={onBack} title="Voltar" />

      {/* Barra em pílula: nome da empresa + os 3 grupos juntos. */}
      <div className="company-topbar">
        <div className="company-topbar__brand">
          <strong className="company-topbar__name">{company?.razao || "Empresa"}</strong>
          <span className="company-topbar__cnpj">{company?.cnpj || "CNPJ não informado"}</span>
        </div>
        {/* Nível 1 — grupos. `pill={false}`: já está dentro da pílula do topbar; uma segunda
            faixa arredondada aqui viraria pílula dentro de pílula. */}
        <Tabs
          className="company-topbar__nav"
          items={groups.map((group) => ({
            key: group.key,
            label: group.label,
            disabled: Boolean(group.requiresEdit && !canEditCompany),
            title: group.requiresEdit && !canEditCompany ? "Apenas admin ou contador pode editar." : undefined,
            /* ⚠ O `href` do GRUPO é o da sua 1ª sub-aba — exatamente o destino do `onChange` logo
               abaixo (`grupo.tabs[0].key`). Se os dois saíssem de lugares diferentes, o Ctrl+clique
               num grupo abriria uma aba e o clique normal outra. */
            href: companyTabPath(companyId, group.tabs[0]?.key),
          }))}
          active={activeGroup.key}
          onChange={(key) => {
            const grupo = groups.find((g) => g.key === key);
            if (grupo) onTabChange(grupo.tabs[0].key);
          }}
          ariaLabel="Grupos da empresa"
          pill={false}
          size="lg"
        />

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
        <div className="company-section-header__subtabs">
          <Tabs
            /* Cada sub-aba leva a URL da SUA rota — é o que faz o Ctrl+clique abrir aquela aba
               numa guia nova em vez de reabrir a empresa na aba de entrada. */
            items={subTabs.map((tab) => ({ ...tab, href: companyTabPath(companyId, tab.key) }))}
            active={activeTab}
            onChange={onTabChange}
            ariaLabel={`Seções de ${activeGroup.label}`}
          />
        </div>
      )}
    </header>
  );
}
