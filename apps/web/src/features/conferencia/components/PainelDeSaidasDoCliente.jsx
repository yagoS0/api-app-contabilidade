// AS SAÍDAS QUE O CLIENTE ESCREVEU NO FLUXO DELE — a fila do contador (29/08/2026).
//
// > Dono: *"o cliente pode modificar as saídas, podendo colocar novas saídas, apenas para
// > visualização deles. E essas saídas que o cliente digitar aparecem para o contador na aba de
// > conferência."*
//
// ⚠⚠ **CONFIRMAR AQUI NÃO LANÇA NADA, e a distância é o ponto.** O que o cliente escreveu é uma
// PREVISÃO de caixa: ela já está no fluxo dele (a pendente entra, ver `FluxoDeCaixaService`), e o
// que esta decisão diz é se ela FICA. Lançar continua sendo o caminho do declarado, que exige
// `dataPagamento` porque afirma que o dinheiro saiu — a invariante nº 1 de `application/declarados/`.
//
// ⚠ Ela vive ao lado do `PainelDeRecorrencias`, com a MESMA forma (confirmar · recusar com motivo):
// duas filas na mesma tela com desenhos diferentes fariam a pessoa reaprender a decisão em cada uma.

import { useEffect, useState } from "react";
import { createApiClient } from "../../../api/client";

const saidasApi = createApiClient();

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};

/** `"2026-09-18"` → `"18/09/2026"`. ⚠ Sem `new Date`: a data é CIVIL e o construtor desloca o fuso. */
function dataBr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

const brl = (v) => {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";
};

export function PainelDeSaidasDoCliente({ companyId, podeEscrever = true, aoDecidir }) {
  const [estado, setEstado] = useState({ carregando: true, saidas: [], indisponivel: false, erro: null });
  const [recusando, setRecusando] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState(null);

  function carregar() {
    if (!companyId || typeof saidasApi.getConferenciaSaidasDoCliente !== "function") {
      setEstado({ carregando: false, saidas: [], indisponivel: true, erro: null });
      return;
    }
    setEstado((e) => ({ ...e, carregando: true }));
    saidasApi.getConferenciaSaidasDoCliente(companyId)
      .then((r) => setEstado({
        carregando: false,
        saidas: Array.isArray(r?.saidas) ? r.saidas : [],
        indisponivel: r?.indisponivel === true,
        erro: null,
      }))
      .catch((e) => setEstado({ carregando: false, saidas: [], indisponivel: false, erro: e }));
  }

  useEffect(carregar, [companyId]);

  async function decidir(saida, novoEstado) {
    setAviso(null);
    setEnviando(true);
    try {
      await saidasApi.postConferenciaSaidaDecidir(companyId, saida.id, {
        estado: novoEstado,
        motivoRecusa: novoEstado === "RECUSADA" ? motivo.trim() : null,
      });
      setRecusando(null);
      setMotivo("");
      carregar();
      // ⚠ O selo do botão de Conferência conta ESTA fila também — sem avisar quem o desenhou, o
      // número ficaria um a mais até a próxima abertura da aba.
      aoDecidir?.();
    } catch (e) {
      // ⚠ A frase do SERVIDOR vence: ela sabe distinguir "já decidida" de "não existe".
      setAviso(e?.corpo?.message || e?.message || "Não foi possível decidir.");
    } finally {
      setEnviando(false);
    }
  }

  // ⚠⚠ INDISPONÍVEL NÃO É "NADA PENDENTE". A migration é ato do dono, e um painel que sumisse aqui
  // faria o contador concluir que o cliente não escreveu nada — quando o que houve é que a tabela
  // não existe. É a mesma distinção que `nao_consultada` guarda na Situação Fiscal.
  if (estado.indisponivel) {
    return (
      <div style={{ ...card, display: "grid", gap: 6 }}>
        <strong style={{ fontSize: "0.92rem" }}>Saídas que o cliente acrescentou</strong>
        <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
          Não foi possível ler esta fila neste ambiente — a tabela ainda não existe neste banco.
          Isto é uma limitação do sistema, não uma afirmação sobre esta empresa.
        </span>
      </div>
    );
  }

  return (
    <div style={{ ...card, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <strong style={{ fontSize: "0.92rem" }}>Saídas que o cliente acrescentou</strong>
        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
          {/* ⚠ A frase é obrigatória: sem ela, a lista se parece com uma fila de lançamento, e o
              contador procuraria a conta contábil que não existe aqui. */}
          Confirmar aqui não lança nada — só diz se a previsão fica no fluxo do cliente.
        </span>
      </div>

      {estado.carregando ? (
        <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Carregando…</span>
      ) : null}

      {estado.erro ? (
        <span style={{ fontSize: "0.82rem", color: "var(--state-danger, #FF5555)" }}>
          Não foi possível carregar esta fila.
        </span>
      ) : null}

      {aviso ? (
        <span style={{ fontSize: "0.82rem", color: "var(--state-warn, #F1FA8C)" }}>{aviso}</span>
      ) : null}

      {!estado.carregando && !estado.erro && !estado.saidas.length ? (
        // ⚠ Vazio DIZ que está vazio. Um painel que some quando não há nada esconde que a fila
        // existe — e o contador não saberia que o cliente PODE escrever aqui.
        <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
          O cliente não acrescentou nenhuma saída ainda.
        </span>
      ) : null}

      {estado.saidas.map((s) => (
        <div
          key={s.id}
          data-saida-do-cliente={s.id}
          style={{
            display: "grid", gap: 8, paddingTop: 10,
            borderTop: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline" }}>
            <strong style={{ fontSize: "0.88rem" }}>{s.descricao}</strong>
            <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
              {dataBr(s.data)} · {brl(s.valor)}
            </span>
          </div>

          {podeEscrever ? (
            recusando === s.id ? (
              <div style={{ display: "grid", gap: 8 }}>
                {/* ⚠⚠ RECUSAR EXIGE MOTIVO — o servidor recusa sem ele, e o cliente precisa saber
                    por que a linha dele saiu do fluxo. É a mesma regra do declarado. */}
                <input
                  value={motivo}
                  onChange={(ev) => setMotivo(ev.target.value)}
                  placeholder="Por que esta saída não fica? (o cliente vai ler)"
                  style={{
                    padding: "8px 10px", borderRadius: 8, font: "inherit", fontSize: "0.82rem",
                    border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)",
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    disabled={enviando || !motivo.trim()}
                    onClick={() => decidir(s, "RECUSADA")}
                    style={{ padding: "6px 12px", borderRadius: 8, cursor: "pointer", font: "inherit", fontSize: "0.8rem" }}
                  >
                    Recusar
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRecusando(null); setMotivo(""); }}
                    style={{ padding: "6px 12px", borderRadius: 8, cursor: "pointer", font: "inherit", fontSize: "0.8rem" }}
                  >
                    Voltar
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={enviando}
                  onClick={() => decidir(s, "CONFIRMADA")}
                  style={{ padding: "6px 12px", borderRadius: 8, cursor: "pointer", font: "inherit", fontSize: "0.8rem" }}
                >
                  Confirmar
                </button>
                <button
                  type="button"
                  disabled={enviando}
                  onClick={() => { setRecusando(s.id); setMotivo(""); }}
                  style={{ padding: "6px 12px", borderRadius: 8, cursor: "pointer", font: "inherit", fontSize: "0.8rem" }}
                >
                  Recusar…
                </button>
              </div>
            )
          ) : (
            // ⚠ Sem permissão o botão não aparece, e o motivo é dito: o servidor recusaria com 403,
            // e um botão que sempre falha é pior que a ausência dele.
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              Só um contador da empresa pode decidir sobre esta saída.
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
