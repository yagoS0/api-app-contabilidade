import { PainelComercial } from "../components/PainelComercial";
// DETALHE — duas colunas.
//
// Esquerda: a ficha declarada, SOMENTE LEITURA, percorrendo A MESMA SPEC do wizard. O escritório vê
// exatamente o que foi perguntado, na ordem em que foi perguntado — é isso que torna a divergência
// entre declarado e conferido visível.
// Direita: a checklist ordenada, com o efeito colateral em cada card.
//
// ⚠ `--content-max`: é ficha de leitura, não tabela.

import { useCallback, useEffect, useState } from "react";
import { PageShell } from "../../../components/layout/PageShell";
import { Button } from "../../../components/ui/Button";
import { ChecklistEtapas } from "../components/ChecklistEtapas";
import { ConversaoModal } from "../components/ConversaoModal";
import { FichaDeclarada } from "../components/PassoRevisao";
import { formatarCnpj } from "../lib/brasilApi";
import { ONBOARDING_ORIGENS } from "../lib/onboardingSpec";
import { estiloDoStatus, statusDoOnboarding } from "../lib/onboardingStatus";

function tituloDaOrigem(origem) {
  return ONBOARDING_ORIGENS.find((o) => o.chave === origem)?.titulo || origem || "—";
}

export function OnboardingDetailPage({ api, onboardingId, onVoltar, onAbrirEmpresa, onEditar }) {
  const [onboarding, setOnboarding] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [ocupada, setOcupada] = useState(false);
  const [certificado, setCertificado] = useState(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [erroConversao, setErroConversao] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [revisaoComercial, setRevisaoComercial] = useState(0);

  async function atualizarFicha() {
    if (ocupada) return;
    setOcupada(true);
    try {
      const r = await api.getOnboarding(onboardingId);
      setOnboarding(r?.onboarding || r);
      setRevisaoComercial(v => v + 1);
      setAviso("Ficha atualizada com os dados salvos pelo cliente.");
    } catch (e) { setAviso(e.message); }
    finally { setOcupada(false); }
  }

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await api.getOnboarding(onboardingId);
      setOnboarding(r?.onboarding || r);
      setErro(null);
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [api, onboardingId]);

  useEffect(() => { carregar(); }, [carregar]);

  // ⚠ Pós-conversão o card do A1 lê o estado REAL do certificado, para o checkbox não poder
  // afirmar "feito" com a empresa sem certificado instalado.
  useEffect(() => {
    const portalId = onboarding?.portalClientId;
    if (!portalId || typeof api.getCompanyCert !== "function") return;
    let vivo = true;
    // ⚠ `getCompanyCert` recebe o id do PORTAL CLIENT (a rota é `/firm/companies/:id/certificate`),
    // ainda que o certificado more na Company legada. São dois ids diferentes.
    api.getCompanyCert(portalId)
      .then((r) => { if (vivo) setCertificado(r); })
      .catch(() => { if (vivo) setCertificado(null); });
    return () => { vivo = false; };
  }, [api, onboarding?.portalClientId]);

  async function alternarEtapa(etapa, concluida) {
    setOcupada(true);
    try {
      const r = await api.salvarEtapaOnboarding(onboarding.id, etapa.id, { concluida });
      setOnboarding(r?.onboarding || onboarding);
    } catch (e) {
      setAviso(e.message);
    } finally {
      setOcupada(false);
    }
  }

  async function salvarObservacao(etapa, observacao) {
    setOcupada(true);
    try {
      const r = await api.salvarEtapaOnboarding(onboarding.id, etapa.id, { observacao });
      setOnboarding(r?.onboarding || onboarding);
    } catch (e) {
      setAviso(e.message);
    } finally {
      setOcupada(false);
    }
  }

  async function executarAcao(etapa) {
    const portalId = onboarding?.portalClientId;
    if (etapa.acao === "CONVERSAO") { setModalAberto(true); return; }
    if (!portalId) return; // o botão já está desabilitado; guarda de segundo nível

    if (etapa.acao === "SITFIS") {
      setOcupada(true);
      try {
        const r = await api.getSitfis(portalId);
        // ⚠ `throttled: true` NÃO é erro: a trava de 4h devolve 200 com o relatório JÁ SALVO.
        // Tratá-lo como falha faria a tela dizer que a consulta deu errado quando ela só foi
        // dispensada — e a consulta é paga, com limite por CONTRATANTE.
        setAviso(
          r?.throttled
            ? "Consulta dispensada: já houve uma nos últimos 240 minutos. O relatório salvo continua valendo."
            : "Situação fiscal consultada."
        );
      } catch (e) {
        setAviso(e.message);
      } finally {
        setOcupada(false);
      }
      return;
    }

    // A1 e documentos vivem na tela da empresa — o card leva até lá.
    onAbrirEmpresa?.(portalId, etapa.acao === "CERTIFICADO_A1" ? "certificado" : "documentos");
  }

  async function converter(payload) {
    setErroConversao(null);
    try {
      const r = await api.converterOnboarding(onboarding.id, payload);
      setModalAberto(false);
      setOnboarding(r?.onboarding || onboarding);
      await carregar();
    } catch (e) {
      setErroConversao(e);
    }
  }

  async function vincular(portalClientId) {
    if (!portalClientId) return;
    setErroConversao(null);
    try {
      await api.converterOnboarding(onboarding.id, { vincularPortalClientId: portalClientId });
      setModalAberto(false);
      await carregar();
    } catch (e) {
      setErroConversao(e);
    }
  }

  async function marcarDesistencia() {
    const motivo = window.prompt("Motivo da desistência (opcional):", "");
    if (motivo === null) return;
    try {
      const r = await api.desistirOnboarding(onboarding.id, motivo);
      setOnboarding(r?.onboarding || onboarding);
    } catch (e) {
      setAviso(e.message);
    }
  }

  if (carregando) {
    return <PageShell title="Onboarding" onBack={onVoltar}><p style={{ color: "var(--text-muted)" }}>Carregando…</p></PageShell>;
  }
  if (erro || !onboarding) {
    return (
      <PageShell title="Onboarding" onBack={onVoltar}>
        <p style={{ color: "var(--state-warn)" }}>{erro?.message || "Onboarding não encontrado."}</p>
      </PageShell>
    );
  }

  const status = statusDoOnboarding(onboarding.status);
  const convertido = onboarding.status === "CONVERTIDO";
  const encerrado = ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"].includes(onboarding.status);

  return (
    <PageShell
      title={onboarding.razaoSocial || onboarding.responsavelNome || `Atendimento ${String(onboarding.id).slice(-6)}`}
      subtitle={`${tituloDaOrigem(onboarding.origem)}${onboarding.cnpj ? ` · ${formatarCnpj(onboarding.cnpj)}` : ""}`}
      onBack={onVoltar}
      backLabel="Entrada de clientes"
      actions={
        <div className="onboarding-actions">
          <Button variant="secondary" size="sm" disabled={ocupada} onClick={atualizarFicha}>Atualizar ficha</Button>
          <span
            style={{ ...estiloDoStatus(onboarding.status), padding: "2px 10px", borderRadius: 999, border: "1px solid", fontSize: 12, fontWeight: 600 }}
          >
            <span aria-hidden="true">{status.icone}</span> {status.rotulo}
          </span>
          {!encerrado && (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={() => onEditar?.(onboarding.id)}>
                Editar ficha
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={marcarDesistencia}>
                Desistiu
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setModalAberto(true)}>
                Adicionar à carteira
              </Button>
            </>
          )}
          {convertido && onboarding.portalClientId && (
            <Button type="button" size="sm" onClick={() => onAbrirEmpresa?.(onboarding.portalClientId)}>
              Abrir a empresa
            </Button>
          )}
        </div>
      }
      contentClassName="onboarding-workspace"
      contentStyle={{ maxWidth: "var(--content-max)", margin: "0 auto", width: "100%" }}
    >
      {typeof api.getOnboardingComercial === "function" && <PainelComercial key={onboarding.id} api={api} onboardingId={onboarding.id} convertido={encerrado} revisao={revisaoComercial} />}
      {aviso && (
        <div style={{ padding: "var(--space-2) var(--space-3)", marginBottom: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 13, color: "var(--text-muted)" }}>
          {aviso}
        </div>
      )}

      {convertido && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 0 }}>
          Esta ficha virou empresa e agora é histórico — somente leitura. A verdade sobre a empresa
          passa a morar no cadastro dela.
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 380px)",
          gap: "var(--space-5)",
          alignItems: "start",
        }}
        className="onboarding-detalhe-grid"
      >
        <section>
          <details className="onboarding-panel" open={onboarding.status !== "RASCUNHO"}>
          <summary>2. Conferir dados do cliente</summary>
          <FichaDeclarada
            origem={onboarding.origem}
            dados={onboarding.dados || {}}
            origemPreenchimento={onboarding.origemPreenchimento}
          />
          </details>
        </section>

        <section>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>3. Andamento no escritório</h2>
          {!onboarding.etapas?.length && <p className="onboarding-help">As etapas serão criadas quando a ficha for enviada. Enquanto isso, prepare o link e acompanhe o preenchimento.</p>}
          {onboarding.etapas?.length > 0 && <ChecklistEtapas
            etapas={onboarding.etapas || []}
            portalClientId={onboarding.portalClientId}
            certificado={certificado}
            ocupada={ocupada || convertido}
            onAlternar={alternarEtapa}
            onObservacao={salvarObservacao}
            onAcao={executarAcao}
          />}
        </section>
      </div>

      {/* Abaixo de ~900px as duas colunas viram uma. */}
      <style>{`
        @media (max-width: 900px) {
          .onboarding-detalhe-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>

      {modalAberto && (
        <ConversaoModal
          onboarding={onboarding}
          erro={erroConversao}
          onFechar={() => { setModalAberto(false); setErroConversao(null); }}
          onConverter={converter}
          onVincular={vincular}
        />
      )}
    </PageShell>
  );
}

export default OnboardingDetailPage;
