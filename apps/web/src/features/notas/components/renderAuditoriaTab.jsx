// A ABA AUDITORIA — três perguntas sobre as notas do mês, respondidas antes de apurar.
//
// ⚠ O CORTE DE 21/08/2026 (aprovado pelo dono). Ela mostrava **~1.799 "pontos a conferir"**, dos
// quais ~18 eram perguntas de verdade — e uma lista em que 99% é ruído treina o contador a não ler
// a lista. O que mudou NA TELA (a justificativa de cada corte está na regra, em
// `application/notas/auditoria/auditoriaNotas.js`):
//
//   • saiu o bloco **Numeração da DPS** (falso positivo: não há regra de numeração contínua da DPS
//     no ANEXO_I, e os "buracos" mediam a nossa captura);
//   • saiu o bloco **Nota que não pôde ser lida** (manutenção do sistema, não pergunta de contador);
//   • **Emissão fora da competência** passou a listar só desvio de 2+ meses; o desvio de um mês —
//     1.727 dos 1.738 casos, a virada normal — virou UMA LINHA de contagem;
//   • entrou o bloco **Pendências pós-fechamento** (`PendenciasList`, que existia sem consumidor
//     nenhum), respondendo *"entrou nota depois que eu fechei o mês?"*;
//   • entrou a linha das **notas fora de qualquer conferência mensal** (sem competência gravada),
//     que antes sumiam antes de a regra existir.
//
// ⚠ ONDE ELA VIVE, E POR QUÊ: dentro da EMPRESA, no grupo Fiscal, entre "Notas Fiscais" e
// "Apuração". O dono chamou o pedido de *auditoria PRÉ-apuração* — é o passo imediatamente anterior
// ao fechamento, que acontece empresa a empresa e competência a competência. Três das cinco
// perguntas só existem nesse escopo: o cadastro de códigos é da empresa (`Company`), a numeração da
// DPS é por empresa+série, e a competência é o eixo do fechamento. Uma visão de carteira é um
// próximo passo natural (e reusaria `empresasVisiveis`, sem quarta leitura de escopo), mas o achado
// só é acionável aqui — é aqui que o contador abre a nota e decide.
//
// A auditoria não altera notas automaticamente. Contadores podem tratar pendências existentes
// com confirmação explícita: reabertura fiscal exige motivo; concluir conferência não retifica.
//
// ⚠ E ELA NÃO REESCREVE A REGRA. Todo texto de pergunta vem do backend
// (`application/notas/auditoria/auditoriaNotas.js`, puro); o que é de tela — motivo em português,
// cor, ordem — vive em `notas/lib/auditoriaTela.js`, com teste próprio. O componente só liga os dois.

import { useCallback, useEffect, useRef, useState } from "react";
import { NotaDetailModal } from "./NotaDetailModal";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { createApiClient } from "../../../api/client";
import { PANEL } from "./notasStyles";
import { PendenciasList } from "./PendenciasList";
import {
  leituraDaPergunta,
  leituraDoCabecalho,
  leituraDoForaDaConferencia,
  frasesDoAchado,
  fraseDaViradaDeMes,
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

function BlocoDaPergunta({ pergunta, onAbrirNota }) {
  const leitura = leituraDaPergunta(pergunta);
  const achados = pergunta.achados || [];
  const naoAvaliadas = pergunta.naoAvaliadas || [];
  const virada = fraseDaViradaDeMes(pergunta);
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

      {virada ? (
        <div style={{ color: PANEL.muted, fontSize: "0.78rem", marginTop: 4 }}>
          {/* ⚠ ESTA LINHA NÃO É DECORAÇÃO. Ela é o que mantém verdadeira a promessa "nada some em
              silêncio" depois que 1.727 notas deixaram de virar linha. Tirá-la faz a pergunta
              esconder notas que ela de fato conferiu. */}
          {virada}
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
                    {a.notaId && <Button size="sm" variant="secondary" onClick={() => onAbrirNota(a.notaId)}>Abrir nota</Button>}
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
                  {n.notaId && <Button size="sm" variant="secondary" onClick={() => onAbrirNota(n.notaId)}>Abrir nota {n.numero || ""}</Button>}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AuditoriaTab({ companyId, competencia, api = auditoriaApi, podeEditar = false }) {
  const escopo = `${companyId}:${competencia}`;
  const escopoAtual = useRef(escopo);
  escopoAtual.current = escopo;
  const pedidoAuditoria = useRef(0), pedidoPendencias = useRef(0);
  const [escopoCarregado, setEscopoCarregado] = useState(null);
  const [empresaPendencias, setEmpresaPendencias] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const pedidoNota = useRef(0);
  const fecharNota = () => { pedidoNota.current += 1; setDetalhe(null); };
  useEffect(() => { fecharNota(); return () => { pedidoNota.current += 1; }; }, [companyId, competencia]);
  async function abrirNota(id) {
    const pedido = ++pedidoNota.current;
    setDetalhe({ loading: true });
    try {
      const r = await api.getNota(companyId, id);
      if (!r?.nota) throw new Error("A API respondeu sem os dados da nota.");
      if (pedido === pedidoNota.current) setDetalhe({ nota: r.nota, loading: false });
    } catch (e) {
      if (pedido === pedidoNota.current) setDetalhe({ error: e?.message || "Não foi possível ler a nota.", loading: false });
    }
  }
  const [auditoria, setAuditoria] = useState(null);
  const [pendencias, setPendencias] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [tratamento, setTratamento] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [tratando, setTratando] = useState(false);
  const tratandoRef = useRef(false);
  const [resultadoTratamento, setResultadoTratamento] = useState(null);
  useEffect(() => { setTratamento(null); setResultadoTratamento(null); setMotivo(""); }, [companyId, competencia]);

  const carregar = useCallback(async () => {
    if (!companyId || !competencia) { setCarregando(false); setErro(""); return; }
    const pedido = ++pedidoAuditoria.current;
    const atual = () => escopoAtual.current === escopo && pedidoAuditoria.current === pedido;
    setCarregando(true);
    setErro("");
    try {
      const r = await api.getAuditoriaNotas(companyId, competencia);
      if (!atual()) return;
      if (!r?.auditoria) throw new Error("Não foi possível confirmar os dados da auditoria.");
      setAuditoria(r?.auditoria || null);
      setEscopoCarregado(escopo);
    } catch (e) {
      // ⚠ A FALHA APARECE. Erro engolido nesta tela viraria "nada a apontar", que é a mentira mais
      // cara que ela pode contar — e é o defeito já pago no `FechamentoModal` (`apps/web/CLAUDE.md`).
      if (atual()) { setAuditoria(null); setErro(e?.message || "Não foi possível carregar a auditoria desta competência."); }
    } finally {
      if (atual()) setCarregando(false);
    }
  }, [api, companyId, competencia]);

  // ⚠ CHAMADA SEPARADA, DE PROPÓSITO — e ela NÃO depende da competência.
  //
  // A pendência pós-fechamento é da EMPRESA, não do mês: a rota
  // (`GET /firm/companies/:id/pendencias-pos-fechamento`) não recebe competência, e a pergunta que
  // ela responde — *"entrou nota depois que eu fechei o mês?"* — vale para qualquer mês fechado,
  // inclusive um anterior ao que está na tela. Filtrar pela competência aberta esconderia
  // exatamente a nota que chegou atrasada, que é o caso todo.
  //
  // ⚠ E A FALHA DELA NÃO DERRUBA A AUDITORIA. São duas perguntas independentes; um erro aqui
  // apagaria as três respostas que já vieram. Mas também **não vira lista vazia com cara de
  // "nenhuma pendência"** — ela some, e o rodapé diz que não foi possível conferir.
  const [pendenciasFalharam, setPendenciasFalharam] = useState(false);
  const carregarPendencias = useCallback(async () => {
    if (!companyId) return;
    const pedido = ++pedidoPendencias.current;
    const atual = () => escopoAtual.current.split(":")[0] === companyId && pedidoPendencias.current === pedido;
    try {
      const lista = await api.listPendenciasPosFechamento(companyId, { onlyOpen: true });
      if (!atual()) return;
      if (!Array.isArray(lista)) throw new Error("Resposta de pendências indisponível");
      setPendencias(Array.isArray(lista) ? lista : []);
      setEmpresaPendencias(companyId);
      setPendenciasFalharam(false);
    } catch {
      if (atual()) { setPendencias([]); setEmpresaPendencias(companyId); setPendenciasFalharam(true); }
    }
  }, [api, companyId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarPendencias(); }, [carregarPendencias]);
  useEffect(() => () => { pedidoAuditoria.current += 1; pedidoPendencias.current += 1; }, []);

  async function confirmarTratamento() {
    if (!podeEditar || !tratamento || tratandoRef.current || (tratamento.tipo === "reabrir" && !motivo.trim())) return;
    tratandoRef.current = true; setTratando(true); setResultadoTratamento(null);
    try {
      const r = tratamento.tipo === "reabrir"
        ? await api.reabrirCompetencia(companyId, tratamento.competencia, motivo.trim())
        : await api.resolverPendenciaPosFechamento(companyId, tratamento.id);
      if (r?.ok !== true) throw new Error("Não foi possível confirmar a alteração. Atualize a auditoria antes de tentar novamente.");
      if (escopoAtual.current !== escopo) return;
      setTratamento(null);
      setResultadoTratamento({ texto: tratamento.tipo === "reabrir" ? "Competência fiscal reaberta para conferência. A pendência permanece até você concluir sua revisão." : "Pendência marcada como conferida." });
      await Promise.all([carregar(), carregarPendencias()]);
    } catch (e) {
      if (escopoAtual.current === escopo) setResultadoTratamento({ erro: true, texto: e?.message || "Não foi possível tratar a pendência." });
    } finally { tratandoRef.current = false; setTratando(false); }
  }

  const auditoriaVisivel = escopoCarregado === escopo ? auditoria : null;
  const pendenciasVisiveis = empresaPendencias === companyId ? pendencias : [];

  const cabecalho = leituraDoCabecalho(auditoriaVisivel);
  const fora = leituraDoForaDaConferencia(auditoriaVisivel?.foraDaConferencia);

  return (
    /* ⚠ A LARGURA SAIU DAQUI (era `maxWidth: 1100` + padding próprio, mais um número entre os
       cinco que o grupo tinha): quem decide é o `CompanyTabLayout`, com `largura="leitura"`. */
    <div className="company-auditoria" style={{ display: "grid", gap: 14 }}>
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
          onClick={() => { carregar(); carregarPendencias(); }}
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

      {!erro && !carregando && !auditoriaVisivel ? (
        <div style={{ ...card, color: PANEL.muted, fontSize: "0.85rem" }}>
          Escolha uma competência no topo para conferir as notas do mês.
        </div>
      ) : null}

      {/* ⚠ A PENDÊNCIA PÓS-FECHAMENTO VEM ANTES DAS PERGUNTAS, e não é ordem estética: ela é a
          única coisa nesta aba que fala de um mês JÁ FECHADO — ou seja, de uma decisão que o
          contador já tomou e que talvez precise desfazer. Depois das perguntas do mês aberto, ela
          seria lida como mais um detalhe do mês em curso.
          ⚠ SEM `onReabrir`/`onResolver`: a aba não escreve. Quem reabre a competência é a aba
          Lançamentos, onde a ação já existe e já tem confirmação. */}
      <PendenciasList pendencias={pendenciasVisiveis} saving={tratando} onAbrirNota={abrirNota}
        onReabrir={podeEditar && api.reabrirCompetencia ? (mes) => { setMotivo(""); setTratamento({ tipo: "reabrir", competencia: mes }); } : undefined}
            onResolver={podeEditar && api.resolverPendenciaPosFechamento ? (id) => setTratamento({ tipo: "resolver", id }) : undefined}
        rotuloResolver="Marcar como conferida" />
      {resultadoTratamento && <p role={resultadoTratamento.erro ? "alert" : "status"}>{resultadoTratamento.texto}</p>}
      {pendenciasFalharam && empresaPendencias === companyId && !auditoriaVisivel && <p role="alert">Não foi possível conferir se entrou nota depois de a competência ser fechada.</p>}

      {fora ? (
        <div style={{ ...card, borderLeft: `3px solid var(${fora.token})` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ color: PANEL.text, fontWeight: 600, fontSize: "0.95rem" }}>
              Notas fora de qualquer conferência mensal
            </div>
            <Selo token={fora.token} icone={fora.icone}>{auditoriaVisivel?.foraDaConferencia?.total}</Selo>
          </div>
          {/* ⚠ ESTE BLOCO É O CONSERTO DE UMA PROMESSA QUEBRADA (21/08/2026). A consulta filtrava
              por competência, e `NULL` não satisfaz intervalo: a nota sem competência não entrava em
              pergunta nenhuma E não aparecia em "notas fora desta conferência" — ela simplesmente
              não existia para a tela, enquanto a aba dizia "nada some em silêncio".
              ⚠ Ela NÃO é atribuída a este mês: fazer isso seria o sistema inventar a competência
              dela, que é o dado que decide em qual apuração a receita entra. */}
          <div style={{ color: PANEL.text, fontSize: "0.85rem", marginTop: 8 }}>{fora.resumo}</div>
          {auditoriaVisivel?.foraDaConferencia?.truncada ? (
            <div style={{ color: PANEL.muted, fontSize: "0.78rem", marginTop: 4 }}>
              Mostrando {auditoriaVisivel.foraDaConferencia.listadas} das {auditoriaVisivel.foraDaConferencia.total} mais recentes.
            </div>
          ) : null}
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 4 }}>
            {(auditoriaVisivel?.foraDaConferencia?.notas || []).map((n, i) => (
              <li key={n.notaId || i} style={{ color: PANEL.muted, fontSize: "0.78rem" }}>
                {n.numero ? `Nota ${n.numero}` : "Nota sem número"}
                {n.emissao ? ` — emitida em ${n.emissao}` : ""}
                {n.notaId && <Button size="sm" variant="secondary" onClick={() => abrirNota(n.notaId)}>Abrir nota {n.numero || "sem número"}</Button>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {auditoriaVisivel
        ? ordenarPerguntas(auditoriaVisivel.perguntas).map((p) => <BlocoDaPergunta key={`${escopo}:${p.id}`} pergunta={p} onAbrirNota={abrirNota} />)
        : null}

      {detalhe && <NotaDetailModal {...detalhe} onClose={fecharNota} onAbrirNota={abrirNota} />}
      {auditoriaVisivel ? (
        <div style={{ color: PANEL.muted, fontSize: "0.75rem" }}>
          {auditoriaVisivel.totalNotas} nota(s) emitida(s) na competência ({auditoriaVisivel.totalNotasApuradas} entram na apuração).
          A conferência não altera notas nem apurações automaticamente.
          {/* ⚠ FALHA DA SEGUNDA CHAMADA APARECE. Lista vazia por erro é indistinguível de "nenhuma
              pendência" — e "nenhuma pendência" é uma afirmação sobre mês fechado. */}
          {pendenciasFalharam
            ? " ⚠ Não foi possível conferir se entrou nota depois de a competência ser fechada."
            : ""}
        </div>
      ) : null}
      {tratamento && <Modal titulo={tratamento.tipo === "reabrir" ? `Reabrir competência fiscal ${tratamento.competencia}` : "Concluir conferência da pendência"} tamanho="sm" ocupado={tratando} aoFechar={() => setTratamento(null)} rodape={<>
        <Button variant="secondary" disabled={tratando} onClick={() => setTratamento(null)}>Cancelar</Button>
        <Button disabled={tratando || (tratamento.tipo === "reabrir" && !motivo.trim())} onClick={confirmarTratamento}>{tratando ? "Salvando…" : "Confirmar"}</Button>
      </>}>
        {tratamento.tipo === "reabrir" ? <><p>A competência fiscal voltará à conferência. Isso não reabre o fechamento contábil, não retifica declarações transmitidas e não resolve a pendência automaticamente.</p><label>Motivo da reabertura<textarea aria-label="Motivo da reabertura" value={motivo} disabled={tratando} onChange={e => setMotivo(e.target.value)} style={{ width: "100%" }} /></label></> : <p>Confirme somente depois de revisar a nota e os reflexos na competência. Esta ação encerra o aviso; não altera a nota, o fechamento ou a declaração.</p>}
        {resultadoTratamento?.erro && <p role="alert">{resultadoTratamento.texto}</p>}
      </Modal>}
    </div>
  );
}
