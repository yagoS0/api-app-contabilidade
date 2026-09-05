// Seção "WhatsApp" da aba Senhas e acessos — quem recebe guia por WhatsApp, e por qual canal a
// empresa recebe por padrão.
//
// ⚠ ESTA TELA NÃO ENVIA NADA. Ela cadastra o destinatário (com o opt-in que a Meta pode pedir para
// ver), liga o número à PESSOA do portal (de onde sai o papel do RBAC) e escolhe o canal padrão.
// Quem envia é a tela de guias e a de envio em lote.
//
// ⚠⚠ OPT-IN É BLOQUEIO, NÃO AVISO. Sem data de opt-in o contato NÃO recebe template — é política da
// Meta e é o que protege o número do escritório de denúncia por spam (número derrubado tira o canal
// de TODOS os clientes de uma vez). Por isso a linha diz "sem opt-in — não recebe" em vez de só
// mostrar uma caixinha desmarcada.
//
// ⚠ O NÚMERO É O DO CADASTRO (dono, 14/08/2026). O envio casa dígito a dígito; a tela AVISA quando
// um celular parece estar no formato antigo e manda corrigir o cadastro — nunca tolera.
//
// A regra mora em `../lib/contatoWhatsappTela.js`, com teste próprio. Aqui só se liga e se pinta.
// Cores por `var(--…)`; verde é CONCLUÍDO, nunca ação; botão desabilitado NOMEIA o motivo.

import { useState } from "react";
import {
  CANAIS_DE_ENVIO,
  CARGA,
  FRASE_EMPRESA,
  FRASE_SITUACAO,
  SITUACAO_CONTATO,
  estadoDaLista,
  formatarTelefone,
  fraseDeConfirmacaoRemocao,
  montarPayload,
  pareceFormatoAntigo,
  pessoaDoContato,
  situacaoDaEmpresa,
  situacaoDoContato,
  validarFormulario,
} from "../lib/contatoWhatsappTela";
import { nomeDoPapel } from "../../../../lib/portal/senhaDoPortal";

const btn = (cor = "var(--border)") => ({
  padding: "6px 10px", borderRadius: "var(--radius-sm)", border: `1px solid ${cor}`,
  background: "transparent", color: "var(--text)", fontSize: "0.78rem",
  cursor: "pointer", fontFamily: "inherit",
});
const btnDesabilitado = { ...btn(), opacity: 0.45, cursor: "not-allowed" };
const campo = {
  background: "var(--bg-subtle)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)", color: "var(--text)",
  padding: "8px 10px", fontSize: "0.86rem", fontFamily: "inherit",
  boxSizing: "border-box", width: "100%",
};
const rotulo = { fontSize: "0.74rem", color: "var(--text-muted)", display: "block" };

function fmtData(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
}

const COR_SITUACAO = {
  // Verde só para quem de fato RECEBE — é o estado concluído do cadastro.
  [SITUACAO_CONTATO.RECEBE]: "var(--state-closed)",
  // Recebe por e-mail: é estado NORMAL, não pendência — âmbar aqui treinaria o olho a ignorar a cor.
  [SITUACAO_CONTATO.SO_EMAIL]: "var(--text-muted)",
  [SITUACAO_CONTATO.SEM_OPT_IN]: "var(--state-warn)",
  [SITUACAO_CONTATO.INATIVO]: "var(--state-neutral)",
};

function LinhaContato({ contato, usuarios, onRemover }) {
  const situacao = situacaoDoContato(contato);
  const pessoa = pessoaDoContato(contato, usuarios);
  const antigo = pareceFormatoAntigo(contato.telefoneE164);
  const optIn = fmtData(contato.optInEm);

  return (
    <div
      data-testid={`contato-whatsapp-${contato.id}`}
      data-situacao={situacao}
      style={{
        padding: "10px 12px", borderRadius: "var(--radius-sm)", marginBottom: 6,
        border: "1px solid var(--border)", background: "var(--bg-subtle)",
      }}
    >
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.9rem", color: "var(--text)", fontWeight: 600 }}>{contato.nome}</span>
        {contato.papel ? <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>{contato.papel}</span> : null}
        {/* ⚠ OS DOIS CANAIS, e a ausência de um deles NÃO some: destinatário só de e-mail é caso
            normal desde 05/09/2026, e uma linha sem nada onde havia o telefone se lê como defeito. */}
        {contato.telefoneE164 ? (
          <code style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.84rem", color: "var(--text)" }}>
            {formatarTelefone(contato.telefoneE164)}
          </code>
        ) : (
          <span style={{ fontSize: "0.76rem", color: "var(--text-faint)" }}>sem WhatsApp</span>
        )}
        {contato.email ? (
          <span style={{ fontSize: "0.8rem", color: "var(--text)" }}>{contato.email}</span>
        ) : (
          <span style={{ fontSize: "0.76rem", color: "var(--text-faint)" }}>sem e-mail</span>
        )}
        <span style={{ marginLeft: "auto", fontSize: "0.74rem", color: COR_SITUACAO[situacao], fontWeight: 600 }}>
          {FRASE_SITUACAO[situacao]}
          {situacao === SITUACAO_CONTATO.RECEBE && optIn ? ` · opt-in em ${optIn}` : ""}
        </span>
        <button
          type="button"
          style={btn("var(--danger)")}
          onClick={() => onRemover(contato)}
          title={`Remover o contato "${contato.nome}"`}
        >
          Remover
        </button>
      </div>
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", marginTop: 4, fontSize: "0.74rem", color: "var(--text-muted)" }}>
        {/* ⚠ Quem é a PESSOA — de onde sai o papel. Sem ela o número identifica a empresa e o
            assistente não sabe o que esta pessoa pode fazer (vínculo não é autorização). */}
        {pessoa ? (
          <span>
            pessoa do portal: <strong style={{ color: "var(--text)" }}>{pessoa.nome || pessoa.email || pessoa.userId}</strong>
            {pessoa.papel ? ` (${nomeDoPapel(pessoa.papel)})` : ""}
          </span>
        ) : (
          <span>não ligado a uma pessoa do portal — o número identifica a empresa, não quem fala</span>
        )}
        {contato.optInOrigem && situacao === SITUACAO_CONTATO.RECEBE ? <span>origem do opt-in: {contato.optInOrigem}</span> : null}
        {antigo ? (
          <span style={{ color: "var(--state-warn)" }} data-testid={`aviso-formato-antigo-${contato.id}`}>
            ⚠ 8 dígitos: se for celular, este cadastro está no formato antigo — o envio só casa dígito a dígito. Corrija o número.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FormContato({ usuarios, salvando, onSalvar, onFechar }) {
  const [nome, setNome] = useState("");
  const [papel, setPapel] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [optInOrigem, setOptInOrigem] = useState("");
  const [userId, setUserId] = useState("");
  const [erros, setErros] = useState({});

  const validacao = validarFormulario({ nome, telefone, email });

  async function salvar() {
    const v = validarFormulario({ nome, telefone, email });
    setErros(v.erros);
    if (!v.ok) return;
    const ok = await onSalvar(montarPayload({ nome, papel, telefone, email, optIn, optInOrigem, userId: userId || undefined }));
    if (ok) {
      setNome(""); setPapel(""); setTelefone(""); setEmail(""); setOptIn(false); setOptInOrigem(""); setUserId(""); setErros({});
      onFechar?.();
    }
  }

  const lista = Array.isArray(usuarios) ? usuarios : [];

  return (
    <div
      data-testid="form-contato-whatsapp"
      style={{
        marginBottom: "var(--space-3)", padding: "12px 14px", borderRadius: "var(--radius)",
        border: "1px solid var(--border)", background: "var(--bg-surface)",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-2)" }}>
        <label style={rotulo}>
          Nome <span style={{ color: "var(--danger)" }}>*</span>
          <input style={{ ...campo, marginTop: 4 }} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="quem recebe as mensagens" />
          {erros.nome ? <span role="alert" style={{ color: "var(--danger)" }}>{erros.nome}</span> : null}
        </label>
        <label style={rotulo}>
          Papel (rótulo)
          <input style={{ ...campo, marginTop: 4 }} value={papel} onChange={(e) => setPapel(e.target.value)} placeholder="financeiro, sócio…" />
        </label>
        <label style={rotulo}>
          Telefone (WhatsApp)
          {/* ⚠ NÃO SE DIGITA O +55 — `normalizarE164` o prefixa sozinha (decisão do dono,
              05/09/2026: "só devemos digitar o número da pessoa"). O `+` continua aceito e é o
              único desambiguador de DDI para número estrangeiro. */}
          <input
            style={{ ...campo, marginTop: 4 }}
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="(21) 99999-8888"
            inputMode="tel"
          />
          {erros.telefone ? <span role="alert" style={{ color: "var(--danger)" }}>{erros.telefone}</span> : null}
          {!erros.telefone && validacao.telefoneE164 ? (
            <span style={{ color: "var(--text-faint)" }}>será gravado como {formatarTelefone(validacao.telefoneE164)}</span>
          ) : null}
        </label>
        <label style={rotulo}>
          E-mail
          <input
            style={{ ...campo, marginTop: 4 }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="financeiro@empresa.com.br"
            inputMode="email"
            type="text"
          />
          {erros.email ? <span role="alert" style={{ color: "var(--danger)" }}>{erros.email}</span> : null}
        </label>
        <label style={rotulo}>
          Pessoa do portal
          <select style={{ ...campo, marginTop: 4 }} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— nenhuma (o número identifica só a empresa) —</option>
            {lista.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.nome || u.email || u.userId}{u.papel ? ` · ${nomeDoPapel(u.papel)}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap", marginTop: "var(--space-2)" }}>
        <label style={{ ...rotulo, display: "flex", gap: 8, alignItems: "center", flex: "1 1 260px" }}>
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
          <span>
            <strong style={{ color: "var(--text)" }}>Opt-in registrado</strong> — a pessoa autorizou receber mensagens do escritório
            por WhatsApp. Sem isto o contato <strong>não recebe</strong> guia (política da Meta).
          </span>
        </label>
        {optIn ? (
          <label style={{ ...rotulo, flex: "1 1 200px" }}>
            Onde a autorização foi dada
            <input style={{ ...campo, marginTop: 4 }} value={optInOrigem} onChange={(e) => setOptInOrigem(e.target.value)} placeholder="contrato, formulário, verbal registrado…" />
          </label>
        ) : null}
        <button
          type="button"
          style={validacao.ok && !salvando ? btn("var(--accent-purple)") : btnDesabilitado}
          disabled={!validacao.ok || salvando}
          onClick={salvar}
          title={validacao.ok ? "Salvar o destinatário" : (validacao.erros.nome || validacao.erros.canal || validacao.erros.telefone || validacao.erros.email)}
        >
          {salvando ? "Salvando…" : "Salvar contato"}
        </button>
        {onFechar ? <button type="button" style={btn()} disabled={salvando} onClick={onFechar}>Fechar</button> : null}
      </div>
    </div>
  );
}

/**
 * @param {object} p
 * @param {object} p.whatsapp  o retorno de `useContatosWhatsapp`
 * @param {Array}  p.usuarios  os usuários do portal desta empresa (`useAcessoPortalCliente().usuarios`)
 */
export function ContatosWhatsapp({ whatsapp, usuarios }) {
  const { contatos, canalPadraoEnvio, carregando, salvando, erro, salvar, remover, definirCanal, recarregar } = whatsapp;
  const [adicionando, setAdicionando] = useState(false);
  const carga = estadoDaLista({ carregando, erro, quantidade: contatos.length });
  const situacao = situacaoDaEmpresa(contatos);
  const listaVazia = carga.estado === CARGA.VAZIA;
  const formAberto = adicionando || listaVazia;

  function aoRemover(contato) {
    if (window.confirm(fraseDeConfirmacaoRemocao(contato))) remover(contato.id);
  }

  return (
    <section data-testid="secao-whatsapp" style={{ marginBottom: "var(--space-6)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline", marginBottom: "var(--space-2)", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, color: "var(--text)" }}>WhatsApp</h3>
        <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>
          {carregando && !contatos.length
            ? "carregando…"
            : (erro && !contatos.length ? "não foi possível contar" : `${contatos.length} contato(s)`)}
        </span>
        <label style={{ ...rotulo, marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          canal padrão das guias
          <select
            aria-label="Canal padrão de envio das guias"
            style={{ ...campo, width: "auto" }}
            value={canalPadraoEnvio}
            onChange={(e) => definirCanal(e.target.value)}
          >
            {CANAIS_DE_ENVIO.map((c) => (
              <option key={c.valor} value={c.valor} title={c.descricao}>{c.rotulo}</option>
            ))}
          </select>
        </label>
      </div>

      {/* ⚠ A situação da EMPRESA vem antes da lista: é ela que diz por que a guia vai cair para
          e-mail no lote. Sem contato e sem opt-in são consertos diferentes. */}
      {FRASE_EMPRESA[situacao] && carga.estado !== CARGA.CARREGANDO && carga.estado !== CARGA.FALHOU ? (
        <p data-testid="situacao-empresa-whatsapp" style={{ display: "flex", gap: 8, margin: "0 0 var(--space-2)", fontSize: "0.76rem", color: "var(--text-muted)", lineHeight: 1.45 }}>
          <span aria-hidden="true" style={{ color: "var(--state-warn)", fontWeight: 700 }}>⚠</span>
          <span>{FRASE_EMPRESA[situacao]}</span>
        </p>
      ) : null}

      {formAberto ? (
        <FormContato usuarios={usuarios} salvando={salvando} onSalvar={salvar} onFechar={listaVazia ? null : () => setAdicionando(false)} />
      ) : (
        <div style={{ marginBottom: "var(--space-3)" }}>
          <button type="button" style={btn("var(--accent-purple)")} onClick={() => setAdicionando(true)}>
            + Adicionar contato
          </button>
        </div>
      )}

      {contatos.map((c) => (
        <LinhaContato key={c.id} contato={c} usuarios={usuarios} onRemover={aoRemover} />
      ))}

      {carga.estado === CARGA.CARREGANDO ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.83rem" }}>Carregando…</p>
      ) : null}
      {carga.estado === CARGA.FALHOU ? (
        <div
          role="status"
          style={{
            display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap",
            padding: "10px 12px", borderRadius: "var(--radius-sm)",
            border: "1px solid var(--state-warn)", background: "var(--state-warn-surface)",
            fontSize: "0.82rem", lineHeight: 1.45,
          }}
        >
          <span aria-hidden="true" style={{ color: "var(--state-warn)", fontWeight: 700 }}>⚠</span>
          <span style={{ color: "var(--text)", flex: "1 1 260px" }}>
            <strong style={{ display: "block" }}>{carga.titulo}</strong>
            {carga.texto}
          </span>
          <button type="button" style={btn("var(--accent-purple)")} onClick={recarregar} title="Buscar de novo no servidor">
            Tentar de novo
          </button>
        </div>
      ) : null}
    </section>
  );
}
