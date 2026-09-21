import { useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { fmtDataHora, rotuloDoAutor, descricaoDaMidia } from "../lib/conversasTela";
import { escoposDeNota } from "../lib/identidadeAtendimento";

/** A fonte fica visível na prévia e acompanha o texto salvo. Nunca usa transporte WhatsApp. */
export function NotaDaMensagem({ conversa, mensagem, hook, aoFechar }) {
  const escopos = escoposDeNota(conversa);
  const [escopoId, setEscopoId] = useState(() => escopos.length === 1 ? escopos[0].id : "");
  const [rascunhos, setRascunhos] = useState({});
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const trava = useRef(false), tentativas = useRef(new Map());
  const escopo = escopos.find(e => e.id === escopoId);
  const texto = rascunhos[escopoId] || "";
  const autor = rotuloDoAutor(mensagem, { nomeDoCliente: conversa.contato?.nome || conversa.nomePerfilProvedor });
  const canal = mensagem.canal?.nome || mensagem.canal?.chave || mensagem.canal?.finalidade;
  const cabecalho = ["Mensagem no WhatsApp", autor, fmtDataHora(mensagem.ocorridaEmProvedor || mensagem.registradaEm), canal]
    .filter(Boolean).map(p => String(p).slice(0, 120)).join(" · ");
  const corpo = String(mensagem.corpo || descricaoDaMidia(mensagem) || "Mensagem sem texto");
  const trecho = corpo.length > 800 ? `${corpo.slice(0, 800)}…` : corpo;
  const indisponivel = !escopo || conversa.capacidades?.notaInterna === false || typeof hook.salvarNota !== "function";

  async function salvar() {
    if (trava.current || hook.ocupado || indisponivel || !texto.trim()) return;
    trava.current = true; setOcupado(true); setErro("");
    const conteudo = `${cabecalho}\n“${trecho}”\n\n${texto.trim()}`;
    const dados = { texto: conteudo, escopo: escopo.escopo,
      ...(escopo.portalClientId ? { portalClientId: escopo.portalClientId } : {}),
      ...(escopo.atendimentoLeadId ? { atendimentoLeadId: escopo.atendimentoLeadId } : {}) };
    const assinatura = JSON.stringify(dados);
    if (!tentativas.current.has(assinatura)) tentativas.current.set(assinatura,
      globalThis.crypto?.randomUUID?.() || `nota-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const r = await hook.salvarNota(conversa.id, { ...dados, chaveIdempotencia: tentativas.current.get(assinatura) });
      if (!r || r.ok === false) throw r?.erro || new Error("A gravação não foi confirmada. Seu rascunho foi preservado.");
      aoFechar();
    } catch (e) { setErro(e?.payload?.message || e.message || "Não foi possível salvar a nota."); }
    finally { trava.current = false; setOcupado(false); }
  }

  return <Modal titulo="Criar nota interna" ocupado={ocupado || hook.ocupado} aoFechar={aoFechar} fecharAoClicarFundo={false}
    rodape={<><Button variant="secondary" disabled={ocupado || hook.ocupado} onClick={aoFechar}>Cancelar</Button>
      <Button variant="primary" disabled={ocupado || hook.ocupado || indisponivel || !texto.trim()} onClick={salvar}>{ocupado ? "Salvando…" : "Salvar nota interna"}</Button></>}>
    <div className="wa-message-note-form">
      <p>Visível apenas à equipe autorizada. Não é enviada ao WhatsApp.</p>
      <div className="wa-message-note-source"><small>{cabecalho}</small><blockquote>{trecho}</blockquote></div>
      <label>Salvar para<select aria-label="Escopo da nota interna" value={escopoId} disabled={ocupado || hook.ocupado} onChange={e => { setEscopoId(e.target.value); setErro(""); }}>
        <option value="">Selecione o caso ou a empresa</option>{escopos.map(e => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
      </select></label>
      <label>Nota<textarea aria-label="Texto da nota interna" value={texto} maxLength={8000} disabled={ocupado || hook.ocupado || !escopo}
        placeholder="O que a equipe precisa saber sobre esta mensagem?" onChange={e => setRascunhos(atuais => ({ ...atuais, [escopoId]: e.target.value }))} /></label>
      {erro && <p role="alert">{erro}</p>}
    </div>
  </Modal>;
}
