// O EXTRATO DO QUE ENTROU SEM NINGUÉM CLICAR — e o desfazer em lote (29/08/2026).
//
// ⚠⚠ **ESTE PAINEL É O PRÉ-REQUISITO QUE O PRÓPRIO `motorDeSugestao.js` NOMEOU**, antes de a
// automação existir: *"o que falta é a DECISÃO DO DONO de ligar, e o extrato mensal 'lançados por
// regra' para ele poder desfazer em lote."* Sem ele, ligar o lançamento automático é ligar algo que
// ninguém consegue auditar — o contador veria os lançamentos misturados no razão, sem saber quais
// nasceram sozinhos.
//
// ⚠ O critério do servidor é a ORIGEM do pagamento, nunca o `regraId`: um lançamento que o contador
// confirmou À MÃO sobre uma nota com regra também tem `regraId`, e oferecer "desfazer" sobre o
// trabalho dele seria o oposto do que este extrato existe para fazer.

import { useEffect, useState } from "react";
import { createApiClient } from "../../../api/client";
import { Button } from "../../../components/ui/Button";

const extratoApi = createApiClient();

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};

const brl = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
};

/** `"2026-08-15"` → `"15/08"`. ⚠ Sem `new Date`: a data é CIVIL e o construtor desloca o fuso. */
function diaBr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}` : "—";
}

export function PainelDeLancadosPorRegra({
  companyId, competencia, podeEscrever = true, aoDesfazer,
  /**
   * ⚠⚠ RECOLHIDO — decisão do dono, 01/09/2026 (*"devolva a aba pras regras"*).
   *
   * Ele volta para a seção «Regras» da Conferência, mas FECHADO: a tela já tem quase seis telas de
   * rolagem, e este bloco é CIÊNCIA (o que a automação já fez), não tarefa — ninguém está esperando
   * uma decisão dele. Aberto por padrão, empurraria para baixo o que pede ação.
   *
   * ⚠ `sumirQuandoVazio` foi retirado junto: existiu por algumas horas para a aba própria, onde
   * sumir deixaria a tela em branco. Sem a aba, prop que ninguém passa é código morto.
   */
  recolhido = false,
}) {
  const [estado, setEstado] = useState({ carregando: true, dados: null, indisponivel: false, erro: null });
  const [marcados, setMarcados] = useState(() => new Set());
  const [enviando, setEnviando] = useState(false);
  const [relatorio, setRelatorio] = useState(null);

  function carregar() {
    if (!companyId || !competencia || typeof extratoApi.getLancadosPorRegra !== "function") {
      setEstado({ carregando: false, dados: null, indisponivel: true, erro: null });
      return;
    }
    setEstado((e) => ({ ...e, carregando: true }));
    setMarcados(new Set());
    Promise.resolve(extratoApi.getLancadosPorRegra(companyId, competencia))
      .then((r) => setEstado({
        carregando: false,
        dados: r || null,
        indisponivel: r?.indisponivel === true,
        erro: null,
      }))
      .catch((e) => setEstado({ carregando: false, dados: null, indisponivel: false, erro: e }));
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId, competencia]);

  const linhas = Array.isArray(estado.dados?.linhas) ? estado.dados.linhas : [];

  // ⚠⚠ O PAINEL SOME QUANDO NÃO HÁ NADA. Com a automação desligada — que é o estado normal — um
  // bloco permanente dizendo "nenhum lançamento automático" ocuparia a tela para afirmar o óbvio.
  // Ele aparece exatamente quando há o que auditar.
  if (estado.carregando || estado.indisponivel || !linhas.length) return null;

  const alternar = (id) => setMarcados((s) => {
    const novo = new Set(s);
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    return novo;
  });

  async function desfazer() {
    setEnviando(true);
    setRelatorio(null);
    try {
      const r = await extratoApi.postDesfazerLancadosPorRegra(companyId, [...marcados]);
      // ⚠⚠ O RELATÓRIO APARECE SEMPRE, inclusive quando tudo deu certo — e principalmente quando
      // não deu: o lote NÃO PARA, e uma linha recusada (mês fechado) tem de ser dita. Um "pronto"
      // genérico faria a vigésima sumir sem ninguém saber por quê.
      setRelatorio(r || null);
      carregar();
      aoDesfazer?.();
    } catch (e) {
      setRelatorio({ erro: e?.body?.message || e?.message || "Não foi possível desfazer." });
    } finally {
      setEnviando(false);
    }
  }

  /**
   * ⚠⚠ O RESUMO É O MESMO NOS DOIS ENVELOPES — contagem, valor e quantos estão sem nota.
   *
   * Recolhido, ele é a ÚNICA coisa visível: um "Lançados por regra" mudo não diria se vale a pena
   * abrir, e o custo de abrir é justamente a rolagem que o recolhimento existe para poupar.
   */
  const resumo = (
    <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
      {linhas.length} {linhas.length === 1 ? "lançamento" : "lançamentos"} · {brl(estado.dados?.valor)}
      {/* ⚠ O número vem do SERVIDOR (`semNota`), não recontado aqui: duas contagens da mesma
          coisa divergem, e a que ninguém confere é a que erra. */}
      {estado.dados?.semNota ? (
        <span style={{ color: "var(--state-warn)" }}>
          {" "}· {estado.dados.semNota} sem nota
        </span>
      ) : null}
    </span>
  );

  /**
   * ⚠⚠ `<details>` É SEGURO AQUI, e não é em toda tela: a regra da casa manda abri-lo por
   * JAVASCRIPT antes de imprimir, porque o CSS sozinho não o faz. A Conferência **não é impressa**
   * — medido: zero `data-print-area` em `renderConferenciaTab.jsx`. Não há papel a proteger.
   */
  const Envelope = recolhido ? "details" : "div";

  return (
    <Envelope style={{ ...card, borderColor: "var(--state-warn)" }}>
      {recolhido ? (
        <summary style={{ cursor: "pointer", display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <strong>Lançados por regra · {estado.dados?.competencia || competencia}</strong>
          {resumo}
        </summary>
      ) : (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ flex: 1, margin: 0, font: "inherit", fontWeight: 700 }}>
            Lançados por regra · {estado.dados?.competencia || competencia}
          </h3>
          {resumo}
        </div>
      )}

      {/* ⚠⚠ A FRASE DIZ O QUE ACONTECEU, não o que o sistema fez de bom. É a tela em que o contador
          confere contabilidade que ele não escreveu. */}
      <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
        Estes lançamentos nasceram sozinhos, por regra, sem ninguém clicar. A data é presumida — o
        extrato do banco a corrige quando o débito real chegar.
      </p>

      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
              <th style={{ padding: "4px 8px" }}>
                <span className="sr-only">Selecionar</span>
              </th>
              {/* ⚠⚠ AS COLUNAS SÃO AS QUE O DONO PEDIU, nesta ordem — 01/09/2026: *"ali eles
                  ficam sempre com a data do lançamento, descrição vinda da nota ou OFX, descrição
                  do lançamento, valor"*. */}
              <th style={{ padding: "4px 8px" }}>Data do lançamento</th>
              <th style={{ padding: "4px 8px" }}>Descrição (nota ou extrato)</th>
              <th style={{ padding: "4px 8px" }}>Descrição do lançamento</th>
              <th style={{ padding: "4px 8px" }}>Conta</th>
              <th style={{ padding: "4px 8px", textAlign: "right" }}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "6px 8px" }}>
                  <input
                    type="checkbox"
                    checked={marcados.has(l.id)}
                    disabled={!podeEscrever || enviando}
                    /* ⚠⚠ O RÓTULO CARREGA VALOR E DATA, e não só o fornecedor — achado por teste.
                       O caso normal desta tela é a MESMA regra lançando o MESMO fornecedor várias
                       vezes no mês: com o nome sozinho, as duas caixas ficam indistinguíveis para
                       quem usa leitor de tela, e desfazer a linha errada apaga lançamento certo. */
                    aria-label={`Desfazer ${l.descricaoOriginal || l.id}, ${brl(l.valorAjustado ?? l.valor)}, ${diaBr(l.dataPagamento)}`}
                    onChange={() => alternar(l.id)}
                  />
                </td>
                {/* ⚠ A data do RAZÃO quando ela existe; a presumida quando o razão não foi
                    lido. Nunca as duas somadas — são afirmações diferentes. */}
                <td style={{ padding: "6px 8px" }}>{diaBr(l.dataDoLancamento || l.dataPagamento)}</td>
                <td style={{ padding: "6px 8px" }}>
                  {l.descricaoOriginal || "—"}
                  {/*
                    ⚠⚠ A PERGUNTA DO DONO NA LINHA: *"no caso de não ter uma nota comprovando a
                    ocorrência desse lançamento ela deve ser retirada"*.
                    ⚠ Âmbar, não vermelho: falta de nota não bloqueia fechamento nenhum — é uma
                    pendência a decidir, e vermelho aqui competiria com o que trava o mês.
                    ⚠ E o texto distingue as DUAS ausências: nunca houve documento (veio do extrato)
                    × houve e sumiu (a FK é `SetNull`).
                  */}
                  {!l.notaRecebidaId ? (
                    <div style={{ fontSize: 12, color: "var(--state-warn)" }}>sem nota comprovando</div>
                  ) : !l.notaRecebida ? (
                    <div style={{ fontSize: 12, color: "var(--state-warn)" }}>
                      a nota que comprovava não está mais na base
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                      {l.notaRecebida.tipo || l.notaRecebida.type || "nota"} {l.notaRecebida.numero}
                    </div>
                  )}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  {l.historicoDoLancamento || "—"}
                  {/* ⚠⚠ O LANÇAMENTO SUMIU DO RAZÃO — `accountingEntryId` não tem FK, então ele pode
                      apontar para linha apagada por fora. Sem isto a tela ofereceria "tirar" algo
                      que já não existe, e a recusa só apareceria no clique. */}
                  {l.lancamentoNoRazao === false ? (
                    <div style={{ fontSize: 12, color: "var(--state-warn)" }}>
                      não está mais no razão
                    </div>
                  ) : null}
                </td>
                <td style={{ padding: "6px 8px" }}>{l.contaAplicada || "—"}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  {brl(l.valorAjustado ?? l.valor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {podeEscrever ? (
        <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Button
            size="sm"
            variant="secondary"
            disabled={!marcados.size || enviando}
            onClick={desfazer}
          >
            {enviando ? "Desfazendo…" : `Desfazer ${marcados.size || ""}`.trim()}
          </Button>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Desfazer apaga o lançamento do razão e devolve a nota à fila.
          </span>
        </div>
      ) : null}

      {relatorio ? (
        <div role="status" style={{ marginTop: 12, fontSize: 13 }}>
          {relatorio.erro ? (
            <span style={{ color: "var(--state-danger)" }}>{relatorio.erro}</span>
          ) : (
            <>
              <div>{relatorio.desfeitos} de {relatorio.pedidos} desfeitos.</div>
              {/* ⚠⚠ O QUE FALHOU APARECE NOMEADO, um a um. É a metade do desfazer em lote que não
                  pode ser resumida: a linha em mês fechado precisa de outra ação. */}
              {(relatorio.recusados || []).map((r) => (
                <div key={r.id} style={{ color: "var(--state-warn)" }}>
                  {r.id}: {r.frase || r.motivo}
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}
    </Envelope>
  );
}
