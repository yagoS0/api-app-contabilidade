// A ABA AUDITORIA — cinco perguntas sobre as notas do mês, respondidas antes de apurar.
//
// ⚠ ONDE ELA VIVE, E POR QUÊ: dentro da EMPRESA, no grupo Fiscal, entre "Notas Fiscais" e
// "Apuração". O dono chamou o pedido de *auditoria PRÉ-apuração* — é o passo imediatamente anterior
// ao fechamento, que acontece empresa a empresa e competência a competência. Três das cinco
// perguntas só existem nesse escopo: o cadastro de códigos é da empresa (`Company`), a numeração da
// DPS é por empresa+série, e a competência é o eixo do fechamento. Uma visão de carteira é um
// próximo passo natural (e reusaria `empresasVisiveis`, sem quarta leitura de escopo), mas o achado
// só é acionável aqui — é aqui que o contador abre a nota e decide.
//
// ⚠ ESTA TELA NÃO ESCREVE NADA. Não há botão de "marcar como conferido", "ignorar" ou "corrigir":
// a auditoria é leitura, e o backend não tem por onde gravar. Quem julga a nota é o contador, e o
// julgamento dele vira ação nas telas que já existem (a nota, a apuração, o cadastro).
//
// ⚠ E ELA NÃO REESCREVE A REGRA. Todo texto de pergunta vem do backend
// (`application/notas/auditoria/auditoriaNotas.js`, puro); o que é de tela — motivo em português,
// cor, ordem — vive em `notas/lib/auditoriaTela.js`, com teste próprio. O componente só liga os dois.

import { useCallback, useEffect, useState } from "react";
import { createApiClient } from "../../../api/client";
import { PANEL } from "./notasStyles";
import {
  leituraDaPergunta,
  leituraDoCabecalho,
  frasesDoAchado,
  ordenarPerguntas,
  FRASE_NOTA_NAO_AVALIADA,
} from "../lib/auditoriaTela";

// Mesmo padrão da aba de Notas Fiscais e do SITFIS: a aba recebe tudo por prop menos a chamada
// dela própria, e não há `api` no escopo do detalhe da empresa para esta rota.
const auditoriaApi = createApiClient();

const card = {
  background: PANEL.surface,
  border: `1px solid ${PANEL.border}`,
  borderRadius: 10,
  padding: 16,
};

function Selo({ token, icone, children }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 10px", borderRadius: 12,
      // ⚠ O par `-surface` do token, nunca `${cor}22` — concatenar hex quebra em silêncio assim que
      // a cor vira `var(--…)` (regra do `apps/web/CLAUDE.md`).
      background: `var(${token}-surface)`,
      color: `var(${token})`,
      border: `1px solid var(${token})`,
      fontSize: "0.78rem", fontWeight: 600, whiteSpace: "nowrap",
    }}>
      <span aria-hidden="true">{icone}</span> {children}
    </span>
  );
}

function BlocoDaPergunta({ pergunta }) {
  const leitura = leituraDaPergunta(pergunta);
  const achados = pergunta.achados || [];
  const naoAvaliadas = pergunta.naoAvaliadas || [];
  const [abertoAchados, setAbertoAchados] = useState(achados.length > 0 && achados.length <= 12);
  const [abertoIgnoradas, setAbertoIgnoradas] = useState(false);

  return (
    <div style={{ ...card, borderLeft: `3px solid var(${leitura.token})` }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: PANEL.text, fontWeight: 600, fontSize: "0.95rem" }}>{pergunta.titulo}</div>
          {/* A PERGUNTA fica à vista, não escondida num tooltip: é ela que diz o que está sendo
              olhado, e é ela que o contador precisa poder discordar. */}
          <div style={{ color: PANEL.muted, fontSize: "0.82rem", marginTop: 2 }}>{pergunta.pergunta}</div>
        </div>
        <Selo token={leitura.token} icone={leitura.icone}>{leitura.quantidade || ""}</Selo>
      </div>

      <div style={{ color: PANEL.text, fontSize: "0.85rem", marginTop: 10 }}>{leitura.resumo}</div>

      {pergunta.janela ? (
        <div style={{ color: PANEL.muted, fontSize: "0.78rem", marginTop: 4 }}>
          {/* ⚠ A JANELA APARECE. Numeração não é fato mensal, e sem dizer entre quais meses se
              olhou o "nenhum salto" seria uma promessa maior do que a conferência feita. */}
          Numeração conferida na série inteira, de {pergunta.janela.de} a {pergunta.janela.ate}.
          {(pergunta.series || []).map((s) => (
            <span key={s.serie}> · série {s.serie}: nº {s.de} a {s.ate} ({s.notas} notas)</span>
          ))}
        </div>
      ) : null}

      {achados.length ? (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setAbertoAchados((v) => !v)}
            style={{
              background: "transparent", border: "none", cursor: "pointer", padding: 0,
              color: PANEL.accent, fontSize: "0.82rem", fontWeight: 600,
            }}
          >
            {abertoAchados ? "▾" : "▸"} {achados.length} para conferir
          </button>
          {abertoAchados ? (
            <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
              {achados.map((a, i) => {
                const f = frasesDoAchado(a, pergunta);
                return (
                  <li key={a.notaId || `${pergunta.id}-${i}`} style={{
                    background: PANEL.field, border: `1px solid ${PANEL.border}`,
                    borderRadius: 8, padding: "8px 10px",
                  }}>
                    <div style={{ color: PANEL.text, fontSize: "0.83rem", fontWeight: 600 }}>{f.titulo}</div>
                    <div style={{ color: PANEL.muted, fontSize: "0.8rem", marginTop: 2 }}>{f.texto}</div>
                    {a.emissao ? (
                      <div style={{ color: PANEL.muted, fontSize: "0.75rem", marginTop: 2 }}>
                        emitida em {a.emissao}
                        {a.chaveAcesso ? ` · ${a.chaveAcesso}` : ""}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {naoAvaliadas.length ? (
        <div style={{ marginTop: 10 }}>
          {/* ⚠ NADA SOME EM SILÊNCIO. A nota que a pergunta não conseguiu avaliar aparece com o
              motivo — senão a conferência pareceria cobrir notas que ela não cobriu. */}
          <button
            type="button"
            onClick={() => setAbertoIgnoradas((v) => !v)}
            style={{
              background: "transparent", border: "none", cursor: "pointer", padding: 0,
              color: PANEL.muted, fontSize: "0.8rem",
            }}
          >
            {abertoIgnoradas ? "▾" : "▸"} {naoAvaliadas.length} nota(s) fora desta conferência
          </button>
          {abertoIgnoradas ? (
            <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 4 }}>
              {naoAvaliadas.map((n, i) => (
                <li key={n.notaId || i} style={{ color: PANEL.muted, fontSize: "0.78rem" }}>
                  {n.numero ? `Nota ${n.numero}` : "Nota sem número"} — {FRASE_NOTA_NAO_AVALIADA[n.motivo] || n.motivo}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AuditoriaTab({ companyId, competencia, api = auditoriaApi }) {
  const [auditoria, setAuditoria] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    if (!companyId || !competencia) return;
    setCarregando(true);
    setErro("");
    try {
      const r = await api.getAuditoriaNotas(companyId, competencia);
      setAuditoria(r?.auditoria || null);
    } catch (e) {
      // ⚠ A FALHA APARECE. Erro engolido nesta tela viraria "nada a apontar", que é a mentira mais
      // cara que ela pode contar — e é o defeito já pago no `FechamentoModal` (`apps/web/CLAUDE.md`).
      setAuditoria(null);
      setErro(e?.message || "Não foi possível carregar a auditoria desta competência.");
    } finally {
      setCarregando(false);
    }
  }, [api, companyId, competencia]);

  useEffect(() => { carregar(); }, [carregar]);

  const cabecalho = leituraDoCabecalho(auditoria);

  return (
    /* ⚠ A LARGURA SAIU DAQUI (era `maxWidth: 1100` + padding próprio, mais um número entre os
       cinco que o grupo tinha): quem decide é o `CompanyTabLayout`, com `largura="leitura"`. */
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ ...card, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, color: PANEL.text, fontSize: "1.05rem" }}>Auditoria pré-apuração</h2>
            <Selo token={cabecalho.token} icone={cabecalho.icone}>{cabecalho.titulo}</Selo>
          </div>
          <div style={{ color: PANEL.muted, fontSize: "0.83rem", marginTop: 6 }}>
            {carregando ? "Conferindo as notas desta competência…" : cabecalho.texto}
          </div>
          {/* ⚠ ISTO PRECISA ESTAR NA TELA. O sistema não sabe se a nota está errada — ele sabe que
              algo não bate com o cadastro. Sem esta linha, uma lista de "pontos a conferir" é lida
              como uma lista de erros, e o contador age sobre um veredito que ninguém deu. */}
          <div style={{ color: PANEL.muted, fontSize: "0.78rem", marginTop: 8, fontStyle: "italic" }}>
            Cada ponto é uma pergunta, não um veredito: o sistema compara a nota com o cadastro e com
            ela mesma. Quem decide se a nota está correta é você.
          </div>
        </div>
        <button
          type="button"
          onClick={carregar}
          disabled={carregando}
          style={{
            background: "transparent", color: PANEL.accent, cursor: carregando ? "default" : "pointer",
            border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: "6px 12px", fontSize: "0.82rem",
          }}
        >
          {carregando ? "…" : "↻ Atualizar"}
        </button>
      </div>

      {erro ? (
        <div style={{ ...card, borderLeft: "3px solid var(--state-danger)", color: PANEL.text, fontSize: "0.85rem" }}>
          {erro}
        </div>
      ) : null}

      {!erro && !carregando && !auditoria ? (
        <div style={{ ...card, color: PANEL.muted, fontSize: "0.85rem" }}>
          Escolha uma competência no topo para conferir as notas do mês.
        </div>
      ) : null}

      {auditoria
        ? ordenarPerguntas(auditoria.perguntas).map((p) => <BlocoDaPergunta key={p.id} pergunta={p} />)
        : null}

      {auditoria ? (
        <div style={{ color: PANEL.muted, fontSize: "0.75rem" }}>
          {auditoria.totalNotas} nota(s) emitida(s) na competência ({auditoria.totalNotasApuradas} entram na apuração).
          Esta tela apenas lê — nada é marcado, classificado ou alterado por ela.
        </div>
      ) : null}
    </div>
  );
}
