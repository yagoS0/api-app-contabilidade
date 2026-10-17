// Seção "Acesso do cliente ao portal" — a primeira da aba Senhas e acessos.
//
// ⚠⚠ NÃO É O COFRE que vem abaixo, e a tela DIZ isso em letras que dá para ler. O cofre guarda
// senha de terceiro (gov.br, prefeitura, banco) de forma recuperável, de propósito; aqui a senha é
// bcrypt em `User.passwordHash` e NÃO TEM VOLTA. Não existe "ver a senha do cliente": o contador
// DEFINE uma nova, exibida UMA VEZ. Uma seção que parecesse cofre e não fosse valeria menos que
// seção nenhuma — é a mesma disciplina que separa o cofre das "Outras informações" logo abaixo.
//
// ⚠ A senha nova NUNCA vai para `localStorage`, `title`, log, ou de volta numa listagem. Ela vive
// no estado do hook e some no unmount (ver `useAcessoPortalCliente`).
//
// Cores por `var(--…)` de `tokens.css`. Verde é CONCLUÍDO, nunca ação primária; a ação primária
// aqui é o accent roxo. Botão desabilitado NOMEIA o motivo (`title`), sempre.

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { Modal } from "../../../../components/ui/Modal";
import {
  TITULO,
  estadoDaLista,
  identificarUsuario,
  linhaDeEstado,
  nomeDoPapel,
  fraseDeConfirmacao,
  motivoDoBloqueio,
} from "../../../../lib/portal/senhaDoPortal";

/**
 * A senha nova, em claro, na tela — e o aviso de que é a única vez.
 *
 * ⚠ `userSelect: "all"` e fonte monoespaçada: ela vai ser COPIADA ou DITADA. Um valor que se
 * transcreve errado volta como "não consigo entrar", e o contador troca de novo — gastando uma
 * segunda troca, uma segunda linha de auditoria e uma segunda revogação de sessões.
 * ⚠ NADA de `title` aqui: `title` vira tooltip e entra em captura de tela e em leitor de tela sem
 * que ninguém tenha pedido.
 */
function SenhaExibidaUmaVez({ senha, usuario, onEsconder }) {
  const resultadoRef = useRef(null);
  useEffect(() => { resultadoRef.current?.focus(); }, [senha]);
  return (
    <div
      data-testid="senha-nova-portal"
      ref={resultadoRef}
      tabIndex={-1}
      aria-label="Nova senha do cliente"
      style={{
        marginTop: "var(--space-2)", padding: "12px 14px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--state-warn)", background: "var(--state-warn-surface)",
      }}
    >
      <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8, lineHeight: 1.45 }}>
        <strong>Esta é a única vez que esta senha aparece.</strong>{" "}
        Ela não fica guardada em lugar nenhum — se sair desta tela sem repassá-la a{" "}
        {identificarUsuario(usuario)}, será preciso definir outra.
      </div>
      <code
        data-testid="valor-senha-nova"
        style={{
          display: "block", userSelect: "all",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "1.05rem", letterSpacing: "0.04em",
          background: "var(--bg-subtle)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)", padding: "10px 12px", color: "var(--text)",
          wordBreak: "break-all",
        }}
      >
        {senha || "(o servidor não devolveu a senha)"}
      </code>
      <Button
        type="button"
        variant="secondary" size="sm" style={{ marginTop: 8 }}
        onClick={onEsconder}
        title="Some com a senha desta tela. Não há como trazê-la de volta."
      >
        Já repassei — esconder
      </Button>
    </div>
  );
}

/**
 * Uma linha por usuário do portal.
 *
 * ⚠ A LINHA NOMEIA DE QUEM É A SENHA — nome, e-mail e papel. "A senha do portal" é o rótulo que,
 * no dia do segundo usuário, troca a senha de alguém por engano.
 */
function LinhaUsuario({
  usuario, ultimaSenha, podeDefinirSenha, salvando, razaoSocial, onDefinir, onEsconder,
}) {
  const [confirmando, setConfirmando] = useState(false);
  const motivoId = useId();
  const bloqueio = motivoDoBloqueio({ podeDefinirSenha, salvando, usuario });

  async function confirmar() {
    setConfirmando(false);
    await onDefinir(usuario.userId);
  }

  return (
    <div
      data-testid={`usuario-portal-${usuario.userId}`}
      style={{
        padding: "12px 14px", borderRadius: "var(--radius-sm)", marginBottom: 8,
        border: "1px solid var(--border)", background: "var(--bg-subtle)", overflowWrap: "anywhere",
      }}
    >
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.9rem", color: "var(--text)", fontWeight: 600 }}>
          {usuario.nome || "(sem nome cadastrado)"}
        </span>
        <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", wordBreak: "break-all" }}>
          {usuario.email || "(sem e-mail cadastrado)"}
        </span>
        <span style={{
          marginLeft: "auto", fontSize: 13, color: "var(--text-muted)",
          border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px",
        }}>
          {nomeDoPapel(usuario.papel)}
        </span>
      </div>

      {/* ⚠ O ESTADO — é isto que o portal do contador "também muda". Não há senha a sincronizar
          (é uma senha só); o que ele precisa refletir é quando ela mudou e por qual caminho. */}
      <div
        data-testid={`estado-senha-${usuario.userId}`}
        style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.45 }}
      >
        {linhaDeEstado(usuario.ultimaTroca)}
      </div>

      <Button
          type="button"
          variant="secondary" size="sm" style={{ marginTop: 10 }}
          aria-describedby={bloqueio ? motivoId : undefined}
          disabled={Boolean(bloqueio)}
          onClick={() => setConfirmando(true)}
          title={bloqueio || `Definir uma senha nova para ${identificarUsuario(usuario)}`}
        >
          {salvando ? "Definindo…" : "Definir uma senha nova"}
      </Button>

      {/* ⚠ A CONFIRMAÇÃO REPETE OS DADOS DO ATO, nunca "tem certeza?": de quem é a senha, o que
          acontece com as sessões abertas, e que a senha nova aparece uma vez só. O primeiro clique
          só ARMA — nada é enviado. Mesma disciplina de `LiberacaoEmissaoCliente`. */}
      {confirmando && (
        <Modal
          titulo="Definir uma senha nova"
          aoFechar={() => setConfirmando(false)}
          ocupado={salvando}
          fecharAoClicarFundo={false}
          tamanho="md"
          rodape={<div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Button type="button" variant="secondary" disabled={salvando} onClick={() => setConfirmando(false)}>Cancelar</Button>
            <Button type="button" onClick={confirmar} disabled={Boolean(bloqueio)}>Sim, definir uma senha nova</Button>
          </div>}
        >
          <div data-testid={`confirmacao-senha-${usuario.userId}`} style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
            {fraseDeConfirmacao({ usuario, razaoSocial })}
          </div>
        </Modal>
      )}
      {bloqueio ? <p id={motivoId} role={salvando ? "status" : undefined} style={{ fontSize: 13, color: "var(--text-muted)", margin: "8px 0 0" }}>{bloqueio}</p> : null}

      {ultimaSenha ? (
        <SenhaExibidaUmaVez senha={ultimaSenha} usuario={usuario} onEsconder={onEsconder} />
      ) : null}
    </div>
  );
}

export function AcessoPortalCliente({ acesso, razaoSocial }) {
  const {
    usuarios, podeDefinirSenha, papelMinimo, carregando, erro,
    senhaNova, salvandoPara, definirSenha, esconderSenha, recarregar,
  } = acesso || {};

  const lista = estadoDaLista({ carregando, erro, usuarios });

  return (
    <section style={{ marginBottom: "var(--space-6)" }}>
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline", marginBottom: "var(--space-2)", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "var(--text)" }}>{TITULO}</h3>
        <span role="status" style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {carregando ? "carregando…" : null}
        </span>
      </div>

      {/* ⚠ O AVISO VEM ANTES DA LISTA, não depois. Ele existe para ser lido antes de clicar; embaixo
          seria a explicação de um ato já praticado. E ele diz a coisa que mais custa não saber: que
          NÃO EXISTE "ver a senha atual". */}
      <div style={{
        display: "flex", gap: 10, alignItems: "flex-start",
        padding: "10px 12px", borderRadius: "var(--radius-sm)",
        border: "1px solid var(--state-closed)", background: "var(--state-closed-surface)",
        fontSize: 13, lineHeight: 1.45, marginBottom: "var(--space-3)",
      }}>
        <span aria-hidden="true" style={{ color: "var(--state-closed)", fontWeight: 600 }}>🔒</span>
        <span style={{ color: "var(--text)" }}>
          Por segurança, <strong>não existe mostrar a senha atual</strong>. Uma nova senha aparece
          uma única vez para você repassar ao cliente, que também pode trocá-la pelo perfil ou
          pela recuperação por e-mail.
        </span>
      </div>

      {lista.aviso ? (
        <p
          data-testid="aviso-usuarios-portal"
          role={erro ? "alert" : "status"}
          style={{
            fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45,
            marginTop: 0, marginBottom: "var(--space-2)",
          }}
        >
          {lista.aviso}
          {erro && !usuarios?.length ? (
            <>
              {" "}
              <Button type="button" variant="secondary" size="sm" style={{ marginLeft: 6 }} onClick={recarregar}>
                Tentar de novo
              </Button>
            </>
          ) : null}
        </p>
      ) : null}

      {erro && usuarios?.length ? <div role="alert" style={{ marginBottom: 12, fontSize: 13 }}>
        Não foi possível atualizar os usuários. Os dados anteriores foram mantidos.{" "}
        <Button type="button" variant="secondary" size="sm" disabled={carregando} onClick={recarregar}>Tentar de novo</Button>
      </div> : null}
      {lista.usuarios.map((u) => (
        <LinhaUsuario
          key={u.userId}
          usuario={u}
          // ⚠ A senha em claro pertence a UM usuário. Casar por `userId` é o que impede a senha
          // recém-definida de aparecer embaixo da linha errada quando há dois usuários.
          ultimaSenha={senhaNova?.userId === u.userId ? senhaNova.senha : null}
          podeDefinirSenha={podeDefinirSenha}
          papelMinimo={papelMinimo}
          salvando={salvandoPara === u.userId}
          razaoSocial={razaoSocial}
          onDefinir={definirSenha}
          onEsconder={esconderSenha}
        />
      ))}
    </section>
  );
}
