import { errosConclusaoPessoas } from '@contabilidade/shared/onboarding-dados';
// WIZARD — a ficha de pré-cadastro, preenchida pelo escritório.
//
// ⚠ LARGURA: `--content-max` (leitura/formulário), não `--content-wide`. Linha longa demais em
// formulário cansa; a largura de trabalho é para tela de dados.
//
// O rascunho é salvo antes de navegar e com debounce; ao fechar com pendência há aviso nativo.

import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceEditor } from "../../../app/navigation/WorkspaceNavigation.shared";
import { PageShell } from "../../../components/layout/PageShell";
import { Button } from "../../../components/ui/Button";
import { useConfirmacao } from "../../../components/ui/useConfirmacao";
import { CampoOnboarding } from "../components/CampoOnboarding";
import { ConsultaCnpjOnboarding } from "../components/ConsultaCnpjOnboarding";
import { useConsultaCnpjOnboarding } from "../hooks/useConsultaCnpjOnboarding";
import { PassoOrigem } from "../components/PassoOrigem";
import { PassoRevisao, FichaDeclarada } from "../components/PassoRevisao";
import { TrilhaPassos } from "../components/TrilhaPassos";
import { useOnboardingRascunho } from "../hooks/useOnboardingRascunho";

import {
  ONBOARDING_ORIGENS,
  camposDoPasso,
  passosVisiveis,
  problemasDoPasso,
} from "../lib/onboardingSpec";
import { validarPasso } from "../lib/onboardingZod";

const ROTULO_SALVAMENTO = {
  salvo: "rascunho salvo",
  salvando: "salvando…",
  pendente: "alterações não salvas",
  erro: "falha ao salvar",
};

export function OnboardingWizardPage({ api, onboardingId, onVoltar, onAbrirDetalhe, embedded = false, onRegistrarSaida }) {
  const { pedir: confirmar, dialogo: confirmacao } = useConfirmacao();
  const rascunho = useOnboardingRascunho({ api, onboardingId });
  const { onboarding, dados, estadoSalvamento, salvarAgora } = rascunho;
  const workspace = useWorkspaceEditor(rascunho.editor);
  const activeAction = useMemo(() => ({ current: false }), [rascunho.editor.context]);
  const origem = onboarding?.origem || null;
  const recovery = rascunho.recuperacao;
  const [recoveryError, setRecoveryError] = useState(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const saveLabel = useRef(null);
  const checked = recovery?.conferido;
  const staleCheck = !checked || checked.edit !== recovery?.edit;
  const changedContext = checked && (checked.record.origem !== origem || !checked.record.status || checked.record.status !== onboarding?.status);
  async function escolherRecuperacao(keep) {
    if (recoveryBusy || !recovery || staleCheck) return;
    setRecoveryBusy(true); setRecoveryError(null);
    try {
      const record = await (keep ? recovery.manterEdicao(checked) : recovery.usarRemoto(checked));
      if (!rascunho.isCurrent()) return;
      if (!keep) { setPasso(record.ultimoPasso || 'origem'); setErrosDoPasso({}); }
      saveLabel.current?.focus();
    } catch (error) { if (rascunho.isCurrent()) setRecoveryError(error); }
    finally { if (rascunho.isCurrent()) setRecoveryBusy(false); }
  }

  const [passo, setPasso] = useState("origem");
  const [errosDoPasso, setErrosDoPasso] = useState({});
  const cnpj = useConsultaCnpjOnboarding({ contexto: onboardingId, origem, dados, alterarCampo: rascunho.alterarCampo, habilitado: !rascunho.carregando });
  const [finalizando, setFinalizando] = useState(false);
  const [navegando, setNavegando] = useState(false);
  useEffect(() => {
    setPasso('origem'); setErrosDoPasso({}); setFinalizando(false); setNavegando(false); setRecoveryError(null); setRecoveryBusy(false);
  }, [rascunho.editor.context]);
  useEffect(() => {
    if (workspace) return undefined;
    onRegistrarSaida?.(() => salvarAgora({ ultimoPasso: passo }));
    return () => onRegistrarSaida?.(null);
  }, [onRegistrarSaida, salvarAgora, passo, workspace]);

  useEffect(() => {
    if (workspace) return undefined;
    const proteger = event => event.detail.push(() => salvarAgora({ ultimoPasso: passo }));
    window.addEventListener('altan:onboarding-antes-de-navegar', proteger);
    return () => window.removeEventListener('altan:onboarding-antes-de-navegar', proteger);
  }, [salvarAgora, passo, workspace]);

  // Reabre onde o preenchimento parou — é para isso que `ultimoPasso` existe.
  useEffect(() => {
    if (onboarding && passo === "origem" && onboarding.ultimoPasso) {
      setPasso(onboarding.ultimoPasso);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarding?.id]);

  const passos = useMemo(() => passosVisiveis(origem), [origem]);

  const pendenciasPorPasso = useMemo(() => {
    const out = {};
    for (const p of passos) {
      if (p.chave === "origem") continue;
      out[p.chave] = problemasDoPasso(origem, p.chave, dados).length;
    }
    return out;
  }, [passos, origem, dados]);

  const indice = passos.findIndex((p) => p.chave === passo);
  const ehUltimo = indice === passos.length - 1;

  async function irPara(destino) {
    if (navegando || activeAction.current || !rascunho.isCurrent() || rascunho.editor.context.suspended) return;
    activeAction.current = true;
    setNavegando(true);
    try {
      if (origem) await rascunho.salvarAgora({ ultimoPasso: destino });
      if (!rascunho.isCurrent() || rascunho.editor.context.suspended) return;
      setErrosDoPasso({});
      setPasso(destino);
    } catch { /* Mantém passo e campos para nova tentativa. */ }
    finally { activeAction.current = false; if (rascunho.isCurrent()) setNavegando(false); }
  }

  async function salvarEVoltar() {
    if (workspace) { workspace.confirmarSaida(() => onVoltar?.()); return; }
    if (navegando || activeAction.current || !rascunho.isCurrent() || rascunho.editor.context.suspended) return;
    setNavegando(true);
    try {
      await rascunho.salvarAgora({ ultimoPasso: passo });
      if (rascunho.isCurrent()) onVoltar?.();
    } catch { /* A mensagem persistente explica por que a página continua aberta. */ }
    finally { setNavegando(false); }
  }

  async function avancar() {
    if (passo !== "origem") {
      // A validação ACENDE o campo, não bloqueia: o funil aceita preenchimento parcial por
      // definição. Bloquear aqui transformaria "cliente que ainda não mandou o documento" em
      // "ficha que não pode ser salva".
      const { erros } = validarPasso(origem, dados, passo);
      setErrosDoPasso(erros);
    }
    const proximo = passos[Math.min(indice + 1, passos.length - 1)];
    await irPara(proximo.chave);
  }

  async function escolherOrigem(nova) {
    if (activeAction.current || navegando || !rascunho.isCurrent() || rascunho.editor.context.suspended) return;
    activeAction.current = true;
    try {
    if (!origem) {
      await rascunho.trocarOrigem(nova);
      activeAction.current = false;
      await irPara("identificacao");
      return;
    }
    if (nova === origem) {
      activeAction.current = false;
      await irPara("identificacao");
      return;
    }
    // ⚠ Confirmação NOMEANDO o que se perde — no espírito do EmitirNfseWizard. As perguntas de
    // cada origem são diferentes, então trocar zera o rascunho (e o servidor zera também).
    const preenchidos = Object.entries(dados).filter(([, v]) =>
      Array.isArray(v) ? v.length > 0 : v !== null && String(v ?? "").trim() !== ""
    ).length;
    const nomeNova = ONBOARDING_ORIGENS.find((o) => o.chave === nova)?.titulo || nova;
    if (preenchidos > 0) {
      const ok = await confirmar({ titulo: "Trocar origem do onboarding", texto: `Trocar para “${nomeNova}” apaga ${preenchidos} campo(s) preenchido(s) nesta ficha, porque cada origem faz perguntas diferentes.`, acao: "Trocar e limpar ficha", perigo: true });
      if (!ok || !rascunho.isCurrent() || rascunho.editor.context.suspended) return;
    }
    await rascunho.trocarOrigem(nova);
    activeAction.current = false;
    await irPara("identificacao");
    } catch { /* A falha persistente do rascunho mantém a ficha aberta. */ }
    finally { activeAction.current = false; }
  }

  async function finalizar() {
    if (activeAction.current || navegando || !rascunho.isCurrent() || rascunho.editor.context.suspended) return;
    const erros = origem === "PESSOA_FISICA" ? {} : errosConclusaoPessoas(dados);
    if (Object.keys(erros).length) { await irPara("identificacao"); setErrosDoPasso(erros); return; }
    activeAction.current = true;
    setFinalizando(true);
    try {
      const registro = await rascunho.finalizar();
      if (rascunho.isCurrent() && !rascunho.editor.context.suspended) await onAbrirDetalhe?.(registro?.id || onboardingId);
    } catch {
      // o estado de erro já aparece no selo de salvamento
    } finally {
      activeAction.current = false;
      if (rascunho.isCurrent()) setFinalizando(false);
    }
  }

  if (rascunho.carregando) {
    return (
      <PageShell title="Novo onboarding" onBack={onVoltar}>
        <p style={{ color: "var(--text-muted)" }}>Carregando…</p>
      </PageShell>
    );
  }

  if (rascunho.erro && !onboarding) {
    return (
      <PageShell title="Novo onboarding" onBack={onVoltar}>
        <p style={{ color: "var(--state-warn)" }}>{rascunho.erro.message}</p>
      </PageShell>
    );
  }

  const campos = origem && passo !== "origem" && passo !== "revisao"
    ? camposDoPasso(origem, passo, dados)
    : [];

  const Shell = embedded ? EmbeddedShell : PageShell;
  return (
    <Shell
      title="Novo onboarding"
      subtitle={onboarding?.razaoSocial || "Ficha de pré-cadastro"}
      onBack={salvarEVoltar}
      backLabel="Onboardings"
      actions={
        <span ref={saveLabel} tabIndex={-1} style={{ fontSize: 12, color: estadoSalvamento === "erro" ? "var(--state-warn)" : "var(--text-faint)" }}>
          {ROTULO_SALVAMENTO[estadoSalvamento]}
        </span>
      }
      contentClassName="onboarding-workspace onboarding-wizard"
      contentStyle={{ maxWidth: "var(--content-max)", margin: "0 auto", width: "100%" }}
    >
      {estadoSalvamento === "erro" && <p role="alert" style={{ color: "var(--state-warn)" }}>Não foi possível confirmar o salvamento. Seus campos continuam nesta tela. {recovery ? 'Confira os dados vigentes antes de escolher como continuar.' : 'Corrija os dados e tente novamente antes de sair.'} {rascunho.erro?.message}</p>}
      {recovery && <section aria-label="Conferir salvamento incerto" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <p>A resposta da tentativa na versão {recovery.tentativa?.revision} não foi confirmada. Consultar a ficha não comprova quem gravou nem repete conclusão ou troca de origem.</p>
        <Button className="onboarding-recovery-action" type="button" variant="secondary" disabled={recovery.conferindo || recoveryBusy} onClick={() => { setRecoveryError(null); recovery.conferirRemoto(); }}>
          {recovery.conferindo ? 'Conferindo…' : 'Conferir dados vigentes'}
        </Button>
        {(recovery.erro || recoveryError) && <p role="alert">{(recovery.erro || recoveryError).message} Sua edição local foi preservada.</p>}
        {checked && <>
          <p>Dados consultados: versão {checked.record.versao} · origem {checked.record.origem} · situação {checked.record.status || 'não informada'}.</p>
          <details><summary>Ver dados vigentes</summary><FichaDeclarada origem={checked.record.origem} dados={checked.record.dados} origemPreenchimento={checked.record.origemPreenchimento} compacta /></details>
          <details><summary>Ver minha edição local</summary><FichaDeclarada origem={origem} dados={dados} origemPreenchimento={onboarding?.origemPreenchimento} compacta /></details>
          {staleCheck && <p role="status">A edição mudou desde a consulta. Confira novamente antes de escolher.</p>}
          {changedContext && <p>A origem ou a situação mudou. Não enviaremos sua edição sobre esse contexto diferente. Confira os dados antes de descartar a edição local.</p>}
          <p>Usar os dados vigentes descarta apenas a edição nesta tela, sem gravar. Manter minha edição envia somente um novo rascunho com a versão consultada; outra alteração pode causar conflito.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <Button className="onboarding-recovery-action" type="button" variant="secondary" disabled={staleCheck || recoveryBusy || recovery.conferindo} onClick={() => escolherRecuperacao(false)}>Usar dados vigentes e descartar edição local</Button>
            <Button className="onboarding-recovery-action" type="button" disabled={staleCheck || changedContext || recoveryBusy || recovery.conferindo} onClick={() => escolherRecuperacao(true)}>Manter minha edição e salvar novo rascunho</Button>
          </div>
        </>}
      </section>}
      <TrilhaPassos
        passos={passos}
        passoAtual={passo}
        pendenciasPorPasso={pendenciasPorPasso}
        onIr={irPara}
      />

      {passo === "origem" && <PassoOrigem origem={origem} onEscolher={escolherOrigem} />}

      {passo === "revisao" && origem && (
        <PassoRevisao
          origem={origem}
          dados={dados}
          origemPreenchimento={onboarding?.origemPreenchimento}
          onIrPara={irPara}
        />
      )}

      {campos.length > 0 && (
        <div>
          {passo === "identificacao" && <ConsultaCnpjOnboarding consulta={cnpj.consulta} carregando={cnpj.carregando} cadastro={dados.cadastroCnpj} />}

          {campos.map((descritor) => (
            <CampoOnboarding
              key={`${descritor.passo}-${descritor.campo}`}
              descritor={descritor}
              dados={dados}
              valor={dados[descritor.campo]}
              erro={errosDoPasso[descritor.campo]}
              origemPreenchimento={onboarding?.origemPreenchimento}
              onChange={(valor) => cnpj.editar(descritor.campo, valor)}
              onAdequarPessoas={cnpj.adequarPessoas}
              acaoExtra={
                descritor.consultaReceita ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={cnpj.consultar}
                    disabled={cnpj.carregando || !cnpj.permitido}
                  >
                    Consultar novamente
                  </Button>
                ) : null
              }
            />
          ))}
        </div>
      )}

      <div
        className="onboarding-wizard__actions"
        style={{
          display: "flex", flexWrap: "wrap", gap: "var(--space-2)", justifyContent: "space-between",
          marginTop: "var(--space-6)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border)",
        }}
      >
        <Button
          type="button"
          variant="secondary"
          disabled={indice <= 0 || navegando || finalizando}
          onClick={() => irPara(passos[Math.max(indice - 1, 0)].chave)}
        >
          Voltar
        </Button>

        {ehUltimo ? (
          <Button type="button" onClick={finalizar} disabled={finalizando || navegando || !origem}>
            {finalizando ? "finalizando…" : "Salvar e continuar atendimento"}
          </Button>
        ) : (
          <Button type="button" onClick={avancar} disabled={!origem || navegando || finalizando}>
            Avançar
          </Button>
        )}
      </div>
      {confirmacao}
    </Shell>
  );
}

function EmbeddedShell({ children, actions }) {
  return <div className="onboarding-wizard">
    <div style={{ marginBottom: 'var(--space-2)' }}>{actions}</div>
    {children}
  </div>;
}

export default OnboardingWizardPage;
