// A SITUAÇÃO FISCAL, NA TELA DO CLIENTE.
//
// Pedido do dono (21/08/2026): *"um símbolo de situação fiscal, onde mostraremos a tabela da
// situação fiscal ao cliente"*.
//
// ⚠⚠ ESTA TELA NÃO CONSULTA NADA, E ISSO NÃO É OMISSÃO — É O DESENHO. A consulta ao SERPRO é PAGA e
// o limite AV02 do `/Apoiar` é **por CONTRATANTE**: uma consulta à toa de UMA empresa consome o
// limite da carteira inteira do escritório. Quem consulta é o contador, na tela dele. Aqui se lê o
// relatório que ele já salvou. **Não acrescente um botão de consultar.**
//
// ⚠⚠ E NUNCA CONSULTADA NÃO É "EM DIA". É a regra que decide esta tela inteira, e ela vive em
// `lib/situacaoFiscalNaTela.js`, com teste: `null`, ausência e estado desconhecido caem todos em
// "não consultada". Afirmar regularidade perante o fisco sem ter consultado é o erro caro — o
// cliente deixa de correr atrás de uma pendência que existe.
//
// ⚠ A DATA VIAJA JUNTO DO ESTADO, sempre. "Sem pendências" sem dizer DE QUANDO é uma afirmação
// sobre hoje que ninguém apurou hoje.

import { api } from "../../api";
import { AlertaErro, Carregando, Vazio } from "../../components/ui";
import { useCarregamento } from "../../lib/hooks";
import { fmtDataHora } from "../../lib/format";
import { isAdminOrAbove } from "../../lib/roles";
import { RelatorioSitfis } from "./RelatorioSitfis";
import { SITUACAO, situacaoNaTela } from "./lib/situacaoFiscalNaTela";

export function SituacaoFiscalPage({ empresa }) {
  const companyId = empresa?.companyId;

  // ⚠⚠ O PISO É `CLIENT_ADMIN`, E QUEM AUTORIZA CONTINUA SENDO O SERVIDOR (403
  // `insufficient_role`). Isto aqui existe para a tela não pedir o que já se sabe que será
  // recusado — mesmo papel do `portaoEmissao`. O relatório do SITFIS não é só dívida: o texto traz
  // os dados cadastrais e o QUADRO SOCIETÁRIO com o percentual de cada sócio, e o piso escrito
  // deste projeto para dado de sócio é `CLIENT_ADMIN` (`requireClientCompanyAccess.js`).
  // ⚠ A aba NÃO some: uma aba que aparece e some conforme a empresa deixa a barra instável, e o
  // conserto (pedir o papel a quem administra) precisa estar escrito em algum lugar. Fica a tela,
  // com o motivo e a saída.
  const podeVer = isAdminOrAbove(empresa?.myRole);

  const { dados, carregando, erro, recarregar } = useCarregamento(
    () => api.getSituacaoFiscal(companyId),
    [companyId],
    { habilitado: Boolean(companyId) && podeVer },
  );

  const { status, rotulo } = situacaoNaTela(dados?.situacao);
  const apurada = dados?.ultimoRelatorioEm || dados?.checkedAt || null;

  return (
    /* ⚠ FRAGMENTO, como as outras telas — e o `<section className="page">` que estava aqui era
       DUAS coisas erradas de uma vez. Primeira: o seletor no `app.css` é `main.page` (ELEMENTO +
       classe), então a classe sozinha não estilizava nada. Segunda, e a que se via: o `<section>`
       virava filho ÚNICO do `main.page`, e os blocos de dentro perdiam o `gap` que separa tudo nas
       outras páginas — o título encostava no card de estado. */
    <>
      <div className="page-header">
        {/* ⚠ `<h1>`, como as outras oito telas do app. Esta era a única em `<h2>`: quem navega por
            cabeçalho no leitor de tela não achava o título da página, e a hierarquia pulava de nada
            para H2 com os H3 dos órgãos abaixo. */}
        <h1>Situação fiscal</h1>
      </div>

      {!podeVer ? (
        <div className="alerta alerta-info">
          <strong>Esta tela é de quem administra a empresa.</strong> O relatório da situação fiscal
          traz os dados cadastrais e a participação dos sócios. Peça acesso de administrador a quem
          é proprietário da empresa neste portal.
        </div>
      ) : null}

      {podeVer && carregando ? <Carregando /> : null}

      <AlertaErro
        erro={erro}
        padrao="Não foi possível ler a situação fiscal."
        aoTentarNovamente={recarregar}
      />

      {podeVer && !carregando && !erro && dados ? (
        <>
          <div className="card">
            <p className="situacao-fiscal-estado" data-situacao-fiscal={status}>
              {rotulo}
            </p>
            {/* ⚠ Só duas frases de apoio, e as duas existem por (a) ou (c) do critério desta casa:
                a data impede a afirmação de valer para hoje, e a pendência diz o que fazer — que é
                a única saída que o cliente tem daqui. */}
            {apurada ? (
              <p className="meta">Conferido pelo seu contador em {fmtDataHora(apurada)}.</p>
            ) : null}
            {status === SITUACAO.NAO_CONSULTADA ? (
              <p className="meta">
                Isto não quer dizer que está tudo certo nem que há algo errado — quer dizer que a
                consulta ainda não foi feita. Fale com o seu contador.
              </p>
            ) : null}
            {status === SITUACAO.COM_PENDENCIA || status === SITUACAO.EM_PARCELAMENTO ? (
              <p className="meta">Fale com o seu contador sobre o que aparece abaixo.</p>
            ) : null}
          </div>

          {dados.relatorio ? (
            <RelatorioSitfis relatorio={dados.relatorio} />
          ) : status === SITUACAO.NAO_CONSULTADA ? null : (
            // Estado conhecido SEM relatório guardado: nunca uma tabela vazia sem explicação.
            <Vazio>O relatório desta consulta não ficou guardado. Fale com o seu contador.</Vazio>
          )}
        </>
      ) : null}
    </>
  );
}
