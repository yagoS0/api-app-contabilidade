// A TIRA DE AÇÕES RÁPIDAS, acima do compositor (F3, 06/09/2026).
//
// > Dono: *"podendo ter funções rápidas, como enviar guias, enviar algum documento"* — e, na
// > escolha das ações da v1, *"virar anotação"* no lugar de recalcular.
//
// ⚠ A REGRA de quem pode agora mora em `../lib/acoesRapidas.js`; aqui é a ligação. O motivo do
// bloqueio sai em TEXTO na tela, nunca em `title` — `title` não aparece no teclado nem no toque.

import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { CnpjDaConversa } from "./ConversaVisual";
import { campo } from "./FioDaConversa";
import { ACAO, acoesDisponiveis, rascunhoDeAnotacao } from "../lib/acoesRapidas";
import { fmtDataHora, identidadeDaConversa } from "../lib/conversasTela";
import { desfechoWhatsapp, resumirWhatsapp } from "../../guides/lib/canalDeEnvio";
import { rotuloTipoGuia } from "../../guides/lib/rotuloGuia";

const linha = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };

/** O rótulo da opção: a mensagem inteira num `select` viraria uma caixa ilegível. */
function recortar(texto, max = 70) {
  const t = String(texto || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function AcoesRapidas({
  conversa,
  mensagens = [],
  janela = null,
  canalLigado = null,
  api,
  companyId,
  onVirarAnotacao = null,
  onEnviado = null,
}) {
  const [aberta, setAberta] = useState(null); // ACAO em foco (o painel de escolha)
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [escolhido, setEscolhido] = useState("");
  const [recusa, setRecusa] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [destinatarios, setDestinatarios] = useState([]);
  const [resultado, setResultado] = useState(null);
  const [reenvio, setReenvio] = useState(false);
  const empresa = conversa.empresas?.find(e => e.id === companyId) || (conversa.portalClientId === companyId ? conversa.empresa : null);
  const versao = useRef(0);
  useEffect(() => {
    versao.current++;
    setAberta(null); setItens([]); setEscolhido(""); setDestinatarios([]);
    setRecusa(null); setResultado(null); setReenvio(false); setCarregando(false); setOcupado(false);
    return () => { versao.current++; };
  }, [companyId, conversa.id]);
  const recebem = r => {
    if (!Array.isArray(r?.contatos)) throw new Error("Não foi possível conferir os destinatários.");
    return r.contatos.filter(c => c.ativo !== false && c.optInEm && c.telefoneE164);
  };
  const assinatura = lista => lista.map(c => `${c.id}:${c.telefoneE164}`).sort().join("|");
  function cancelar() {
    versao.current++;
    setAberta(null); setEscolhido(""); setReenvio(false); setRecusa(null); setCarregando(false);
  }

  const acoes = acoesDisponiveis({
    conversa,
    janela,
    canalLigado,
    temDestinoDeAnotacao: typeof onVirarAnotacao === "function",
  });

  async function abrir(acao) {
    const v = ++versao.current;
    setRecusa(null); setResultado(null); setReenvio(false);
    if (aberta === acao) { cancelar(); return; }
    setAberta(acao);
    setEscolhido("");
    setItens([]);
    setCarregando(true);
    try {
      if (acao === ACAO.ENVIAR_GUIA) {
        const [guias, cadastro] = await Promise.all([api.getCompanyGuides(companyId), api.listarContatosWhatsapp(companyId)]);
        if (v !== versao.current) return;
        const alvos = recebem(cadastro);
        setDestinatarios(alvos);
        if (!alvos.length) throw new Error("Não há destinatário ativo de WhatsApp com autorização registrada.");
        setItens((Array.isArray(guias) ? guias : []).map((g) => ({
          id: g.guideId || g.id,
          // ⚠ O nome da guia sai de `rotuloTipoGuia` — a MESMA leitura da aba Guias. Uma segunda
          // regra aqui faria a parcela de parcelamento aparecer como "DAS" só neste botão.
          rotulo: `${rotuloTipoGuia(g)} · ${/^\d{4}-\d{2}$/.test(g.competencia || "") ? g.competencia.slice(5) + "/" + g.competencia.slice(0, 4) : g.competencia || "sem competência"}`,
        })));
      } else if (acao === ACAO.ENVIAR_DOCUMENTO) {
        const r = await api.listCompanyDocuments(companyId);
        if (v !== versao.current) return;
        setItens((Array.isArray(r?.documentos) ? r.documentos : []).map((d) => ({ id: d.id, rotulo: d.nome })));
      } else {
        // ⚠⚠ QUAL mensagem vira anotação é ESCOLHA do contador, nunca "a última" — anotação é juízo,
        // e adivinhar qual fala importa é o mesmo erro de adivinhar o que ela quer dizer. Só entram
        // as que TÊM texto: mídia que não sabemos abrir não tem o que copiar.
        setItens(
          [...(Array.isArray(mensagens) ? mensagens : [])]
            .filter((m) => String(m?.corpo || "").trim())
            .reverse()
            .slice(0, 20)
            .map((m) => ({ id: m.id, mensagem: m, rotulo: recortar(m.corpo) })),
        );
      }
    } catch (err) {
      if (v === versao.current) setRecusa(err?.message || "Não foi possível carregar a lista.");
    } finally {
      if (v === versao.current) setCarregando(false);
    }
  }

  async function confirmar(confirmouReenvio = false) {
    if (!escolhido || ocupado) return;
    const v = versao.current;
    setOcupado(true);
    setRecusa(null);
    try {
      if (aberta === ACAO.VIRAR_ANOTACAO) {
        // ⚠ NADA é gravado aqui: o texto vai para o campo de anotação AO LADO, e o contador edita,
        // escolhe a importância e salva pelo `POST /anotacoes` inalterado. Zero rota, zero coluna.
        const item = itens.find((i) => i.id === escolhido);
        const texto = rascunhoDeAnotacao(item?.mensagem, {
          pessoa: identidadeDaConversa(conversa).pessoa,
          fmtDataHora,
        });
        onVirarAnotacao?.(texto);
      } else if (aberta === ACAO.ENVIAR_GUIA) {
        const alvos = recebem(await api.listarContatosWhatsapp(companyId));
        if (v !== versao.current) return;
        if (assinatura(alvos) !== assinatura(destinatarios)) {
          setDestinatarios(alvos); setEscolhido(""); setReenvio(false);
          throw new Error("Os destinatários mudaram. Confira a lista atualizada e escolha a guia novamente.");
        }
        if (!alvos.length) throw new Error("Não há destinatário ativo de WhatsApp com autorização registrada.");
        const r = confirmouReenvio
          ? await api.enviarGuiaWhatsapp(companyId, escolhido, { reenviar: true })
          : await api.enviarGuiaWhatsapp(companyId, escolhido);
        if (v !== versao.current) return;
        setResultado(resumirWhatsapp(desfechoWhatsapp(r)));
      } else {
        const r = await api.enviarDocumentoWhatsapp(conversa.id, escolhido);
        if (v !== versao.current) return;
        if (r?.ok === false) throw new Error(r.message || r.mensagem || "O envio não foi confirmado.");
        setResultado({ tom: "pendente", texto: "Documento aceito pela Meta; aguarde a confirmação de entrega no fio." });
      }
      if (v !== versao.current) return;
      setAberta(null);
      setEscolhido("");
      if (aberta !== ACAO.VIRAR_ANOTACAO) await onEnviado?.();
    } catch (err) {
      // ⚠ A recusa do SERVIDOR aparece com a frase dele (409 FORA_DA_JANELA, 422 sem opt-in…),
      // nunca "falhou": os consertos são diferentes e a tela precisa dizer qual é.
      if (v !== versao.current) return;
      setRecusa(err?.payload?.message || err?.payload?.mensagem || err?.message || "Não foi possível enviar.");
      setReenvio(err?.code === "GUIA_JA_ENVIADA");
    } finally {
      if (v === versao.current) setOcupado(false);
    }
  }

  return (
    <div data-testid="acoes-rapidas" className="wa-quick-actions">
      <div style={linha}>
        {acoes.map((a) => (
          <Button
            key={a.acao}
            variant="secondary"
            data-testid={`acao-${a.acao}`}
            disabled={!a.pode || ocupado}
            onClick={() => abrir(a.acao)}
          >
            {a.rotulo}
          </Button>
        ))}
      </div>

      {/* ⚠ O motivo é TEXTO, e aparece ANTES do clique — não depois da recusa. */}
      {acoes.filter((a) => a.frase).map((a) => (
        <p key={a.acao} data-testid={`motivo-${a.acao}`} className="wa-list-note">
          {a.rotulo}: {a.frase}
        </p>
      ))}

      {aberta ? (
        <div data-testid="escolha-do-envio" className="wa-send-panel">
          <h3>{aberta === ACAO.ENVIAR_GUIA ? "Enviar guia pelo WhatsApp" : aberta === ACAO.ENVIAR_DOCUMENTO ? "Enviar documento pelo WhatsApp" : "Preparar anotação"}</h3>
          {aberta !== ACAO.VIRAR_ANOTACAO && <dl className="wa-send-summary"><dt>Empresa</dt><dd>{empresa?.razao || "Empresa deste cadastro"}{empresa?.cnpj && <> · <CnpjDaConversa cnpj={empresa.cnpj} empresa={empresa.razao} /></>}</dd><dt>Canal</dt><dd>WhatsApp</dd></dl>}
          {carregando ? <p className="wa-list-note">Carregando documentos e destinatários…</p> : null}
          {!carregando && !itens.length ? (
            <p data-testid="escolha-vazia" className="wa-list-note">
              {aberta === ACAO.ENVIAR_GUIA
                ? "Esta empresa não tem guia nesta lista."
                : aberta === ACAO.ENVIAR_DOCUMENTO
                  ? "Esta empresa não tem documento guardado."
                  : "Nenhuma mensagem com texto neste fio — só há mídia, que este sistema ainda não abre."}
            </p>
          ) : null}
          {!carregando && aberta === ACAO.ENVIAR_GUIA && destinatarios.length ? <div data-testid="destinatarios-guia" className="wa-send-recipients">
            <strong>Quem vai receber</strong><p>Todos os contatos abaixo receberão a guia desta empresa.</p>
            <ul>{destinatarios.map(c => <li key={c.id}>{c.nome || "Contato"} · {c.telefoneE164}</li>)}</ul>
          </div> : null}
          {!carregando && itens.length ? (
            <div className="wa-send-actions">
              <label>{aberta === ACAO.ENVIAR_GUIA ? "Escolha a guia" : aberta === ACAO.ENVIAR_DOCUMENTO ? "Escolha o documento" : "Escolha a mensagem"}<select
                aria-label={
                  aberta === ACAO.ENVIAR_GUIA ? "Guia a enviar"
                    : aberta === ACAO.ENVIAR_DOCUMENTO ? "Documento a enviar"
                      : "Mensagem que vira anotação"
                }
                style={campo}
                value={escolhido}
                disabled={ocupado}
                onChange={(e) => { setEscolhido(e.target.value); setReenvio(false); setRecusa(null); }}
              >
                <option value="">— escolha —</option>
                {itens.map((i) => <option key={i.id} value={i.id}>{i.rotulo}</option>)}
              </select></label>
              <div className="wa-send-buttons">
              <Button variant="primary" disabled={!escolhido || ocupado || reenvio || (aberta === ACAO.ENVIAR_GUIA && !destinatarios.length)} onClick={() => confirmar(false)}>
                {ocupado ? "Enviando…" : aberta === ACAO.VIRAR_ANOTACAO ? "Levar para a anotação" : "Enviar"}
              </Button>
              <Button variant="secondary" disabled={ocupado} onClick={cancelar}>Cancelar</Button></div>
            </div>
          ) : null}
        </div>
      ) : null}

      {resultado ? <p role={resultado.tom === "erro" ? "alert" : "status"} style={{ color: resultado.tom === "erro" ? "var(--state-danger)" : "var(--text-muted)" }}>{resultado.texto}</p> : null}
      {aberta === ACAO.ENVIAR_GUIA && reenvio && escolhido ? <Button disabled={ocupado} onClick={() => confirmar(true)}>Confirmar reenvio aos destinatários acima</Button> : null}
      {recusa ? <p role="alert" className="wa-send-error">{recusa}</p> : null}
    </div>
  );
}

export default AcoesRapidas;
