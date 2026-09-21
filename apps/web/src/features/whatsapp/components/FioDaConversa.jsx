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

import { CompositorConversa } from "./CompositorConversa";
import { relacionamentoDaConversa, podeAtendimentoComercial } from "../lib/identidadeAtendimento";
import { PainelAtendimento } from "./PainelAtendimento";
import { AtualizacaoAtendimento } from "./AtendimentoComercial";
import { useState, useRef, useLayoutEffect, useEffect, useMemo } from "react";
import { AvatarConversa, SituacaoConversa, SituacaoIdentificacao, WhatsappIcon, CnpjDaConversa } from "./ConversaVisual";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import {
  SITUACAO_FIO,
  situacaoDoFio,
  rotuloDoAutor,
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
const PEDIDOS_PENDENTES = { EMITIR_NFSE: "Emissão de nota", CANCELAR_NFSE: "Cancelamento de nota", RECALCULAR_GUIA: "Atualização de guia" };

/**
 * A empresa da conversa, em UMA linha — razão social + CNPJ.
 *
 * ⚠ Sem empresa a frase é a do estado da fila (*"sem empresa — número novo"*), em âmbar, porque é
 * pendência do escritório. Ela nunca some: linha em branco se lê como "não tem nada a dizer".
 */
export function LinhaDaEmpresa({ identidade, tamanho = "0.74rem", copiarCnpj = true }) {
  return (
    <span
      data-testid="empresa-da-conversa"
      data-sem-empresa={identidade.semEmpresa ? "sim" : "nao"}
      style={{ fontSize: tamanho, color: "var(--text-muted)" }}
    >
      {identidade.linhaDaEmpresa}
      {identidade.cnpj ? <> · <CnpjDaConversa cnpj={identidade.cnpj} empresa={identidade.linhaDaEmpresa} copiavel={copiarCnpj} /></> : null}
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
      <strong data-testid="pessoa-da-conversa" title={[identidade.pessoa, identidade.papel, identidade.avisoDoNome].filter(Boolean).join(" · ")} data-origem={identidade.origemDoNome} style={{ fontSize: tamanho }}>
        {identidade.pessoa}
      </strong>
      {identidade.papel ? <span className="wa-visually-hidden">{identidade.papel}</span> : null}
      {identidade.avisoDoNome ? (
        <span data-testid="aviso-do-nome" className="wa-visually-hidden">({identidade.avisoDoNome})</span>
      ) : null}
    </>
  );
}

export function FioDaConversa({ fio, hook, slotVincular = null, temMais = null, slotAcoes = null, hrefDaEmpresa = null, onVoltar = null, onDetalhes = null, detalhesAbertos = false, onCanalSelecionado = null, atualizacaoComercialExterna = null, usuarioId = null }) {
  const { conversa } = fio;
  const mensagens = useMemo(() => [...fio.mensagens, ...(fio.notasInternas || []).map(n => ({ ...n, id: `nota-${n.id}`, tipo: "nota_interna", corpo: n.texto, registradaEm: n.criadaEm || n.createdAt }))].sort((a,b) => String(a.registradaEm).localeCompare(String(b.registradaEm)) || String(a.id).localeCompare(String(b.id))), [fio.mensagens, fio.notasInternas]);
  const relacionamento = relacionamentoDaConversa(conversa);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [movendo, setMovendo] = useState(false);
  const movendoRef = useRef(false);
  const [escolherEmpresa, setEscolherEmpresa] = useState(false);
  const [revisaoComercial, setRevisaoComercial] = useState(0);
  const atualizacaoComercial = useMemo(() => ({ revisao: revisaoComercial, atualizar: () => setRevisaoComercial(v => v + 1) }), [revisaoComercial]);
  const [novas, setNovas] = useState(false);
  const historicoRef = useRef(null);
  const fioRef = useRef(null);
  const leituraRef = useRef(null);
  const pertoDoFim = useRef(true);
  const situacao = situacaoDoFio(conversa);
  const naLixeira = situacao === SITUACAO_FIO.LIXEIRA;
  const historico = situacao === SITUACAO_FIO.HISTORICO;
  const somenteLeitura = naLixeira || historico;
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

  async function mover(restaurar = false) {
    if (movendoRef.current || hook.ocupado) return;
    movendoRef.current = true;
    setMovendo(true);
    try {
      const r = await (restaurar ? hook.restaurar(conversa.id) : hook.excluir(conversa.id));
      if (r && r.ok !== false) setConfirmarExclusao(false);
    } finally { movendoRef.current = false; setMovendo(false); }
  }
  useEffect(() => {
    const el = historicoRef.current;
    if (!el || detalhesAbertos || typeof IntersectionObserver === "undefined") return;
    const visiveis = new Set();
    const reconhecer = () => {
      if (document.visibilityState === "hidden") return;
      const ultima = fio.mensagens.filter(m => m.direcao === "in" && visiveis.has(m.id)).at(-1);
      if (ultima) hook.marcarLida?.(conversa.id, ultima.id);
    };
    const observer = new IntersectionObserver(entradas => {
      for (const entrada of entradas) {
        const id = entrada.target.dataset.mensagemId;
        if (entrada.isIntersecting && entrada.intersectionRatio > 0) visiveis.add(id); else visiveis.delete(id);
      }
      reconhecer();
    }, { root: el, threshold: 0.01 });
    el.querySelectorAll('[data-mensagem-entrada="true"]').forEach(m => observer.observe(m));
    document.addEventListener("visibilitychange", reconhecer);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", reconhecer); };
  }, [conversa.id, fio.mensagens, hook.marcarLida, detalhesAbertos]);

  return (
    <AtualizacaoAtendimento.Provider value={atualizacaoComercialExterna || atualizacaoComercial}><div data-testid="fio" className="wa-thread" ref={fioRef} tabIndex={-1} aria-label={`Conversa com ${identidade.pessoa}`}>
      <div className="wa-thread-header">
        {onVoltar ? <Button variant="secondary" size="sm" className="wa-mobile-back" onClick={onVoltar} aria-label="Voltar para conversas"><WhatsappIcon nome="seta" /></Button> : null}
        <AvatarConversa nome={identidade.pessoa} />
        <div className="wa-thread-identity">
          <div className="wa-thread-name"><NomeDaPessoa identidade={identidade} tamanho="1rem" /></div>
          <div className="wa-thread-subtitle"><span className="wa-relationship" data-relacionamento={relacionamento.tipo}>{relacionamento.rotulo}</span><SituacaoConversa conversa={conversa} /><SituacaoIdentificacao conversa={conversa} /></div>
          {!conversa.atendimento && <div className="wa-thread-company"><LinhaDaEmpresa identidade={identidade} tamanho=".8125rem" /></div>}
        </div>
        <div className="wa-thread-actions">
          {!somenteLeitura && Boolean(conversa.atendidaPor || conversa.atendidaDesde) ? (
            <Button variant="secondary" disabled={hook.ocupado || (Boolean(conversa.portalClientId) && conversa.escopoVerificado === false)} onClick={() => hook.devolver(conversa.id)} title="O assistente volta a responder ao responsável nas empresas autorizadas">Devolver ao automático</Button>
          ) : !somenteLeitura ? (
            <Button variant="primary" disabled={hook.ocupado} onClick={() => hook.assumir(conversa.id)} title="Você responde; o assistente fica em silêncio">Assumir</Button>
          ) : null}
          {onDetalhes ? <Button variant="secondary" size="sm" onClick={onDetalhes} aria-label="Detalhes da conversa" aria-expanded={detalhesAbertos}><WhatsappIcon nome="painel" size={18} /><span>Atendimento</span></Button> : null}
          {naLixeira ? <Button variant="secondary" disabled={hook.ocupado || movendo} onClick={() => mover(true)}>Restaurar chat</Button> : null}
          {Boolean((hrefDaEmpresa && conversa.portalClientId) || (!naLixeira && typeof hook.excluir === "function")) && <details className="wa-more-actions" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label="Mais ações da conversa">Mais</summary><div className="wa-more-menu">
            {hrefDaEmpresa && conversa.portalClientId ? conversa.empresas?.length > 1 ? <Button variant="secondary" size="sm" onClick={e => { e.currentTarget.closest("details").open = false; setEscolherEmpresa(true); }}>Abrir a empresa →</Button> : <a data-testid="ir-para-a-empresa" href={hrefDaEmpresa(conversa.portalClientId)}>Abrir a empresa →</a> : null}
            {!naLixeira && typeof hook.excluir === "function" && <Button variant="secondary" disabled={hook.ocupado || movendo} onClick={e => { e.currentTarget.closest("details").open = false; setConfirmarExclusao(true); }}>Excluir chat</Button>}
          </div></details>}
        </div>
      </div>
      {conversa.atendimento && !somenteLeitura ? <div className="wa-company-context" data-testid="contexto-empresa">
        <p>{conversa.atendimento.empresaAtual && !conversa.atendimento.aguardandoSelecao ? <><span>Empresa selecionada no atendimento automático:</span> <strong>{conversa.atendimento.empresaAtual.razao}</strong> · <CnpjDaConversa cnpj={conversa.atendimento.empresaAtual.cnpj} /></> : "O cliente ainda não selecionou uma empresa no atendimento automático."}</p>
        {hook.salvarApelidos && conversa.empresa && <NomesCurtosDaEmpresa key={conversa.portalClientId} conversa={conversa} hook={hook} />}
      </div> : null}
      {naLixeira ? <p role="status" className="wa-notice">Conversa na lixeira. O histórico está preservado para consulta. Restaure para voltar à lista; uma nova mensagem recebida também reabre a conversa.</p>
        : historico ? <p role="status" className="wa-notice">Histórico legado sem vínculo verificado, preservado somente para consulta. As mensagens anteriores não foram apagadas nem misturadas à conversa atual. Para atender este contato, volte a Conversas atuais.</p> : null}
      {conversa.pendencia ? <div data-testid="pendencia-aberta" className="wa-notice">Pedido aguardando confirmação do cliente: <strong>{PEDIDOS_PENDENTES[conversa.pendencia.tipo] || "Operação solicitada"}</strong> · código <strong>{conversa.pendencia.codigo}</strong> · expira {fmtDataHora(conversa.pendencia.expiraEm)}.</div> : null}
      {!somenteLeitura && !onDetalhes && podeAtendimentoComercial(conversa) && Boolean(slotVincular) && (hook.api?.comercial || !conversa.portalClientId) ? <PainelAtendimento>{slotVincular || <a href="/whatsapp">Conferir vínculo na caixa de WhatsApp</a>}</PainelAtendimento> : null}
      {historico ? <details className="wa-thread-setup"><summary>Verificar vínculo e iniciar conversa atual</summary><p>O vínculo abre um segmento verificado e preserva este histórico anterior.</p>{slotVincular || <a href="/whatsapp">Verificar vínculo na central de WhatsApp, em Histórico anterior</a>}</details> : null}
      <div className="wa-messages" ref={historicoRef} onScroll={acompanharLeitura} aria-label="Histórico de mensagens" tabIndex={0}>
        {avisoDePaginacao ? <p data-testid="aviso-paginacao" className="wa-list-note" style={{ textAlign: "center" }}>{avisoDePaginacao}</p> : null}
        {hook.cursorFio ? <Button variant="secondary" size="sm" disabled={hook.carregandoAnteriores} onClick={hook.carregarAnteriores}>{hook.carregandoAnteriores ? "Carregando…" : "Carregar mensagens anteriores"}</Button> : null}
        {mensagens.length === 0 ? <div className="wa-empty"><WhatsappIcon size={30} /><p>Nenhuma mensagem neste fio.</p></div> : null}
        {mensagens.map((m, index) => {
          const interna = m.tipo === "nota_interna";
          const entrada = m.direcao === "in";
          const midia = interna ? null : descricaoDaMidia(m);
          const estado = estadoDaMensagem(m);
          const dia = dataDaMensagem(m);
          const separador = dia && (index === 0 || dia !== dataDaMensagem(mensagens[index - 1]));
          return <div key={m.id}>
            {separador ? <div className="wa-day"><span>{dia}</span></div> : null}
            <div data-testid={`balao-${m.id}`} data-mensagem-id={m.id} data-mensagem-entrada={entrada ? "true" : undefined} data-autor={interna ? "nota-interna" : m.autor || (entrada ? "cliente" : "sem-autor")} className={`wa-message-row${entrada ? "" : " wa-message-row--out"}${interna ? " wa-message-row--note" : ""}`}>
              <AvatarConversa nome={interna ? m.autor?.nome || "Equipe" : entrada ? nomeDoCliente : rotuloDoAutor(m, { nomeDoCliente })} pequeno />
              <div className="wa-bubble">
                <div className="wa-bubble-author"><strong>{interna ? m.autor?.nome || "Equipe" : rotuloDoAutor(m, { nomeDoCliente })}</strong><time dateTime={m.ocorridaEmProvedor || m.registradaEm}>{fmtDataHora(m.ocorridaEmProvedor || m.registradaEm)}</time>{interna ? <span>Nota interna · só a equipe</span> : m.canal && <span>{m.canal.nome || m.canal.chave || m.canal.finalidade}</span>}</div>
                {!interna && conversa.atendimento && m.empresa && !m.escopoPessoa ? <div className="wa-bubble-company" data-testid={`empresa-mensagem-${m.id}`}>{m.empresa.razao} · <CnpjDaConversa cnpj={m.empresa.cnpj} empresa={m.empresa.razao} /></div> : null}
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
      {!somenteLeitura ? <CompositorConversa conversa={conversa} hook={hook} slotAcoes={slotAcoes} onCanalSelecionado={onCanalSelecionado} usuarioId={usuarioId} /> : null}
      {escolherEmpresa && <Modal titulo="Abrir empresa deste contato" tamanho="sm" aoFechar={() => setEscolherEmpresa(false)}><p>O histórico continua sendo único para esta pessoa.</p>{conversa.empresas.map(e => <p key={e.id}><a href={hrefDaEmpresa(e.id)}>{e.razao}</a> · <CnpjDaConversa cnpj={e.cnpj} empresa={e.razao} /></p>)}</Modal>}
      {confirmarExclusao ? <Modal titulo="Mover conversa para lixeira?" tamanho="sm" ocupado={movendo || hook.ocupado} aoFechar={() => setConfirmarExclusao(false)}
        rodape={<><Button variant="secondary" disabled={movendo || hook.ocupado} onClick={() => setConfirmarExclusao(false)}>Cancelar</Button><Button variant="danger" disabled={movendo || hook.ocupado} onClick={() => mover(false)}>Mover para lixeira</Button></>}>
        <p><strong>{identidade.pessoa}</strong> · {conversa.telefoneMascarado}</p>
        <p>{identidade.linhaDaEmpresa}</p>
        <p>O histórico será preservado e poderá ser restaurado. Uma nova mensagem recebida reabre a conversa.</p>
        {hook.erroAcao ? <p role="alert">{hook.erroAcao}</p> : null}
      </Modal> : null}
    </div></AtualizacaoAtendimento.Provider>
  );
}

function dataDaMensagem(m) {
  const data = new Date(m?.ocorridaEmProvedor || m?.registradaEm);
  return Number.isNaN(data.getTime()) ? "" : data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" });
}

function NomesCurtosDaEmpresa({ conversa, hook }) {
  const [nomes, setNomes] = useState((conversa.empresa?.apelidosWhatsapp || []).join(", "));
  return <details className="wa-company-names"><summary>Nomes curtos no WhatsApp</summary>
    <p>Cadastre como o responsável chama {conversa.empresa?.razao}, por exemplo “Clínica Azul”. Até cinco nomes, separados por vírgula.</p>
    <label>Nomes curtos da empresa<input aria-label="Nomes curtos da empresa" style={campo} maxLength={304} value={nomes} disabled={hook.ocupado} onChange={e => setNomes(e.target.value)} /></label>
    <Button variant="secondary" size="sm" disabled={hook.ocupado} onClick={() => hook.salvarApelidos(conversa.id, conversa.portalClientId, nomes.trim() ? nomes.split(",").map(n => n.trim()) : [])}>Salvar nomes curtos</Button>
  </details>;
}

export default FioDaConversa;
