// Aba "Senhas e informações" da empresa (grupo Empresa).
//
// ⚠ DUAS SEÇÕES, E A SEPARAÇÃO É O PONTO. Em cima o COFRE (senha cifrada, nunca listada, leitura
// auditada); embaixo as OUTRAS INFORMAÇÕES (texto livre, NÃO cifrado, e a tela diz isso em letras
// que dá para ler). Um campo que parece cofre e não é vale menos que campo nenhum — quem confia
// nele guarda segredo em claro achando que guardou protegido.
//
// Cores por `var(--…)` de `tokens.css`. Verde é CONCLUÍDO, nunca ação primária — a ação primária
// aqui é o accent roxo. Botão desabilitado NOMEIA o motivo (`title`), sempre.

import { useState } from "react";
import {
  ESTADOS, MASCARA, CARGA,
  estadoDaCredencial, podeVerSenha, avisoDeProtecao, estadoDaCarga,
} from "../lib/estadoCredencial";
import { AcessoPortalCliente } from "./AcessoPortalCliente";

const btn = (cor = "var(--border)") => ({
  padding: "6px 10px", borderRadius: "var(--radius-sm)", border: `1px solid ${cor}`,
  background: "transparent", color: "var(--text)", fontSize: "0.78rem",
  cursor: "pointer", fontFamily: "inherit",
});

const btnDesabilitado = {
  ...btn(), opacity: 0.45, cursor: "not-allowed",
};

const campo = {
  background: "var(--bg-subtle)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)", color: "var(--text)",
  padding: "8px 10px", fontSize: "0.86rem", fontFamily: "inherit",
  boxSizing: "border-box", width: "100%",
};

const CORES_AVISO = {
  forte: { cor: "var(--state-closed)", fundo: "var(--state-closed-surface)", icone: "🔒" },
  // ⚠ Âmbar, não vermelho: sem KMS o cofre FUNCIONA e as senhas ESTÃO cifradas. Vermelho aqui
  // diria "não use isto", que é falso, e gastaria o vermelho que a tela precisa para o resto.
  atencao: { cor: "var(--state-warn)", fundo: "var(--state-warn-surface)", icone: "⚠" },
  desconhecido: { cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)", icone: "○" },
};

function fmtData(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
}

/**
 * ⚠⚠ ISTO ERA UMA FAIXA DE LARGURA TOTAL, E AGORA É UMA LINHA — e a razão é a regra de cor do
 * próprio projeto, não gosto. Com zero credenciais, esta aba abria com DUAS faixas coloridas
 * empilhadas (a teal do cofre e a âmbar do "não é cifrado") antes de qualquer conteúdo: 90% da
 * tela era texto explicativo permanente. E âmbar permanente é exatamente o que o
 * `apps/web/CLAUDE.md` proíbe — "um menu permanentemente âmbar treina o olho a ignorar a cor que
 * significa falta enviar".
 *
 * ⚠ O TEXTO NÃO FOI ENCURTADO NEM SUAVIZADO. Ele continua inteiro, e o ícone continua carregando
 * a cor do nível — o que mudou é o PESO na página, não o que a tela afirma. Quem lê descobre a
 * mesma coisa; quem já leu não é obrigado a reler todo dia.
 */
function LinhaDeProtecao({ nivel, texto }) {
  const c = CORES_AVISO[nivel] || CORES_AVISO.desconhecido;
  return (
    <p style={{
      display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 var(--space-4)",
      fontSize: "0.76rem", lineHeight: 1.45, color: "var(--text-muted)",
    }}>
      <span aria-hidden="true" style={{ color: c.cor, fontWeight: 700 }}>{c.icone}</span>
      <span>{texto}</span>
    </p>
  );
}

/**
 * O lugar da lista quando a lista não tem nada — e ele NUNCA diz a mesma coisa em situações
 * diferentes. A decisão de qual é qual vive em `estadoDaCarga` (lib, com teste próprio); aqui só
 * se pinta.
 *
 * ⚠ Falha ganha moldura e um botão de tentar de novo; vazio de verdade é um parágrafo discreto.
 * Igualar os dois visualmente é o que faz "não consegui ler" passar por "não existe nada".
 */
function EstadoDaLista({ carga, onTentarDeNovo }) {
  if (carga.estado === CARGA.OK) return null;

  if (carga.estado === CARGA.CARREGANDO) {
    return <p style={{ color: "var(--text-muted)", fontSize: "0.83rem" }}>Carregando…</p>;
  }

  if (carga.estado === CARGA.VAZIA) {
    return <p style={{ color: "var(--text-muted)", fontSize: "0.83rem" }}>{carga.titulo}</p>;
  }

  // ⚠ Âmbar, não vermelho: nada foi perdido e nada está errado com os dados — a leitura é que não
  // aconteceu. Vermelho aqui gastaria a cor que a tela guarda para o destrutivo (excluir).
  return (
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
      {carga.podeTentarDeNovo && onTentarDeNovo && (
        <button
          type="button"
          style={btn("var(--accent-purple)")}
          onClick={onTentarDeNovo}
          title="Buscar de novo no servidor"
        >
          Tentar de novo
        </button>
      )}
    </div>
  );
}

// ── Uma linha do cofre ────────────────────────────────────────────────────────────────────────
function LinhaCredencial({ credencial, revelada, podeRevelar, papelMinimoRevelar, onRevelar, onEsconder, onExcluir }) {
  const estado = estadoDaCredencial(credencial, revelada !== undefined);
  const permissao = podeVerSenha({ credencial, podeRevelar, papelMinimoRevelar });
  const trocadaEm = fmtData(credencial.senhaAtualizadaEm);

  return (
    <article style={{
      padding: "12px 14px", borderRadius: "var(--radius)", marginBottom: "var(--space-3)",
      background: "var(--bg-subtle)", border: "1px solid var(--border)",
    }}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <strong style={{ fontSize: "0.9rem", color: "var(--text)" }}>{credencial.rotulo}</strong>
        {credencial.login && (
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            usuário: <code style={{ fontFamily: "ui-monospace, monospace" }}>{credencial.login}</code>
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            type="button"
            style={btn("var(--danger)")}
            onClick={onExcluir}
            title={`Excluir a credencial "${credencial.rotulo}"`}
          >
            Excluir
          </button>
        </div>
      </div>

      {/* A senha. Fora do estado `REVELADA`, o que está aqui é máscara de comprimento FIXO — nem o
          tamanho do valor sai do servidor. */}
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-faint)", minWidth: 52 }}>senha</span>

        {estado === ESTADOS.SEM_SENHA && (
          <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", fontStyle: "italic" }}>
            cadastrada sem senha
          </span>
        )}

        {estado === ESTADOS.OCULTA && (
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.9rem", letterSpacing: 2, color: "var(--text-muted)" }}>
            {MASCARA}
          </span>
        )}

        {estado === ESTADOS.REVELADA && (
          <code style={{
            fontFamily: "ui-monospace, monospace", fontSize: "0.9rem",
            background: "var(--accent-purple-surface)", border: "1px solid var(--accent-purple-border)",
            borderRadius: "var(--radius-sm)", padding: "3px 8px", color: "var(--text)",
            userSelect: "all", wordBreak: "break-all",
          }}>
            {revelada || "(vazia)"}
          </code>
        )}

        {estado === ESTADOS.REVELADA ? (
          <button type="button" style={btn()} onClick={onEsconder} title="Esconder de novo">
            Esconder
          </button>
        ) : estado === ESTADOS.OCULTA && (
          <button
            type="button"
            style={permissao.pode ? btn("var(--accent-purple)") : btnDesabilitado}
            disabled={!permissao.pode}
            onClick={permissao.pode ? onRevelar : undefined}
            /* ⚠ Desabilitado NOMEIA o motivo. Botão cinza e mudo faz o contador achar que o sistema
               quebrou, quando o que houve foi uma decisão de permissão. */
            title={permissao.pode ? "Mostrar a senha — a leitura fica registrada" : permissao.motivo}
          >
            Ver senha
          </button>
        )}

        {/* O rastro fica à vista de quem guarda, não escondido num relatório: é o que torna a
            auditoria um fato conhecido, e não uma surpresa depois de um incidente. */}
        <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "var(--text-faint)" }}>
          {trocadaEm ? `senha trocada em ${trocadaEm}` : "senha nunca trocada"}
          {credencial.vezesRevelada > 0 && ` · vista ${credencial.vezesRevelada}×`}
        </span>
      </div>

      {credencial.observacao && (
        <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>
          {credencial.observacao}
        </p>
      )}
    </article>
  );
}

// ── Formulário de nova credencial ─────────────────────────────────────────────────────────────
function FormNovaCredencial({ onCriar, onFechar = null }) {
  const [rotulo, setRotulo] = useState("");
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!rotulo.trim()) return;
    setSalvando(true);
    try {
      if (await onCriar({ rotulo, login, senha, observacao })) {
        setRotulo(""); setLogin(""); setSenha(""); setObservacao("");
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{
      marginBottom: "var(--space-5)", padding: "12px 14px", borderRadius: "var(--radius)",
      border: "1px solid var(--border)", background: "var(--bg-surface)",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-2)" }}>
        <label style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
          Onde <span style={{ color: "var(--danger)" }}>*</span>
          <input
            style={{ ...campo, marginTop: 4 }}
            value={rotulo}
            onChange={(e) => setRotulo(e.target.value)}
            placeholder="gov.br, Prefeitura, banco…"
          />
        </label>
        <label style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
          Usuário / login
          <input
            style={{ ...campo, marginTop: 4 }}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="CNPJ, CPF do sócio, e-mail…"
            autoComplete="off"
          />
        </label>
        <label style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
          Senha
          {/* `type=password` + `autoComplete="new-password"`: sem isso o gerenciador do navegador
              oferece salvar a senha DO CLIENTE no perfil de quem digitou, e ela passa a existir
              fora do cofre — exatamente o que a aba veio evitar. */}
          <input
            style={{ ...campo, marginTop: 4 }}
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="new-password"
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)", alignItems: "flex-end" }}>
        <label style={{ flex: 1, fontSize: "0.74rem", color: "var(--text-muted)" }}>
          Observação (não é cifrada)
          <input
            style={{ ...campo, marginTop: 4 }}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="titular, pergunta secreta, onde renovar…"
          />
        </label>
        <button
          type="button"
          style={rotulo.trim() && !salvando ? btn("var(--accent-purple)") : btnDesabilitado}
          disabled={salvando || !rotulo.trim()}
          onClick={salvar}
          title={rotulo.trim() ? "Guardar a credencial" : "Informe onde este acesso é usado (ex.: gov.br)"}
        >
          {salvando ? "Guardando…" : "Guardar"}
        </button>
        {/* Só existe quando alguém ABRIU o formulário. Com a lista vazia ele nasce aberto, e um
            "Fechar" ali deixaria a aba sem nada e sem porta de entrada. */}
        {onFechar ? (
          <button type="button" style={btn()} disabled={salvando} onClick={onFechar}>
            Fechar
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── "Outras informações" ──────────────────────────────────────────────────────────────────────
function SecaoInformacoes({ informacoes, carregando, erro, onCriar, onExcluir, onRecarregar }) {
  const [rotulo, setRotulo] = useState("");
  const [valor, setValor] = useState("");
  const carga = estadoDaCarga({
    carregando, erro, quantidade: informacoes.length, assunto: "informacoes",
  });

  async function salvar() {
    if (!rotulo.trim() || !valor.trim()) return;
    if (await onCriar({ rotulo, valor })) { setRotulo(""); setValor(""); }
  }

  /**
   * ⚠ Apagar CONFIRMA REPETINDO O QUE VAI SUMIR — rótulo e valor, não "tem certeza?". Estas linhas
   * são texto livre digitado à mão, sem cópia em lugar nenhum: um "sim" distraído no genérico não
   * dá para desfazer, e quem confirma não chega a saber o que perdeu.
   */
  function confirmarExclusao(info) {
    const ok = window.confirm(
      `Excluir a informação "${info.rotulo}"?\n\n`
      + `Valor guardado: ${info.valor}\n\n`
      + "Não há como desfazer.",
    );
    if (ok) onExcluir(info.id);
  }

  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline", marginBottom: "var(--space-2)" }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, color: "var(--text)" }}>Outras informações</h3>
        <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>
          {carregando
            ? "carregando…"
            : (erro && !informacoes.length ? "não foi possível contar" : `${informacoes.length} registro(s)`)}
        </span>
      </div>

      {/* ⚠⚠ O AVISO CONTINUA ANTES DO FORMULÁRIO E CONTINUA DIZENDO A MESMA COISA — ele só deixou
          de ser uma FAIXA ÂMBAR de largura total. Um campo que parece cofre e não é vale menos que
          campo nenhum, então a frase é inegociável; o que mudou é que ela agora está colada aos
          campos que descreve, em vez de competir com o cofre inteiro logo acima.
          ⚠ O ícone mantém a cor de atenção: o peso do texto caiu, a distinção não. */}
      <p style={{
        display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 var(--space-2)",
        fontSize: "0.76rem", lineHeight: 1.45, color: "var(--text-muted)",
      }}>
        <span aria-hidden="true" style={{ color: "var(--state-warn)", fontWeight: 700 }}>⚠</span>
        <span>
          Isto <strong>não é cifrado</strong> — fica em texto simples no banco. Serve para contato,
          código de acesso não-secreto, número de protocolo. Senha vai na seção de cima.
        </span>
      </p>

      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)", flexWrap: "wrap" }}>
        <input
          style={{ ...campo, flex: "0 1 220px" }}
          value={rotulo}
          onChange={(e) => setRotulo(e.target.value)}
          placeholder="Rótulo (ex.: contador anterior)"
        />
        <input
          style={{ ...campo, flex: "1 1 240px" }}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Valor"
        />
        <button
          type="button"
          style={rotulo.trim() && valor.trim() ? btn("var(--accent-purple)") : btnDesabilitado}
          disabled={!rotulo.trim() || !valor.trim()}
          onClick={salvar}
          title={rotulo.trim() && valor.trim() ? "Adicionar" : "Preencha rótulo e valor"}
        >
          Adicionar
        </button>
      </div>

      {informacoes.map((i) => (
        <div key={i.id} style={{
          display: "flex", gap: "var(--space-2)", alignItems: "center",
          padding: "8px 12px", borderRadius: "var(--radius-sm)", marginBottom: 6,
          border: "1px solid var(--border)", background: "var(--bg-subtle)",
        }}>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", minWidth: 140 }}>{i.rotulo}</span>
          <span style={{ fontSize: "0.86rem", color: "var(--text)", wordBreak: "break-word" }}>{i.valor}</span>
          <button
            type="button"
            style={{ ...btn("var(--danger)"), marginLeft: "auto" }}
            onClick={() => confirmarExclusao(i)}
            title={`Excluir a informação "${i.rotulo}"`}
          >
            Excluir
          </button>
        </div>
      ))}

      <EstadoDaLista carga={carga} onTentarDeNovo={onRecarregar} />
    </section>
  );
}

export function CompanyCredentialsTab({ vault, acesso, razaoSocial }) {
  const {
    credenciais, cofre, podeRevelar, papelMinimoRevelar, carregando, erro,
    informacoes, carregandoInfos, erroInfos,
    reveladas, revelar, esconder, criar, excluir, criarInfo, excluirInfo,
    recarregar, recarregarInfos,
  } = vault;

  const aviso = avisoDeProtecao(cofre);
  const carga = estadoDaCarga({ carregando, erro, quantidade: credenciais.length });
  const [adicionando, setAdicionando] = useState(false);
  const listaVazia = !carregando && !erro && credenciais.length === 0;
  const formAberto = adicionando || listaVazia;

  /**
   * ⚠ A CONFIRMAÇÃO ANTES DE MOSTRAR. Ato de consequência não dispara no clique: a leitura fica
   * gravada com nome e hora, e quem clica precisa saber disso ANTES, não descobrir depois no
   * relatório. É a mesma disciplina do clique que consulta o SITFIS (pago) e do envio de e-mail
   * ao cliente (ação para fora).
   */
  async function aoRevelar(credencial) {
    const ok = window.confirm(
      `Mostrar a senha de "${credencial.rotulo}"?\n\n`
      + "Esta leitura fica registrada com o seu nome, a data e a hora.",
    );
    if (!ok) return;
    await revelar(credencial.id);
  }

  /**
   * ⚠ A CONFIRMAÇÃO REPETE OS DADOS — rótulo E login. Uma empresa costuma ter duas linhas do mesmo
   * portal (gov.br do sócio e gov.br da empresa, dois usuários da prefeitura), e "Excluir a
   * credencial 'gov.br'?" não distingue uma da outra: quem confirma não sabe qual das duas está
   * apagando. O login é o que separa, então ele aparece.
   *
   * Login ausente também é dito com todas as letras — um campo que some da confirmação parece
   * campo que não foi lido.
   */
  async function aoExcluir(credencial) {
    const ok = window.confirm(
      `Excluir a credencial "${credencial.rotulo}"?\n\n`
      + `Usuário / login: ${credencial.login || "(esta credencial não tem login cadastrado)"}\n\n`
      + "A senha guardada é apagada junto. O registro de quem já a consultou permanece.",
    );
    if (ok) await excluir(credencial.id);
  }

  return (
    /* ⚠ A LARGURA NÃO MORA MAIS AQUI (era `maxWidth: 900` + padding próprio): quem decide é o
       `CompanyTabLayout`, com `largura="leitura"`. As três abas do grupo Empresa tinham três
       larguras diferentes e o conteúdo saltava a cada troca de sub-aba. */
    <div style={{ color: "var(--text)" }}>
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline", marginBottom: "var(--space-3)", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>Senhas e acessos</h2>
        {/* ⚠ A CONTAGEM NÃO É DITA QUANDO A LEITURA FALHOU. "0 credencial(is)" é uma afirmação
            sobre a empresa; depois de uma chamada que não voltou, o que se tem é a ausência da
            resposta, não a ausência de credencial. */}
        <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>
          {carregando
            ? "carregando…"
            : (erro && !credenciais.length ? "não foi possível contar" : `${credenciais.length} credencial(is)`)}
        </span>
      </div>

      {/* ⚠ TRÊS SEÇÕES AGORA, e a de cima é de outra natureza que as duas de baixo. Ela trata da
          senha do CLIENTE no portal dele — bcrypt, irreversível, com três caminhos de troca —,
          enquanto o cofre trata de senha de TERCEIRO, cifrada de forma recuperável de propósito.
          Vem primeiro porque é a que o contador procura quando o cliente liga dizendo que não
          consegue entrar; e é a única que muda algo fora deste sistema. */}
      {acesso ? <AcessoPortalCliente acesso={acesso} razaoSocial={razaoSocial} /> : null}

      <LinhaDeProtecao nivel={aviso.nivel} texto={aviso.texto} />

      {/* ⚠ O FORMULÁRIO SÓ FICA ABERTO QUANDO HÁ MOTIVO. Ele era permanente, acima da lista: numa
          empresa com seis credenciais, quatro campos vazios empurravam para baixo justamente o que
          a pessoa veio ver. Com a lista VAZIA ele abre sozinho — aí não há lista a empurrar, e o
          que a tela tem a oferecer é exatamente cadastrar a primeira.
          ⚠ `listaVazia` exige `!carregando && !erro`: abrir o formulário em cima de uma leitura
          que ainda não voltou (ou que falhou) diria "esta empresa não tem credencial" sobre uma
          resposta que ninguém recebeu — é a mesma distinção que o `estadoDaCarga` protege logo
          abaixo, e que a contagem do título já respeita. */}
      {formAberto ? (
        <FormNovaCredencial onCriar={criar} onFechar={listaVazia ? null : () => setAdicionando(false)} />
      ) : (
        <div style={{ marginBottom: "var(--space-5)" }}>
          <button type="button" style={btn("var(--accent-purple)")} onClick={() => setAdicionando(true)}>
            + Adicionar credencial
          </button>
        </div>
      )}

      {credenciais.map((c) => (
        <LinhaCredencial
          key={c.id}
          credencial={c}
          revelada={reveladas.get(c.id)}
          podeRevelar={podeRevelar}
          papelMinimoRevelar={papelMinimoRevelar}
          onRevelar={() => aoRevelar(c)}
          onEsconder={() => esconder(c.id)}
          onExcluir={() => aoExcluir(c)}
        />
      ))}

      <EstadoDaLista carga={carga} onTentarDeNovo={recarregar} />

      <SecaoInformacoes
        informacoes={informacoes}
        carregando={carregandoInfos}
        erro={erroInfos}
        onCriar={criarInfo}
        onExcluir={excluirInfo}
        onRecarregar={recarregarInfos}
      />
    </div>
  );
}
