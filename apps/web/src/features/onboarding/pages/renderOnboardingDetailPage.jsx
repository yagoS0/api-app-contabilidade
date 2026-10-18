import { nomeDaOportunidade } from '../../comercial/comercialModel';
import { etapaSatisfeita } from '../lib/jornadaComercial';
import { PainelComercial } from "../components/PainelComercial";
import { PreparacaoEmissao } from '../components/PreparacaoEmissao';
import { ChecklistImplantacao } from '../../implantacao/ChecklistImplantacao';
import { ProtecaoEdicao } from '../../configuracoes/ProtecaoEdicao';
import { useConfirmarSaida } from '../../configuracoes/ProtecaoEdicao.shared.js';
import { OnboardingWizardPage } from "./renderOnboardingWizardPage";
import { NovaDemanda } from "../components/NovaDemanda";
import { AcompanhamentoComercial } from '../../comercial/AcompanhamentoComercial';
// As áreas compartilham a ficha, mas preservam seus rascunhos ao alternar a navegação.

import { useCallback, useEffect, useRef, useState } from "react";
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

export function OnboardingDetailPage(props) {
  return <ProtecaoEdicao><OnboardingDetailContent {...props} /></ProtecaoEdicao>;
}
function OnboardingDetailContent({ api, onboardingId, onVoltar, onAbrirEmpresa, onAbrirAtendimento, onAbrirConversa, preenchimentoInicial = false }) {
  const confirmarSaida = useConfirmarSaida();
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
  const [editando, setEditando] = useState(preenchimentoInicial);
  const [continuacao, setContinuacao] = useState(0);
  const [conversaVinculada, setConversaVinculada] = useState(null);
  const contexto = useRef(onboardingId), leitura = useRef(0);
  if (contexto.current !== onboardingId) { contexto.current = onboardingId; leitura.current++; }
  useEffect(() => {
    const leituraDaFicha = leitura;
    contexto.current = onboardingId;
    return () => { leituraDaFicha.current++; contexto.current = null; };
  }, [onboardingId]);
  useEffect(() => {
    let atual = true;
    setConversaVinculada(null);
    if (api.comercial) api.comercial(`/onboardings/${encodeURIComponent(onboardingId)}/acompanhamento`)
      .then(r => { if (atual) setConversaVinculada({ onboardingId, id: r?.conversaId }); })
      .catch(() => { /* O acompanhamento mantém sua própria mensagem de erro e recarga. */ });
    return () => { atual = false; };
  }, [api, onboardingId, revisaoComercial]);
  const salvarAntesDeSair = useRef(null);
  const registrarSaida = useCallback(fn => { salvarAntesDeSair.current = fn; }, []);
  const saidaEmCurso = useRef(false);
  async function sair(destino) {
    if (saidaEmCurso.current) return;
    saidaEmCurso.current = true;
    try {
      if (editando) await salvarAntesDeSair.current?.();
      confirmarSaida(() => destino?.());
    } catch (e) { setAviso(`Não foi possível salvar. Seus dados continuam nesta tela. ${e.message}`); }
    finally { saidaEmCurso.current = false; }
  }
  const voltar = () => sair(onVoltar);
  const voltarAoChat = () => sair(() => {
    if (conversaVinculada?.onboardingId !== onboardingId || !conversaVinculada.id) return;
    if (onAbrirConversa) onAbrirConversa(conversaVinculada.id);
    else window.location.assign(`/comercial/conversas?conversa=${encodeURIComponent(conversaVinculada.id)}`);
  });

  useEffect(() => { setEditando(preenchimentoInicial); setAreaEscolhida(null); setOcupada(false); setAviso(null); setModalAberto(false); }, [onboardingId, preenchimentoInicial]);

  async function continuarAtendimento() {
    try {
      const r = await api.getOnboarding(onboardingId);
      setOnboarding(r?.onboarding || r);
      setRevisaoComercial(v => v + 1);
      setEditando(false);
      setContinuacao(v => v + 1);
      setAreaEscolhida({ id: onboardingId, area: typeof api.getOnboardingComercial === "function" ? "comercial" : "dados" });
      setAviso(null);
    } catch (e) { setAviso(`Os dados foram salvos, mas não foi possível atualizar o atendimento. ${e.message}`); }
  }

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

  async function atualizarEvidencias({ origem } = {}) {
    const id = onboardingId;
    if (contexto.current !== id) return;
    const pedido = ++leitura.current;
    try {
      const r = await api.getOnboarding(id);
      if (contexto.current !== id || pedido !== leitura.current) return;
      setOnboarding(atual => atual?.id === id && r?.onboarding?.versao >= atual.versao ? r.onboarding : atual);
    } catch (e) {
      if (contexto.current === id && pedido === leitura.current) setAviso(origem === 'polling'
        ? `Não foi possível atualizar as evidências. Os dados anteriores foram preservados. ${e.message}`
        : `A ação foi salva, mas as evidências não puderam ser atualizadas. ${e.message}`);
    }
  }

  const carregar = useCallback(async () => {
    const pedido = ++leitura.current;
    setCarregando(true);
    try {
      const r = await api.getOnboarding(onboardingId);
      if (pedido !== leitura.current || contexto.current !== onboardingId) return;
      setOnboarding(r?.onboarding || r);
      setErro(null);
    } catch (e) {
      if (pedido === leitura.current) setErro(e);
    } finally {
      if (pedido === leitura.current) setCarregando(false);
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

  function aplicarEtapaSalva(salva, id) {
    if (!salva || contexto.current !== id) return;
    leitura.current++;
    setOnboarding(atual => atual?.id !== id || salva.versao < atual.versao ? atual : {
      ...atual, ...salva,
      // O comando retorna a ficha persistida, sem projeções. Conservar as provas
      // já exibidas mesmo se a releitura complementar falhar.
      etapas: (salva.etapas || atual.etapas || []).map(etapa => ({
        ...etapa, evidencias: etapa.evidencias ?? atual.etapas?.find(e => e.id === etapa.id)?.evidencias,
      })),
    });
  }

  async function alternarEtapa(etapa, concluida) {
    setOcupada(true);
    try {
      const r = await api.salvarEtapaOnboarding(onboarding.id, etapa.id, { concluida });
      aplicarEtapaSalva(r?.onboarding, onboarding.id);
      await atualizarEvidencias();
    } catch (e) {
      if (contexto.current === onboardingId) setAviso(e.message);
    } finally {
      if (contexto.current === onboardingId) setOcupada(false);
    }
  }

  async function salvarObservacao(etapa, observacao) {
    setOcupada(true);
    try {
      const r = await api.salvarEtapaOnboarding(onboarding.id, etapa.id, { observacao });
      aplicarEtapaSalva(r?.onboarding, onboarding.id);
      await atualizarEvidencias();
    } catch (e) {
      if (contexto.current === onboardingId) setAviso(e.message);
    } finally {
      if (contexto.current === onboardingId) setOcupada(false);
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

  async function vincular(portalClientId, cnpjDefinitivo, contratacao = {}) {
    if (!portalClientId) return;
    setErroConversao(null);
    try {
      await api.converterOnboarding(onboarding.id, { vincularPortalClientId: portalClientId, cnpjDefinitivo, ...contratacao });
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
  const areas = [...(temComercial ? [["comercial", "Atendimento comercial"]] : []), ["dados", "Dados do cliente"], ["implantacao", onboarding.origem === "PESSOA_FISICA" ? "Execução do serviço" : "Implantação"]];
  const pendentes = (onboarding.etapas || []).filter(etapa => !etapaSatisfeita(etapa));
  const proximaEtapa = pendentes.find(etapa => etapa.obrigatoria) || pendentes[0];

  return (
    <PageShell
      title={nomeDaOportunidade(onboarding)}
      subtitle={`${tituloDaOrigem(onboarding.origem)}${onboarding.cnpj ? ` · ${formatarCnpj(onboarding.cnpj)}` : ""}`}
      headerExtra={<span className="onboarding-help" aria-label="Etapa comercial">Jornada: {onboarding.comercial?.titulo || 'Indisponível'}</span>}
      onBack={voltar}
      backLabel="Entrada de clientes"
      actions={
        <div className="onboarding-actions">
          {conversaVinculada?.onboardingId === onboardingId && conversaVinculada.id && <Button variant="secondary" size="sm" onClick={voltarAoChat}>Voltar ao chat</Button>}
          <Button variant="secondary" size="sm" disabled={ocupada || editando} onClick={atualizarFicha}>Atualizar ficha</Button>
          <span
            style={{ ...estiloDoStatus(onboarding.status), padding: "2px 10px", borderRadius: 999, borderWidth: 1, borderStyle: "solid", fontSize: 12, fontWeight: 600 }}
          >
            <span aria-hidden="true">{status.icone}</span> Ficha: {status.rotulo}
          </span>
          {!encerrado && !editando && (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={() => { setEditando(true); setAreaEscolhida({ id: onboarding.id, area: "dados" }); }}>
                Editar ficha
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={marcarDesistencia}>
                Desistiu
              </Button>
              {onboarding.origem !== "PESSOA_FISICA" && <Button type="button" variant="secondary" size="sm" onClick={() => setModalAberto(true)}>
                Adicionar à carteira
              </Button>}
            </>
          )}
          {!editando && <NovaDemanda api={api} onboarding={onboarding} onAbrir={id => sair(() => onAbrirAtendimento?.(id))} />}
          {convertido && onboarding.portalClientId && (
            <Button type="button" size="sm" onClick={() => sair(() => onAbrirEmpresa?.(onboarding.portalClientId))}>
              Abrir a empresa
            </Button>
          )}
        </div>
      }
      contentClassName="onboarding-workspace"
      contentStyle={{ maxWidth: "var(--content-max)", margin: "0 auto", width: "100%" }}
    >
      {aviso && editando && <p role="alert">{aviso}</p>}
      {(onboarding.demandasRelacionadas || []).length > 0 && <details className="onboarding-panel"><summary>Outros serviços deste contato</summary>{onboarding.demandasRelacionadas.map(d => <p key={d.id}><a href={`/onboardings/${encodeURIComponent(d.id)}`}>{d.anterior ? "Atendimento anterior" : "Serviço relacionado"} · {tituloDaOrigem(d.origem)}</a></p>)}</details>}
      <div hidden={editando}>{api.comercial && !encerrado && <AcompanhamentoComercial key={onboarding.id} api={api} onboarding={onboarding} onAtualizar={atualizarEvidencias} />}</div>
      {editando && <OnboardingWizardPage key={onboarding.id} embedded api={api} onboardingId={onboarding.id} onRegistrarSaida={registrarSaida} onVoltar={continuarAtendimento} onAbrirDetalhe={continuarAtendimento} />}
      <div hidden={editando}>
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
          Empresa na carteira · histórico do atendimento.
        </p>
      )}

      {onboarding.origem !== 'PESSOA_FISICA' && onboarding.portalClientId && <div className="onboarding-panel"><div className="onboarding-actions"><Button variant="secondary" onClick={() => setAreaEscolhida({ id: onboarding.id, area: 'implantacao' })}>Acompanhar implantação</Button><a className="btn btn-secondary btn-md" href={`/companies/${encodeURIComponent(onboarding.portalClientId)}/implantacao`}>Abrir implantação na empresa</a></div></div>}
      <div id="onboarding-area-comercial" className="onboarding-area" hidden={area !== "comercial"}>
        {temComercial && <PainelComercial key={onboarding.id} api={api} onboardingId={onboarding.id} convertido={encerrado} revisao={revisaoComercial} coletaInicial={onboarding.status === "RASCUNHO"} continuar={continuacao} onAtualizar={atualizarEvidencias} />}
      </div>
      <section id="onboarding-area-dados" className="onboarding-area" hidden={area !== "dados"} aria-label="Dados do cliente">
          <h2>Dados declarados</h2>
          <FichaDeclarada
            origem={onboarding.origem}
            dados={onboarding.dados || {}}
            origemPreenchimento={onboarding.origemPreenchimento}
          />
          {onboarding.portalClientId && <Button variant="secondary" onClick={() => sair(() => onAbrirEmpresa?.(onboarding.portalClientId, "documentos"))}>Documentos da empresa</Button>}
      </section>

      <section id="onboarding-area-implantacao" className="onboarding-area" hidden={area !== "implantacao"} aria-label={onboarding.origem === "PESSOA_FISICA" ? "Execução do serviço" : "Implantação"}>
          {!onboarding.portalClientId && <h2>{onboarding.origem === "PESSOA_FISICA" ? "Execução do serviço" : "Implantação"}</h2>}
          {onboarding.comercial?.contratacao?.ganha && !convertido && <p className="onboarding-help">Assinatura conferida: a implantação pode começar. A entrada na carteira tem requisitos próprios e não conclui estas tarefas.</p>}
          {onboarding.comercial?.contratacao?.externa && <details><summary>Contratação externa registrada</summary><p>{onboarding.comercial.contratacao.externa.justificativa}</p><p>{onboarding.comercial.contratacao.externa.evidencia}</p><p>Registrada por {onboarding.comercial.contratacao.externa.atorId} em {onboarding.comercial.contratacao.externa.registradaEm}</p></details>}
          {proximaEtapa && !encerrado && <div className="onboarding-next-step"><small>Próxima pendência da checklist</small><strong>{proximaEtapa.titulo}</strong><span>{pendentes.length} {pendentes.length === 1 ? "etapa pendente" : "etapas pendentes"}</span></div>}
          {!onboarding.etapas?.length && <p className="onboarding-help">Envie a ficha para criar as etapas.</p>}
          {!onboarding.portalClientId && onboarding.etapas?.length > 0 && <ChecklistEtapas
            etapas={onboarding.etapas || []}
            portalClientId={onboarding.portalClientId}
            certificado={certificado}
            ocupada={ocupada || encerrado}
            onAlternar={alternarEtapa}
            onObservacao={salvarObservacao}
            onAcao={executarAcao}
          />}
          {onboarding.portalClientId && <ChecklistImplantacao key={onboarding.portalClientId} api={api} companyId={onboarding.portalClientId} />}
          {onboarding.portalClientId && <details className="onboarding-panel"><summary>Emissão de notas</summary><PreparacaoEmissao key={onboarding.portalClientId} api={api} portalClientId={onboarding.portalClientId} /></details>}
          {onboarding.portalClientId && <div className="onboarding-actions">
            <Button variant="secondary" onClick={() => sair(() => onAbrirEmpresa?.(onboarding.portalClientId, "cadastro"))}>Cadastro da empresa</Button>
            <Button variant="secondary" onClick={() => sair(() => onAbrirEmpresa?.(onboarding.portalClientId, "documentos"))}>Documentos da empresa</Button>
          </div>}
      </section>

      </div>
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
