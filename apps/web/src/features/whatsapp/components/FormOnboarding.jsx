import { AtendimentoComercial } from "./AtendimentoComercial";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { dadosDoInteressado, fraseDoOnboarding, onboardingDaConversa } from "../lib/onboardingDaConversa";

const ORIGENS = [{ id: "ABERTURA", nome: "Abertura" }, { id: "TRANSFERENCIA", nome: "Transferência" }, { id: "INATIVA", nome: "Empresa inativa" }];
let proximoContexto = 0;
const criacoes = new WeakMap();
export function FormOnboarding(props) {
  const sessao = props.api?.getAccessToken?.() || null;
  const contexto = useMemo(() => ++proximoContexto, [props.api, sessao, props.conversa?.id]);
  return <FormOnboardingContexto key={contexto} {...props} sessao={sessao} />;
}
function FormOnboardingContexto({ sessao, api, conversa, mensagens = [], leitura, onCriado, slotEmpresa = null, canalDeEnvio = null }) {
  let cache = criacoes.get(api);
  if (!cache || cache.sessao !== sessao) { cache = { sessao, itens: new Map() }; criacoes.set(api, cache); }
  const chave = conversa?.id;
  if (!cache.itens.has(chave)) cache.itens.set(chave, { registro: null, incerta: false, emCurso: false, listeners: new Set() });
  const tentativa = cache.itens.get(chave);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const vigente = useCallback(() => vivo.current && (api?.getAccessToken?.() || null) === sessao, [api, sessao]);
  const [origem, setOrigem] = useState(tentativa.registro?.origem || tentativa.origem || null);
  const [ocupado, setOcupado] = useState(tentativa.emCurso);
  const [erro, setErro] = useState(null);
  const [criado, setCriado] = useState(null);
  const [existente, setExistente] = useState(null);
  const [criacaoIncerta, setCriacaoIncerta] = useState(tentativa.incerta);
  const registro = useRef(tentativa.registro);
  const emCurso = useRef(false);
  useEffect(() => {
    const atualizar = () => { if (!vigente()) return; registro.current = tentativa.registro; setCriacaoIncerta(tentativa.incerta); setOcupado(tentativa.emCurso); };
    tentativa.listeners.add(atualizar);
    return () => tentativa.listeners.delete(atualizar);
  }, [tentativa, vigente]);
  const dados = dadosDoInteressado(conversa);
  // A janela consulta o histórico completo; a página pode conter só as últimas 200 mensagens.
  const recebeu = ["ABERTA", "EXPIRADA"].includes(conversa?.janela?.situacao) || mensagens.some((m) => m.direcao === "in");
  const atual = existente || leitura;
  const semFicha = atual?.situacao === "SEM_ONBOARDING";
  const motivo = !recebeu ? "Só é possível iniciar o onboarding de quem já escreveu."
    : atual?.situacao === "DESCONHECIDO" ? "Confira os onboardings antes de criar uma ficha."
      : null;

  async function criar() {
    if (!vigente() || emCurso.current || tentativa.emCurso || tentativa.incerta || criacaoIncerta || !dados || !origem || !recebeu || (!semFicha && !registro.current)) return;
    emCurso.current = true; tentativa.emCurso = true; setOcupado(true); setErro(null);
    try {
      if (!registro.current) {
        // Releitura antes de criar evita duplicar uma ficha surgida desde a última atualização.
        const lista = await api.listarOnboardings({ incluirRascunhos: true });
        if (!vigente()) return;
        if (!Array.isArray(lista?.itens)) throw new Error("Não foi possível conferir os onboardings.");
        const conferida = onboardingDaConversa(conversa, lista.itens);
        if (conferida.situacao !== "SEM_ONBOARDING") { setExistente(conferida); return; }
        // O POST pode ter persistido mesmo se a resposta se perder. Sem id não há
        // retentativa segura: o rascunho ainda não tem telefone para a releitura casar.
        tentativa.origem = origem; tentativa.incerta = true; setCriacaoIncerta(true);
        const r = await api.criarOnboarding(origem);
        if (!r?.onboarding?.id) throw new Error("Não foi possível confirmar a criação. Confira a lista de onboardings antes de tentar novamente.");
        tentativa.registro = r.onboarding; tentativa.incerta = false;
        if (!vigente()) return;
        registro.current = r.onboarding;
        setCriacaoIncerta(false);
      } else {
        // O rascunho pode ter sido completado noutra aba depois da falha.
        // PATCH substitui dados: não apagar o que alguém já preencheu.
        const atualizada = await api.getOnboarding(registro.current.id);
        if (!vigente()) return;
        if (atualizada?.onboarding?.id !== registro.current.id) throw new Error("Não foi possível conferir o rascunho antes de tentar novamente.");
        const ficha = atualizada.onboarding;
        if (!Number.isInteger(ficha.versao)) throw new Error("Não foi possível conferir a revisão do rascunho. Abra a ficha antes de continuar.");
        registro.current = ficha; tentativa.registro = ficha;
        if (Object.keys(ficha.dados || {}).length || (ficha.status && ficha.status !== "RASCUNHO")) {
          setCriado(ficha);
          onCriado?.();
          return;
        }
      }
      // Se o PATCH falhar, a próxima tentativa usa este MESMO id, sem criar outra ficha.
      if (!Number.isInteger(registro.current.versao)) throw new Error("Não foi possível conferir a revisão do rascunho. Abra a ficha antes de continuar.");
      const revisaoEnviada = registro.current.versao;
      const r = await api.salvarOnboarding(registro.current.id, { dados, versao: revisaoEnviada });
      if (r?.onboarding?.id !== registro.current.id || !Number.isInteger(r.onboarding.versao) || r.onboarding.versao <= revisaoEnviada) throw new Error("Não foi possível confirmar o preenchimento da ficha.");
      tentativa.registro = r.onboarding;
      if (!vigente()) return;
      setCriado(r.onboarding);
      onCriado?.();
    } catch (err) { if (vigente()) setErro(err?.message || "Não foi possível criar o onboarding."); }
    finally { emCurso.current = false; tentativa.emCurso = false; tentativa.listeners.forEach(fn => fn()); }
  }
  if (api.comercial && conversa.capacidades?.podeCriarCasoComercial !== false) return <AtendimentoComercial api={api} conversa={conversa} onCriado={onCriado} candidatos={leitura?.candidatos || []} slotEmpresa={slotEmpresa} canalDeEnvio={canalDeEnvio} />;
  if (!dados) return null;
  const frase = fraseDoOnboarding(atual);
  return <section data-testid="form-onboarding" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12, marginBottom: 12 }}>
    <strong>Interessado em contratar o escritório</strong>
    <p style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>O telefone vem desta conversa. O nome inicial vem do perfil do WhatsApp e pode ser corrigido na ficha.</p>
    {criado ? <p role="status">Onboarding {criado.origem} · {criado.status}. <a href={`/onboardings/${encodeURIComponent(criado.id)}${criado.status === "RASCUNHO" ? "/editar" : ""}`}>{criado.status === "RASCUNHO" ? "Completar a ficha" : "Abrir a ficha"}</a>. A conversa continua sem empresa até o cadastro ser vinculado.</p> : <>
      {frase ? <p role="status">{frase}</p> : null}
      {(atual?.candidatos || []).map((c) => <p key={c.id}><a href={`/onboardings/${encodeURIComponent(c.id)}${c.status === "RASCUNHO" ? "/editar" : ""}`}>Abrir onboarding {c.origem} · {c.status}</a> — {c.confianca === "EXATO" ? "telefone exato" : "possível correspondência"}</p>)}
      {criacaoIncerta ? <p role="status">{ocupado ? "Salvando…" : <>A criação não foi confirmada. <a href="/onboardings">Confira os rascunhos na lista de onboardings</a> antes de iniciar outra ficha.</>}</p> : null}
      {!criacaoIncerta && (semFicha || registro.current) ? <>
        <p style={{ fontSize: "0.8rem" }}>Qual é o motivo do atendimento?</p>
        <div role="group" aria-label="Origem do onboarding" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ORIGENS.map((o) => <Button key={o.id} variant={origem === o.id ? "primary" : "secondary"} aria-pressed={origem === o.id} disabled={ocupado || Boolean(registro.current)} onClick={() => setOrigem(o.id)}>{o.nome}</Button>)}
        </div>
        <Button style={{ marginTop: 8 }} disabled={ocupado || !origem || !recebeu} onClick={criar}>{ocupado ? "Salvando…" : registro.current ? "Tentar preencher a ficha novamente" : "Virar onboarding"}</Button>
      </> : null}
      {motivo ? <p role="status">{motivo}</p> : null}
      {erro ? <p role="alert">{erro}{registro.current ? <> <a href={`/onboardings/${encodeURIComponent(registro.current.id)}/editar`}>Abrir o rascunho criado</a></> : null}</p> : null}
    </>}
    {!criado && slotEmpresa}
  </section>;
}
