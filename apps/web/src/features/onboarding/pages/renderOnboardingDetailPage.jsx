import { PainelComercial } from "../components/PainelComercial";
// As áreas compartilham a ficha, mas preservam seus rascunhos ao alternar a navegação.

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
  const [areaEscolhida, setAreaEscolhida] = useState(null);

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
      if (r?.portalClientId) onAbrirEmpresa?.(r.portalClientId, "cadastro");
    } catch (e) {
      setErroConversao(e);
    }
  }

  async function vincular(portalClientId, cnpjDefinitivo) {
    if (!portalClientId) return;
    setErroConversao(null);
    try {
      await api.converterOnboarding(onboarding.id, { vincularPortalClientId: portalClientId, cnpjDefinitivo });
      setModalAberto(false);
      await carregar();
      onAbrirEmpresa?.(portalClientId, "cadastro");
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
    return <PageShell title="Entrada de clientes" onBack={onVoltar}><p style={{ color: "var(--text-muted)" }}>Carregando…</p></PageShell>;
  }
  if (erro || !onboarding) {
    return (
      <PageShell title="Entrada de clientes" onBack={onVoltar}>
        <p style={{ color: "var(--state-warn)" }}>{erro?.message || "Atendimento não encontrado."}</p>
      </PageShell>
    );
  }

  const status = statusDoOnboarding(onboarding.status);
  const convertido = onboarding.status === "CONVERTIDO";
  const encerrado = ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"].includes(onboarding.status);
  const temComercial = typeof api.getOnboardingComercial === "function";
  const area = areaEscolhida?.id === onboarding.id ? areaEscolhida.area :
    convertido ? "implantacao" : temComercial ? "comercial" : "dados";
  const areas = [...(temComercial ? [["comercial", "Atendimento comercial"]] : []), ["dados", "Dados do cliente"], ["implantacao", "Implantação"]];
  const pendentes = (onboarding.etapas || []).filter(etapa => !etapa.concluidaEm);
  const proximaEtapa = pendentes.find(etapa => etapa.obrigatoria) || pendentes[0];

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
      <nav className="onboarding-sections" aria-label="Áreas do atendimento">
        {areas.map(([chave, rotulo]) => <button type="button" key={chave}
          aria-pressed={area === chave} aria-controls={`onboarding-area-${chave}`}
          onClick={() => setAreaEscolhida({ id: onboarding.id, area: chave })}>{rotulo}</button>)}
      </nav>
      {aviso && (
        <div style={{ padding: "var(--space-2) var(--space-3)", marginBottom: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 13, color: "var(--text-muted)" }}>
          {aviso}
        </div>
      )}

      {convertido && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 0 }}>
          Empresa adicionada à carteira. Esta ficha preserva o histórico; atualizações e documentos ficam no cadastro da empresa.
        </p>
      )}

      <div id="onboarding-area-comercial" className="onboarding-area" hidden={area !== "comercial"}>
        {temComercial && <PainelComercial key={onboarding.id} api={api} onboardingId={onboarding.id} convertido={encerrado} revisao={revisaoComercial} coletaInicial={onboarding.status === "RASCUNHO"} />}
      </div>
      <section id="onboarding-area-dados" className="onboarding-area" hidden={area !== "dados"} aria-label="Dados do cliente">
          <h2>Dados declarados</h2>
          <FichaDeclarada
            origem={onboarding.origem}
            dados={onboarding.dados || {}}
            origemPreenchimento={onboarding.origemPreenchimento}
          />
          {onboarding.portalClientId && <Button variant="secondary" onClick={() => onAbrirEmpresa?.(onboarding.portalClientId, "documentos")}>Documentos da empresa</Button>}
      </section>

      <section id="onboarding-area-implantacao" className="onboarding-area" hidden={area !== "implantacao"} aria-label="Implantação">
          <h2>Preparação e implantação</h2>
          <p className="onboarding-help">Checklist do escritório para este serviço. Contratação, assinatura e pagamento são conferidos no atendimento comercial.</p>
          {proximaEtapa && !encerrado && <div className="onboarding-next-step"><small>Próxima pendência da checklist</small><strong>{proximaEtapa.titulo}</strong><span>{pendentes.length} {pendentes.length === 1 ? "etapa pendente" : "etapas pendentes"}</span></div>}
          {!onboarding.etapas?.length && <p className="onboarding-help">As etapas serão criadas quando a ficha for enviada. Enquanto isso, prepare o link e acompanhe o preenchimento.</p>}
          {onboarding.etapas?.length > 0 && <ChecklistEtapas
            etapas={onboarding.etapas || []}
            portalClientId={onboarding.portalClientId}
            certificado={certificado}
            ocupada={ocupada || encerrado}
            onAlternar={alternarEtapa}
            onObservacao={salvarObservacao}
            onAcao={executarAcao}
          />}
          {onboarding.portalClientId && <div className="onboarding-actions">
            <Button variant="secondary" onClick={() => onAbrirEmpresa?.(onboarding.portalClientId, "cadastro")}>Cadastro da empresa</Button>
            <Button variant="secondary" onClick={() => onAbrirEmpresa?.(onboarding.portalClientId, "documentos")}>Documentos da empresa</Button>
          </div>}
      </section>

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
