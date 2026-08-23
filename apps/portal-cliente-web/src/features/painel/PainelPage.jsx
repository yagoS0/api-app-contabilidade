import { api } from "../../api";
import { AlertaErro, CardNumero, Carregando, Vazio } from "../../components/ui";
import { useCarregamento } from "../../lib/hooks";
import { chipDaGuia } from "../guias/GuiasPage";
import { BlocoDeDemonstracao } from "./BlocoDeDemonstracao";
import {
  TRACO,
  brl,
  competenciaPadrao,
  competenciasRecentes,
  fmtCompetencia,
  fmtDateBr,
  inteiro,
  pct,
  somaOuTraco,
} from "../../lib/format";

const OPCOES_COMPETENCIA = competenciasRecentes(12);

/**
 * O PAINEL — a tela padrão do portal do cliente (21/08/2026).
 *
 * Duas metades, e a fronteira entre elas é a coisa mais importante desta tela:
 *
 *  1. **O bloco de demonstração** (fluxo de caixa ⇄ DRE) — números FICTÍCIOS, com selo próprio.
 *  2. **O resumo do mês e os próximos vencimentos** — dado REAL, montado só com o que as rotas já
 *     devolvem: faturamento e nº de notas (`summary` de `GET /invoices`), alíquota do mês
 *     (`GET /aliquotas`) e o que está a vencer (`GET /fluxo`, as guias liberadas em aberto).
 *
 * ⚠⚠ NENHUM NÚMERO ATRAVESSA A FRONTEira. A saída fictícia do bloco de cima **não é somada nem
 * comparada** com o "A vencer" real — se os dois discordassem, a tela discordaria de si mesma no
 * número que o cliente usa para se planejar. E o selo fica NO BLOCO, nunca na página: na página,
 * ele faria o cliente ler os números verdadeiros como fictícios também, que é o defeito inverso e
 * igualmente caro.
 *
 * ⚠ UM SÓ CONTROLE DE COMPETÊNCIA nesta tela. Duas metades com recortes de tempo diferentes seriam
 * o mesmo defeito que a casca já consertou (três seletores para uma pergunta) — e há teste que
 * quebra por ambiguidade se aparecer um segundo rótulo "Competência".
 */
export function PainelPage({ empresa, competencia: competenciaDaCasca, aoTrocarCompetencia, aoNavegar }) {
  // ⚠⚠ A COMPETÊNCIA VEM DA CASCA — ver o comentário longo em `AppShell.jsx`. Era um
  // `useState(competenciaPadrao)` daqui, gêmeo do de `NotasPage`, e as duas abas discordavam.
  // O default não mudou: `competenciaPadrao` é o mês CORRENTE (dono, 18/08/2026).
  //
  // ⚠ "TODAS" (string vazia) É CONCEITO DE NOTAS, NÃO DAQUI. O resumo do mês precisa de UM mês;
  // com o filtro em "Todas", o Início cai no mês corrente — e não esconde isso: os rótulos dos
  // três cards e o texto de carregamento nomeiam a competência que estão mostrando, como já
  // faziam. O que não pode acontecer é o Início somar "o período todo" e chamar de mês.
  const competencia = competenciaDaCasca || competenciaPadrao();
  const setCompetencia = aoTrocarCompetencia || (() => {});
  const companyId = empresa.companyId;

  // limit:1 — aqui só interessa o `summary`, que o backend calcula sobre o
  // filtro inteiro (não sobre a página). Trazer 25 notas para descartá-las
  // seria pedir dado que ninguém vai mostrar.
  const notasQuery = useCarregamento(
    () => api.getInvoices(companyId, { competencia, page: 1, limit: 1 }),
    [companyId, competencia]
  );
  const aliquotaQuery = useCarregamento(
    () => api.getAliquotas(companyId, { from: competencia, to: competencia }),
    [companyId, competencia]
  );
  const fluxoQuery = useCarregamento(() => api.getFluxo(companyId), [companyId]);

  const resumo = notasQuery.dados?.summary || null;
  const aliquota = aliquotaQuery.dados?.[0] || null;
  const fluxo = fluxoQuery.dados || null;
  const proximos = (fluxo?.data || []).slice(0, 5);
  const vencidas = (fluxo?.data || []).filter((i) => i.vencida).length;

  // ⚠⚠ ESTE CARD USA `efetiva` (impostos PAGOS ÷ faturamento, **INSS incluso**) DE PROPÓSITO, e a
  // nota fiscal usa a OUTRA conta da mesma rota (`deReceita`, só o DAS). Não são duas leituras do
  // mesmo número: são duas perguntas. Decisão do dono, 18/08/2026 — *"no painel isso está correto,
  // pois ali temos a alíquota efetiva total, com todos os impostos; no caso da nota precisamos
  // preencher apenas com a alíquota do Simples Nacional."*
  //   • aqui, PAINEL: *quanto esta empresa paga de imposto?* ⇒ tudo. É gestão.
  //   • na emissão: *quanto desta nota é tributo do Simples?* ⇒ só o DAS, porque `pTotTribSN` é
  //     "total de tributos do SIMPLES NACIONAL" e vai impresso ao tomador (Lei 12.741/2012).
  // ⚠ NÃO alinhe as duas. O porquê, com os números medidos em produção, está em
  // `features/emitir/lib/aliquotaEfetiva.js`.
  //
  // ⚠ A alíquota efetiva do backend é `impostosPagos / faturamento`, com
  // `d > 0 ? n/d*100 : 0`. Os DOIS lados fabricam zero:
  //  - sem faturamento, o denominador some e a conta devolve 0;
  //  - sem guia paga, o numerador é a soma de zero linhas e devolve 0.
  // Em ambos os casos a tela leria "sua alíquota é 0%", que é uma afirmação
  // fiscal que ninguém fez. O certo é traço + o motivo.
  const faturamentoDoMes = aliquota ? Number(aliquota.faturamento) : null;
  const impostosDoMes = aliquota ? Number(aliquota.impostosPagos) : null;
  const semFaturamento = aliquota ? !(faturamentoDoMes > 0) : false;
  const semImpostoPago = aliquota ? !(impostosDoMes > 0) : false;
  const efetivaCalculavel = Boolean(aliquota) && !semFaturamento && !semImpostoPago;

  const carregando = notasQuery.carregando || aliquotaQuery.carregando;
  const erro = notasQuery.erro || aliquotaQuery.erro;

  return (
    <>
      <div className="page-header">
        <h1>Início</h1>
        <div className="page-actions">
          <label htmlFor="competencia-home" className="sr-only">
            Competência
          </label>
          <select
            id="competencia-home"
            disabled={!aoTrocarCompetencia}
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="select-auto"
          >
            {OPCOES_COMPETENCIA.map((c) => (
              <option key={c} value={c}>
                {fmtCompetencia(c)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <AlertaErro
        erro={erro}
        padrao="Não foi possível carregar o resumo do mês."
        aoTentarNovamente={() => {
          notasQuery.recarregar();
          aliquotaQuery.recarregar();
        }}
      />

      {carregando ? (
        <Carregando>Carregando o resumo de {fmtCompetencia(competencia)}…</Carregando>
      ) : (
        <div className="grid-3">
          <CardNumero
            rotulo={`Faturamento · ${fmtCompetencia(competencia)}`}
            valor={resumo ? somaOuTraco(resumo.totalAmount) : TRACO}
            apoio={
              resumo
                ? `${inteiro(resumo.totalInvoices)} nota(s) emitida(s)`
                : "Sem dados para esta competência"
            }
            destaque
          />

          <CardNumero
            rotulo={`Alíquota efetiva · ${fmtCompetencia(competencia)}`}
            valor={efetivaCalculavel ? pct(aliquota.efetiva) : TRACO}
            apoio={
              !aliquota
                ? "Sem dados para esta competência"
                : semFaturamento
                  ? "Não há faturamento nesta competência — sem base para calcular"
                  : semImpostoPago
                    ? "Nenhuma guia paga nesta competência ainda"
                    : `Impostos pagos ${somaOuTraco(aliquota.impostosPagos)} sobre ${somaOuTraco(aliquota.faturamento)}`
            }
          />

          <CardNumero
            rotulo="A vencer"
            valor={fluxoQuery.carregando ? "…" : somaOuTraco(fluxo?.total)}
            apoio={
              fluxoQuery.carregando
                ? "Carregando…"
                : vencidas > 0
                  ? `${inteiro(vencidas)} guia(s) já vencida(s)`
                  : "Guias liberadas ainda em aberto"
            }
          />
        </div>
      )}

      <div className="card">
        {/* ⚠ `.card-header`, não `.page-header`: um é o cabeçalho da PÁGINA, o outro o de uma
            SEÇÃO dentro de um card. A mesma classe nos dois papéis vinha com um `style` corrigindo
            a margem — o sinal de que eram duas coisas com um nome só. */}
        <div className="card-header">
          <h2>Próximos vencimentos</h2>
          <div className="page-actions">
            <button type="button" className="btn-link" onClick={() => aoNavegar("guias")}>
              Ver todas as guias
            </button>
          </div>
        </div>

        {fluxoQuery.carregando ? (
          <Carregando />
        ) : fluxoQuery.erro ? (
          <AlertaErro
            erro={fluxoQuery.erro}
            padrao="Não foi possível carregar os vencimentos."
            aoTentarNovamente={fluxoQuery.recarregar}
          />
        ) : proximos.length === 0 ? (
          <Vazio>Nenhuma guia em aberto no momento.</Vazio>
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: "520px" }}>
              <thead>
                <tr>
                  <th scope="col">Guia</th>
                  <th scope="col">Competência</th>
                  <th scope="col">Vencimento</th>
                  <th scope="col" className="num">
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody>
                {proximos.map((item) => (
                  <tr key={item.id}>
                    <td>{item.tipo}</td>
                    <td>{fmtCompetencia(item.competencia)}</td>
                    <td>
                      {fmtDateBr(item.vencimento)}
                      {/* ⚠ O `data-status` SAI DO MESMO MAPA da tela de Guias, não de uma string
                          cravada aqui. Era `data-status="rejeitada"` — vocabulário de NOTA numa
                          guia — e depois virou `"vencida"` à mão, que é um quarto valor solto: se
                          o mapa mudar, esta linha não muda junto e o chip perde a cor em silêncio.
                          É o defeito que o teste de `emissaoDoLote` já nomeia para as notas. */}
                      {item.vencida ? (
                        <span className="chip" data-status={chipDaGuia("OVERDUE").status} style={{ marginLeft: "6px" }}>
                          vencida
                        </span>
                      ) : null}
                    </td>
                    <td className="num">{brl(item.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ⚠⚠ O BLOCO DE DEMONSTRAÇÃO VEM POR ÚLTIMO — e ele veio PRIMEIRO até 23/08/2026. Pedido do
          dono: *"coloque próximos vencimentos acima da tabela do fluxo"*.

          ⚠ A troca é o que SOLTOU A ROLAGEM da tabela. Enquanto o bloco era o primeiro, os 31 dias
          empurravam o conteúdo REAL (os três cards e os vencimentos) para cerca de 1.200px abaixo
          da dobra, e a tabela precisava de rolagem própria para não fazer isso. Com tudo o que é
          real acima dela, a tabela pôde mostrar o mês inteiro — que foi a segunda metade do pedido:
          *"espaço abaixo o suficiente para que não precise rolar os dias"*.

          ⚠ E a fronteira continua nítida: tudo ACIMA deste bloco é dado da empresa. Ele é o único
          que não fala dela, e carrega o selo dizendo isso. */}
      <BlocoDeDemonstracao companyId={companyId} competencia={competencia} />
    </>
  );
}
