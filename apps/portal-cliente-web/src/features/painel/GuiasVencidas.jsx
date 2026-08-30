// A TABELA DE GUIAS EM ATRASO, ACIMA DO FLUXO (30/08/2026).
//
// > Dono: *"a parte que eu falei da tabela com as guias vencidas em cima do fluxo não aparece, ela
// > deve aparecer com duas linhas e meia caso tenha mais de 3 guias, para que o cliente saiba que
// > precisa rolar para ver mais."*
//
// ⚠⚠ **ELA NÃO SUBSTITUI O POP-UP, E AS DUAS COISAS RESPONDEM PERGUNTAS DIFERENTES.** O pop-up
// interrompe uma vez e se dispensa com "Estou ciente"; esta tabela **fica**, e é onde o cliente
// volta para ver quanto e quando. Sem ela, dispensado o pop-up, a guia vencida some do Início — que
// é o efeito que o corte do card "Próximos vencimentos" (28/08) deixou nomeado como perda.
//
// ⚠ **DUAS LINHAS E MEIA É LITERAL, E É O PRODUTO.** A meia linha é o que diz *"tem mais"* sem
// texto nenhum: barra de rolagem sozinha passa despercebida, e um "ver todas" esconde o volume. O
// corte só existe **acima de 3 guias** — com três, cortar a terceira pela metade inventaria uma
// rolagem que não existe.
//
// ⚠⚠ **ELA NÃO PAGA E NÃO DÁ CIÊNCIA.** Ciência é ato do pop-up (Lei 5: *ciência nunca significa
// pagamento*), e esta tabela é leitura. O único caminho que ela oferece é ir para as Guias.

import { fmtBRL, fmtDateBr } from "../../lib/format";

/** ⚠ Acima disto a lista é CORTADA na metade da terceira linha. Ver o cabeçalho. */
const GUIAS_ATE_ONDE_CABE = 3;

/**
 * ⚠ `venceu em` × `vence em` — o passado e o futuro não podem ser a mesma frase. A guia a vencer
 * também entra nesta lista (o alerta é de 5 dias de antecedência), e chamá-la de vencida seria
 * afirmar um atraso que não existe.
 */
function quando(g) {
  if (!g?.vencimento) return "sem data de vencimento";
  return `${g.atrasada ? "venceu" : "vence"} em ${fmtDateBr(g.vencimento)}`;
}

export function GuiasVencidas({ alerta, aoVerGuias }) {
  const itens = alerta?.itens || [];
  // ⚠ Sem guia em atraso a tabela NÃO aparece, e nada é dito: é o critério do dono para legenda —
  // frase que descreve uma ausência já visível é ruído. O que ela impede é o silêncio no caso
  // CONTRÁRIO, que é o que existe aqui.
  if (!itens.length) return null;

  const cortada = itens.length > GUIAS_ATE_ONDE_CABE;

  return (
    <section className="guias-atraso" aria-label="Guias em atraso">
      <div className="guias-atraso-topo">
        <h3>
          {itens.length === 1 ? "1 guia para pagar" : `${itens.length} guias para pagar`}
          <span className="guias-atraso-soma">{fmtBRL(alerta?.valor)}</span>
        </h3>
        <button type="button" className="btn btn-sm" onClick={() => aoVerGuias?.()}>
          Ver todas as guias
        </button>
      </div>

      {/*
        ⚠⚠ `data-cortada` É QUEM LIGA O CORTE, e ele é do CSS — não um `slice` no JSX. Cortar a
        lista em JavaScript tiraria as guias do DOM: quem rola não acharia nada, e quem usa leitor
        de tela nunca saberia que elas existem. O que se corta é a ALTURA, nunca o conteúdo.
      */}
      <div className="table-wrap guias-atraso-lista" data-cortada={cortada ? "sim" : undefined}>
        <table className="table table--guias-atraso">
          <caption className="sr-only">
            Guias vencidas ou a vencer nos próximos dias
            {cortada ? ` — role a lista para ver as ${itens.length}` : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col">Guia</th>
              <th scope="col">Quando</th>
              <th scope="col" className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((g) => (
              <tr key={g.id} data-atrasada={g.atrasada ? "sim" : undefined}>
                <th scope="row">
                  {g.rotulo || g.tipo}
                  {g.competencia ? <span className="guias-atraso-comp"> · {g.competencia}</span> : null}
                </th>
                {/* ⚠ A cor do atraso vai no TEXTO, não só na linha: em preto e branco a faixa some. */}
                <td className="guias-atraso-quando">{quando(g)}</td>
                <td className="num">{fmtBRL(g.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
