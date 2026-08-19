import { useMemo, useState } from "react";
import { api } from "../../api";
import { limparSessao, lerEmpresaSalva, salvarEmpresa } from "../../api/sessionStore";
import { AlertaErro, Carregando, Vazio } from "../../components/ui";
import { useCarregamento, useRota } from "../../lib/hooks";
import { fmtCnpj, texto } from "../../lib/format";
import { roleLabel } from "../../lib/roles";
import { SeletorEmpresa } from "./SeletorEmpresa";
import { HomePage } from "../home/HomePage";
import { NotasPage } from "../notas/NotasPage";
import { EmitirNotaPage } from "../emitir/EmitirNotaPage";
import { esquecerTodasAsDescricoes } from "../emitir/lib/descricoesRecentes";
import { GuiasPage } from "../guias/GuiasPage";

// ⚠⚠ A ABA "EMITIR" FOI REMOVIDA EM 19/08/2026 — pedido do dono: emitir virou um BOTÃO dentro de
// Notas. A remoção é INTEIRA: o item do menu (aqui), o destino de roteamento (`lib/hooks.js`) e o
// estado. Meia remoção — tirar do menu e deixar a rota de pé — é o "filtro fantasma": um link
// antigo para `#/emitir` levaria a uma tela sem nenhuma saída visível.
//
// ⚠ O QUE NÃO SE PERDEU COM ISSO. A emissão continua ALCANÇÁVEL POR QUEM NÃO PODE EMITIR: o botão
// em Notas aparece sempre, e a tela do outro lado explica qual guarda está fechada e o que fazer.
// Era essa a razão de a aba aparecer sempre, e ela vale igual para o botão — escondê-lo deixaria o
// cliente sem saber que a emissão existe e que ela depende de um clique do contador.
const ABAS = [
  { chave: "home", rotulo: "Início" },
  { chave: "notas", rotulo: "Notas" },
  { chave: "guias", rotulo: "Guias" },
];

export function AppShell({ user }) {
  const { rota, navegar } = useRota();
  const [empresaEscolhida, setEmpresaEscolhida] = useState(() => lerEmpresaSalva());
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [saindo, setSaindo] = useState(false);
  // ⚠ O MODELO DE EMISSÃO ATRAVESSA DUAS TELAS, e é por isso que ele mora aqui: quem escolhe a nota
  // é a lista (`NotasPage`), quem preenche o formulário é a emissão (`EmitirNotaPage`), e entre as
  // duas só existe a navegação por hash — que não carrega objeto. Guardá-lo dentro de qualquer uma
  // delas o perderia na troca de rota, porque a casca só monta a tela ativa.
  const [modeloEmissao, setModeloEmissao] = useState(null);
  // ⚠ A EMISSÃO É UM MODO DA TELA DE NOTAS, não mais uma rota. Este booleano é o que substituiu
  // `rota === "emitir"`. Ele mora aqui, e não dentro da `NotasPage`, pelo mesmo motivo do modelo:
  // a casca é quem monta a tela ativa, e é ela que precisa decidir entre a lista e o formulário.
  const [emissaoAberta, setEmissaoAberta] = useState(false);

  const empresasQuery = useCarregamento(() => api.getCompanies(), []);
  const empresas = empresasQuery.dados || [];

  // Empresa ativa: a escolhida, se ainda for válida; senão a `defaultClientId`
  // do login; senão a primeira. ⚠ A validação contra a lista importa: um id
  // salvo de um acesso anterior (ou de outro usuário na mesma máquina) não pode
  // sobreviver à troca de conta.
  const empresaAtiva = useMemo(() => {
    if (!empresas.length) return null;
    return (
      empresas.find((e) => e.companyId === empresaEscolhida) ||
      empresas.find((e) => e.companyId === user?.defaultClientId) ||
      empresas[0]
    );
  }, [empresas, empresaEscolhida, user?.defaultClientId]);

  function escolherEmpresa(companyId) {
    setEmpresaEscolhida(companyId);
    salvarEmpresa(companyId);
    setSeletorAberto(false);
    // ⚠⚠ TROCAR DE EMPRESA DESCARTA O MODELO. Ele foi tirado da nota de OUTRA empresa; aplicá-lo
    // aqui emitiria no CNPJ errado. É a mesma razão pela qual a `EmitirNotaPage` zera o formulário
    // inteiro na troca — e ela ainda confere o `companyId` do modelo antes de aplicar, porque uma
    // guarda só do lado de quem envia não é guarda.
    setModeloEmissao(null);
  }

  /**
   * ⚠ SAIR DE NOTAS FECHA A EMISSÃO — e isso REPRODUZ o comportamento de antes, não muda nada.
   * Enquanto "emitir" era rota, trocar de aba DESMONTAVA a `EmitirNotaPage` e o formulário meio
   * preenchido já se perdia. Mantê-lo aberto por trás de outra aba seria um comportamento NOVO,
   * que ninguém pediu — e faria o clique em "Notas" cair num formulário, e não na lista que o
   * rótulo promete.
   */
  function irPara(destino) {
    setEmissaoAberta(false);
    navegar(destino);
  }

  /** Abre a emissão em branco — o botão "Emitir nota" da lista. */
  function abrirEmissao() {
    setModeloEmissao(null);
    setEmissaoAberta(true);
  }

  /**
   * A nota escolhida na lista vira o ponto de partida da emissão.
   *
   * ⚠ ISTO NÃO NAVEGA MAIS. Antes era `navegar("emitir")`; hoje a lista e o formulário são a MESMA
   * rota, e o que muda é o modo. O modelo continua vivendo na casca porque continua atravessando
   * duas telas — só que agora as duas telas são dois estados de uma rota só.
   */
  function reaproveitarNota(modelo) {
    if (!modelo) return;
    setModeloEmissao(modelo);
    setEmissaoAberta(true);
  }

  /** Volta da emissão para a lista, sem sair da rota. */
  function fecharEmissao() {
    setEmissaoAberta(false);
    setModeloEmissao(null);
  }

  async function sair() {
    if (saindo) return;
    setSaindo(true);
    try {
      await api.logout();
    } finally {
      // A sessão local some mesmo se o servidor não responder: "Sair" que não
      // sai é pior que erro visível, sobretudo em computador compartilhado.
      salvarEmpresa(null);
      // ⚠ E o histórico de descrições vai junto: ele guarda nome e CNPJ de tomadores. Pelo mesmo
      // motivo do resto desta linha — computador compartilhado. Ver `emitir/lib/descricoesRecentes.js`.
      esquecerTodasAsDescricoes();
      limparSessao();
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Portal do Cliente</span>

        <div className="empresa">
          {empresaAtiva ? (
            <>
              <div className="empresa-nome" title={texto(empresaAtiva.razao)}>
                {texto(empresaAtiva.razao)}
              </div>
              <div className="empresa-cnpj">
                {fmtCnpj(empresaAtiva.cnpj)}
                {empresaAtiva.myRole ? ` · ${roleLabel(empresaAtiva.myRole)}` : ""}
              </div>
            </>
          ) : (
            <div className="empresa-cnpj">{empresasQuery.carregando ? "Carregando empresas…" : ""}</div>
          )}
        </div>

        <div className="topbar-actions">
          {empresas.length > 1 ? (
            <button type="button" className="btn" onClick={() => setSeletorAberto(true)}>
              Trocar empresa
            </button>
          ) : null}
          <button type="button" className="btn" onClick={sair} disabled={saindo}>
            {saindo ? "Saindo…" : "Sair"}
          </button>
        </div>
      </header>

      <nav className="nav" aria-label="Seções">
        {ABAS.map((aba) => (
          <button
            key={aba.chave}
            type="button"
            aria-current={rota === aba.chave ? "page" : undefined}
            onClick={() => irPara(aba.chave)}
          >
            {aba.rotulo}
          </button>
        ))}
      </nav>

      <main className="page">
        {empresasQuery.carregando ? (
          <Carregando>Carregando suas empresas…</Carregando>
        ) : empresasQuery.erro ? (
          <AlertaErro
            erro={empresasQuery.erro}
            padrao="Não foi possível carregar suas empresas."
            aoTentarNovamente={empresasQuery.recarregar}
          />
        ) : !empresaAtiva ? (
          <Vazio>
            Nenhuma empresa está vinculada ao seu acesso. Fale com o seu contador para liberar.
          </Vazio>
        ) : rota === "notas" ? (
          // ⚠ UMA ROTA, DOIS MODOS. `emissaoAberta` é o que sobrou de `rota === "emitir"`.
          emissaoAberta ? (
            <EmitirNotaPage
              empresa={empresaAtiva}
              // ⚠ O PROP MUDOU DE NOME PORQUE MUDOU DE NATUREZA. Era `aoNavegar`, e a única coisa
              // que a emissão jamais fez com ele foi `aoNavegar("notas")` — ou seja, voltar. Hoje
              // isso não é navegação, é fechar um modo; um nome que dissesse "navegar" mentiria.
              aoVoltarParaNotas={fecharEmissao}
              modelo={modeloEmissao}
              aoDescartarModelo={() => setModeloEmissao(null)}
              // ⚠ Recarregar as EMPRESAS, não a tela: o estado do portão (`emissaoNfseLiberada`)
              // vem de `GET /client/companies`, então quem está no ramo "não recebemos o estado" só
              // sai dele refazendo essa chamada.
              aoRecarregarEmpresas={empresasQuery.recarregar}
            />
          ) : (
            <NotasPage
              empresa={empresaAtiva}
              aoReaproveitar={reaproveitarNota}
              aoEmitir={abrirEmissao}
            />
          )
        ) : rota === "guias" ? (
          <GuiasPage empresa={empresaAtiva} />
        ) : (
          <HomePage empresa={empresaAtiva} aoNavegar={irPara} />
        )}
      </main>

      {seletorAberto ? (
        <SeletorEmpresa
          empresas={empresas}
          ativaId={empresaAtiva?.companyId || null}
          aoEscolher={escolherEmpresa}
          aoFechar={() => setSeletorAberto(false)}
        />
      ) : null}
    </div>
  );
}
