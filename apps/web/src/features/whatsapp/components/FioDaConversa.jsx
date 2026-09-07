// O FIO ABERTO — cabeçalho, balões e compositor. Extraído de `pages/renderWhatsappPage.jsx` em
// 06/09/2026 porque ganhou um SEGUNDO consumidor concreto: a mesma conversa dentro da empresa,
// ao lado das Anotações (F2). Extrair antes do segundo consumidor seria abstração sem caso.
//
// ⚠ `LinhaConversa` e `FormVincular` FICARAM na página, e por motivo: dentro da empresa a linha
// mostraria o nome da empresa em cada item (ruído — todas são a mesma), e o vínculo não existe lá
// (ali `portalClientId` nunca é nulo). Por isso o vínculo entra por `slotVincular`: quem tem a fila
// passa o formulário; a aba da empresa simplesmente não passa nada.
//
// ⚠⚠ A IDENTIDADE SÃO DUAS PERGUNTAS — *quem* está falando e *de qual empresa* —, e uma não
// substitui a outra. Ver `identidadeDaConversa` em `../lib/conversasTela.js`.

import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { AvatarConversa, SituacaoConversa, WhatsappIcon } from "./ConversaVisual";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { formatarCnpj } from "../../onboarding/lib/brasilApi";
import {
  SITUACAO_FIO,
  situacaoDoFio,
  rotuloDoAutor,
  estadoDaResposta,
  fmtDataHora,
  identidadeDaConversa,
  descricaoDaMidia,
  frasePaginacao,
  estadoDaMensagem,
} from "../lib/conversasTela";

export const campo = {
  background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)",
  padding: "8px 10px", fontSize: "0.86rem", fontFamily: "inherit", boxSizing: "border-box", width: "100%",
};
export const COR_TOM = { aviso: "var(--state-warn)", neutro: "var(--text-muted)" };

/**
 * A empresa da conversa, em UMA linha — razão social + CNPJ.
 *
 * ⚠ Sem empresa a frase é a do estado da fila (*"sem empresa — número novo"*), em âmbar, porque é
 * pendência do escritório. Ela nunca some: linha em branco se lê como "não tem nada a dizer".
 */
export function LinhaDaEmpresa({ identidade, tamanho = "0.74rem" }) {
  return (
    <span
      data-testid="empresa-da-conversa"
      data-sem-empresa={identidade.semEmpresa ? "sim" : "nao"}
      style={{ fontSize: tamanho, color: identidade.semEmpresa ? "var(--state-warn)" : "var(--text-muted)" }}
    >
      {identidade.linhaDaEmpresa}
      {identidade.cnpj ? ` · ${formatarCnpj(identidade.cnpj)}` : ""}
    </span>
  );
}

/**
 * Quem está falando. ⚠ `avisoDoNome` acompanha o nome que NÃO veio do cadastro — o do perfil é o
 * que a própria pessoa escreveu no aparelho dela, e a tela precisa poder dizer isso.
 */
export function NomeDaPessoa({ identidade, tamanho = "0.88rem" }) {
  return (
    <>
      <strong data-testid="pessoa-da-conversa" data-origem={identidade.origemDoNome} style={{ fontSize: tamanho }}>
        {identidade.pessoa}
      </strong>
      {identidade.papel ? <span style={{ fontSize: "0.7rem", color: "var(--text-faint)" }}>{identidade.papel}</span> : null}
      {identidade.avisoDoNome ? (
        <span data-testid="aviso-do-nome" style={{ fontSize: "0.68rem", color: "var(--text-faint)" }}>({identidade.avisoDoNome})</span>
      ) : null}
    </>
  );
}

export function FioDaConversa({ fio, hook, slotVincular = null, temMais = null, slotAcoes = null, hrefDaEmpresa = null, onVoltar = null, onDetalhes = null, detalhesAbertos = false }) {
  const { conversa, mensagens } = fio;
  const [texto, setTexto] = useState(() => hook.rascunhosRef?.current.get(conversa.id) || "");
  const textoRef = useRef(texto);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [movendo, setMovendo] = useState(false);
  const movendoRef = useRef(false);
  const [recusa, setRecusa] = useState(null);
  const [novas, setNovas] = useState(false);
  const historicoRef = useRef(null);
  const fioRef = useRef(null);
  const leituraRef = useRef(null);
  const pertoDoFim = useRef(true);
  const enviandoRef = useRef(false);
  const situacao = situacaoDoFio(conversa);
  const naLixeira = situacao === SITUACAO_FIO.LIXEIRA;
  const historico = situacao === SITUACAO_FIO.HISTORICO;
  const somenteLeitura = naLixeira || historico;
  const resposta = estadoDaResposta(conversa);
  const identidade = identidadeDaConversa(conversa);
  const nomeDoCliente = conversa?.contato?.nome || conversa?.nomePerfilProvedor || null;
  const avisoDePaginacao = frasePaginacao(temMais);

  useLayoutEffect(() => {
    if (onVoltar && window.matchMedia?.("(max-width: 760px)").matches) fioRef.current?.focus();
  }, [conversa.id]);

  useEffect(() => {
    const el = historicoRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (pertoDoFim.current) el.scrollTop = el.scrollHeight;
      if (leituraRef.current) Object.assign(leituraRef.current, { altura: el.scrollHeight, top: el.scrollTop });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = historicoRef.current;
    if (!el) return;
    const antes = leituraRef.current;
    const primeiro = mensagens[0]?.id;
    const ultimo = mensagens.at(-1)?.id;
    if (!antes) el.scrollTop = el.scrollHeight;
    else if (primeiro !== antes.primeiro && ultimo === antes.ultimo) el.scrollTop = antes.top + el.scrollHeight - antes.altura;
    else if (ultimo !== antes.ultimo) {
      if (pertoDoFim.current) el.scrollTop = el.scrollHeight;
      else setNovas(true);
    }
    leituraRef.current = { primeiro, ultimo, altura: el.scrollHeight, top: el.scrollTop };
  }, [mensagens]);

  function acompanharLeitura() {
    const el = historicoRef.current;
    pertoDoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (leituraRef.current) leituraRef.current.top = el.scrollTop;
    if (pertoDoFim.current) setNovas(false);
  }

  function mudarTexto(valor) {
    textoRef.current = valor;
    hook.rascunhosRef?.current.set(conversa.id, valor);
    setTexto(valor);
  }
  async function mover(restaurar = false) {
    if (movendoRef.current || hook.ocupado) return;
    movendoRef.current = true;
    setMovendo(true);
    try {
      const r = await (restaurar ? hook.restaurar(conversa.id) : hook.excluir(conversa.id));
      if (r && r.ok !== false) setConfirmarExclusao(false);
    } finally { movendoRef.current = false; setMovendo(false); }
  }
  async function enviar() {
    const t = texto.trim();
    if (!t || somenteLeitura || !resposta.pode || hook.ocupado || enviandoRef.current) return;
    enviandoRef.current = true;
    setRecusa(null);
    try {
      const r = await hook.responder(conversa.id, t);
      if (!r || r.ok === false) setRecusa(r?.erro?.payload?.message || r?.erro?.message || "Não foi possível responder.");
      else { if (textoRef.current.trim() === t) mudarTexto(""); pertoDoFim.current = true; }
    } catch (err) { setRecusa(err?.message || "Não foi possível responder."); }
    finally { enviandoRef.current = false; }
  }

  return (
    <div data-testid="fio" className="wa-thread" ref={fioRef} tabIndex={-1} aria-label={`Conversa com ${identidade.pessoa}`}>
      <div className="wa-thread-header">
        {onVoltar ? <Button variant="secondary" size="sm" className="wa-mobile-back" onClick={onVoltar} aria-label="Voltar para conversas"><WhatsappIcon nome="seta" /></Button> : null}
        <AvatarConversa nome={identidade.pessoa} />
        <div className="wa-thread-identity">
          <div className="wa-thread-name"><NomeDaPessoa identidade={identidade} tamanho="1rem" /></div>
          <div className="wa-thread-company"><LinhaDaEmpresa identidade={identidade} /></div>
          <div className="wa-inline"><span style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>{conversa.telefoneMascarado}</span><SituacaoConversa conversa={conversa} /></div>
        </div>
        <div className="wa-thread-actions">
          {hrefDaEmpresa && conversa.portalClientId ? <a data-testid="ir-para-a-empresa" href={hrefDaEmpresa(conversa.portalClientId)}>Abrir a empresa →</a> : null}
          {!somenteLeitura && situacao === SITUACAO_FIO.ASSUMIDA ? (
            <Button variant="secondary" disabled={hook.ocupado || conversa.escopoVerificado === false} onClick={() => hook.devolver(conversa.id)} title="O assistente volta a responder neste fio">Devolver à IA</Button>
          ) : !somenteLeitura && situacao !== SITUACAO_FIO.FILA_SEM_EMPRESA ? (
            <Button variant="primary" disabled={hook.ocupado} onClick={() => hook.assumir(conversa.id)} title="Você responde; o assistente fica em silêncio">Assumir</Button>
          ) : null}
          {naLixeira ? <Button variant="secondary" disabled={hook.ocupado || movendo} onClick={() => mover(true)}>Restaurar chat</Button>
            : typeof hook.excluir === "function" ? <Button variant="secondary" disabled={hook.ocupado || movendo} onClick={() => setConfirmarExclusao(true)}>Excluir chat</Button> : null}
          {onDetalhes ? <Button variant="secondary" size="sm" onClick={onDetalhes} aria-label="Detalhes da conversa" aria-expanded={detalhesAbertos}><WhatsappIcon nome="painel" size={18} /></Button> : null}
        </div>
      </div>
      {naLixeira ? <p role="status" className="wa-notice">Conversa na lixeira. O histórico está preservado para consulta. Restaure para voltar à lista; uma nova mensagem recebida também reabre a conversa.</p>
        : historico ? <p role="status" className="wa-notice">Histórico legado sem vínculo verificado, preservado somente para consulta. As mensagens anteriores não foram apagadas nem misturadas à conversa atual. Para atender este contato, volte a Conversas atuais.</p> : null}
      {conversa.pendencia ? <div data-testid="pendencia-aberta" className="wa-notice">Pedido aguardando confirmação do cliente: <strong>{conversa.pendencia.tipo}</strong> · código <strong>{conversa.pendencia.codigo}</strong> · expira {fmtDataHora(conversa.pendencia.expiraEm)}.</div> : null}
      {!somenteLeitura && (situacao === SITUACAO_FIO.FILA_SEM_EMPRESA || conversa.escopoVerificado === false) ? <div className="wa-thread-setup">{slotVincular || <a href="/whatsapp">Conferir vínculo na caixa de WhatsApp</a>}</div> : null}
      {historico ? <details className="wa-thread-setup"><summary>Verificar vínculo e iniciar conversa atual</summary><p>O vínculo abre um segmento verificado e preserva este histórico anterior.</p>{slotVincular || <a href="/whatsapp">Verificar vínculo na central de WhatsApp, em Histórico anterior</a>}</details> : null}
      <div className="wa-messages" ref={historicoRef} onScroll={acompanharLeitura} aria-label="Histórico de mensagens" tabIndex={0}>
        {avisoDePaginacao ? <p data-testid="aviso-paginacao" className="wa-list-note" style={{ textAlign: "center" }}>{avisoDePaginacao}</p> : null}
        {hook.cursorFio ? <Button variant="secondary" size="sm" disabled={hook.carregandoAnteriores} onClick={hook.carregarAnteriores}>{hook.carregandoAnteriores ? "Carregando…" : "Carregar mensagens anteriores"}</Button> : null}
        {mensagens.length === 0 ? <div className="wa-empty"><WhatsappIcon size={30} /><p>Nenhuma mensagem neste fio.</p></div> : null}
        {mensagens.map((m, index) => {
          const entrada = m.direcao === "in";
          const midia = descricaoDaMidia(m);
          const estado = estadoDaMensagem(m);
          const dia = dataDaMensagem(m);
          const separador = dia && (index === 0 || dia !== dataDaMensagem(mensagens[index - 1]));
          return <div key={m.id}>
            {separador ? <div className="wa-day"><span>{dia}</span></div> : null}
            <div data-testid={`balao-${m.id}`} data-autor={m.autor || (entrada ? "cliente" : "sem-autor")} className={`wa-message-row${entrada ? "" : " wa-message-row--out"}`}>
              <div className="wa-bubble">
                <div className="wa-bubble-author">{rotuloDoAutor(m, { nomeDoCliente })}</div>
                {midia ? <div data-testid="midia-do-balao" className="wa-media"><WhatsappIcon nome="documento" size={20} /><span>{midia.replace(/^📎\s*/, "")}</span></div> : null}
                {m.corpo ? <div className="wa-bubble-text">{m.corpo}</div> : m.tipo === "template" ? <div className="wa-bubble-text">Modelo de mensagem do escritório</div> : null}
                <div className="wa-bubble-footer">
                  <time dateTime={m.ocorridaEmProvedor || m.registradaEm}>{fmtDataHora(m.ocorridaEmProvedor || m.registradaEm)}</time>
                  {estado ? <span data-testid="estado-mensagem" style={{ color: estado.tom === "erro" ? "var(--state-danger)" : estado.tom === "ok" ? "var(--state-ok)" : undefined }}>{estado.texto}</span> : null}
                </div>
              </div>
            </div>
          </div>;
        })}
      </div>
      {novas ? <Button variant="secondary" size="sm" onClick={() => { historicoRef.current.scrollTop = historicoRef.current.scrollHeight; pertoDoFim.current = true; setNovas(false); }}>Ir para mensagens recentes ↓</Button> : null}
      {!somenteLeitura ? <div className="wa-composer">
        {slotAcoes}
        {!resposta.pode ? <p data-testid="resposta-bloqueada" className="wa-list-note" style={{ color: "var(--state-warn)", padding: "0 0 8px" }}>{resposta.motivo}</p> : null}
        <div className="wa-composer-row">
          <textarea aria-label="Responder ao cliente" style={campo} value={texto} onChange={(e) => mudarTexto(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); } }}
            disabled={!resposta.pode || hook.ocupado} placeholder={resposta.pode ? "Escreva uma mensagem para este contato…" : "Resposta indisponível — confira o motivo acima"} />
          <Button variant="primary" disabled={!resposta.pode || !texto.trim() || hook.ocupado} onClick={enviar}><WhatsappIcon nome="enviar" size={17} />Responder</Button>
        </div>
        <div className="wa-composer-hint">Mensagem do escritório · Ctrl + Enter para enviar</div>
        {recusa && !hook.erroAcao ? <p role="alert" className="wa-list-note" style={{ color: "var(--state-danger)" }}>{recusa}</p> : null}
      </div> : null}
      {confirmarExclusao ? <Modal titulo="Mover conversa para lixeira?" tamanho="sm" ocupado={movendo || hook.ocupado} aoFechar={() => setConfirmarExclusao(false)}
        rodape={<><Button variant="secondary" disabled={movendo || hook.ocupado} onClick={() => setConfirmarExclusao(false)}>Cancelar</Button><Button variant="danger" disabled={movendo || hook.ocupado} onClick={() => mover(false)}>Mover para lixeira</Button></>}>
        <p><strong>{identidade.pessoa}</strong> · {conversa.telefoneMascarado}</p>
        <p>{identidade.linhaDaEmpresa}</p>
        <p>O histórico será preservado e poderá ser restaurado. Uma nova mensagem recebida reabre a conversa.</p>
        {hook.erroAcao ? <p role="alert">{hook.erroAcao}</p> : null}
      </Modal> : null}
    </div>
  );
}

function dataDaMensagem(m) {
  const data = new Date(m?.ocorridaEmProvedor || m?.registradaEm);
  return Number.isNaN(data.getTime()) ? "" : data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" });
}

export default FioDaConversa;
