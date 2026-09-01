// O E-MAIL DO RESPONSÁVEL QUE ATENDE VÁRIAS EMPRESAS — as três peças de tela.
//
// ⚠⚠ Defeito de produção (19/08/2026): um login enxergando NOVE empresas. O mesmo e-mail estava
// cadastrado em várias empresas, todas apontando para UMA conta; trocar o e-mail de uma delas
// renomeava a conta compartilhada e levava os nove vínculos junto.
//
// O servidor já não renomeia mais (`application/companies/acessoDoResponsavel.js`). O que está
// aqui é a metade da TELA — a consequência aparecendo ANTES do clique, nas duas horas em que ela
// existe:
//
//   `AvisoEmailCompartilhado`   ao DIGITAR, embaixo do campo. **Avisa, não proíbe.**
//   `ConfirmacaoAcessoProprio`  ao SALVAR, quando o servidor recusou pedindo confirmação.
//   `AvisoAcessoNovoCriado`     DEPOIS, porque a conta nova nasce SEM SENHA.
//
// ⚠ Todo o texto vem de `lib/portal/responsavelCompartilhado.js`. Escrito aqui, a próxima tela a
// consumir a mesma recusa escreveria o seu — e um dos dois diria a coisa errada sobre um ato que
// cria login.
//
// ⚠ NUNCA `--state-danger`. Vermelho, neste projeto, é o que BLOQUEIA o fechamento. Aqui nada
// bloqueia: grupo de empresas com o mesmo dono é legítimo, e a troca confirmada é trabalho normal.

import {
  ONDE_DEFINIR_SENHA,
  TITULO_CONFIRMACAO,
  tituloDaConfirmacao,
  avisoDeAcessoNovo,
  avisoDeVinculoCriado,
  avisoDeEmailCompartilhado,
  fraseDeConfirmacao,
} from "../../../../lib/portal/responsavelCompartilhado";

const BOTAO_BASE = {
  border: "1px solid",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: "0.78rem",
  cursor: "pointer",
  background: "transparent",
};

const CAIXA_AVISO = {
  border: "1px solid var(--state-warn)",
  background: "var(--state-warn-surface)",
  borderRadius: 6,
  padding: "8px 10px",
  display: "grid",
  gap: 6,
  fontSize: "0.78rem",
  color: "var(--text)",
  lineHeight: 1.5,
};

/**
 * O aviso ao DIGITAR. Renderiza `null` quando não há nada a dizer — e essa é a maioria dos casos.
 */
export function AvisoEmailCompartilhado({ email, empresas, empresaAtualId, carregando = false }) {
  const aviso = avisoDeEmailCompartilhado({ email, empresas, empresaAtualId });
  // ⚠ Nada é mostrado enquanto a consulta está no ar. Um "verificando…" piscando a cada tecla é
  // ruído em cima de digitação normal, e o campo mais consultado do formulário é este.
  if (carregando || !aviso) return null;
  return (
    <div style={CAIXA_AVISO} data-testid="aviso-email-responsavel">
      <strong>{aviso.titulo}</strong>
      <span>{aviso.consequencia}</span>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {aviso.nomes.map((nome, i) => (
          <li key={aviso.empresas[i]?.id || nome}>{nome}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A CONFIRMAÇÃO, depois de o servidor recusar com `owner_email_conta_compartilhada`.
 *
 * ⚠ Ela REPETE OS DADOS do ato — de quem é a conta, quantas empresas ela atende, o que acontece
 * com cada lado e que a conta nova nasce sem senha. "Tem certeza?" não é confirmação: aprende-se a
 * clicar sem ler, e o clique na linha errada recebe a mesma pergunta que o clique na certa.
 */
export function ConfirmacaoAcessoProprio({ detalhes, razaoSocial, salvando = false, onConfirmar, onCancelar }) {
  if (!detalhes) return null;
  const frase = fraseDeConfirmacao({ detalhes, razaoSocial });
  // ⚠ O título vem do MODO. Fixo, ele anunciaria "responde por mais de uma empresa" numa tela que
  //   vai VINCULAR a empresa a outra conta — rótulo verdadeiro sobre outra coisa, num ato que
  //   REMOVE o acesso de alguém.
  const titulo = tituloDaConfirmacao(detalhes);
  return (
    <div
      role="alertdialog"
      aria-label={titulo}
      data-testid="confirmacao-acesso-proprio"
      style={{ ...CAIXA_AVISO, gap: 10 }}
    >
      <strong>{titulo}</strong>
      {/* `pre-line` porque a frase já vem quebrada da lib — as quebras separam o que acontece de
          cada lado, e juntá-las num parágrafo só é o que faz ninguém ler. */}
      <div style={{ whiteSpace: "pre-line" }}>{frase}</div>
      {Array.isArray(detalhes.outras) && detalhes.outras.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {detalhes.outras.map((e) => (
            <li key={e.id}>{e.razao || "(sem razão social)"}</li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={salvando}
          style={{
            ...BOTAO_BASE,
            // Ação primária é o accent. ⚠ Verde é CONCLUÍDO neste projeto, nunca comando.
            borderColor: "var(--accent-purple)",
            color: "var(--accent-purple)",
            background: "var(--accent-purple-surface)",
            opacity: salvando ? 0.6 : 1,
          }}
        >
          {salvando ? "Salvando…" : "Sim, criar acesso próprio para esta empresa"}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          disabled={salvando}
          style={{ ...BOTAO_BASE, borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * DEPOIS do salvar: a conta nova existe e não tem senha.
 *
 * ⚠ A ação de definir senha JÁ EXISTE (`Credenciais → Acesso ao portal do cliente`, com auditoria,
 * revogação de sessão e exibição única). Isto APONTA para ela; não se constrói outra.
 */
export function AvisoAcessoNovoCriado({ acessoNovo }) {
  const aviso = avisoDeAcessoNovo(acessoNovo);
  if (!aviso) return null;
  return (
    <div style={CAIXA_AVISO} data-testid="aviso-acesso-novo">
      <strong>Acesso próprio criado — falta a senha</strong>
      <span>{aviso.texto}</span>
      <span style={{ color: "var(--text-muted)" }}>
        Enquanto ninguém definir uma senha em {ONDE_DEFINIR_SENHA}, {aviso.email} não entra no portal.
      </span>
    </div>
  );
}

/**
 * DEPOIS do salvar: a empresa passou a pertencer a uma conta que JÁ EXISTIA.
 *
 * ⚠ Componente SEPARADO do `AvisoAcessoNovoCriado`, e a diferença é a razão de existir: lá o
 * aviso manda DEFINIR SENHA (sem isso o cliente não entra); aqui não há senha a definir, e
 * repetir aquela frase mandaria o contador a uma tela onde não há nada a fazer.
 *
 * ⚠ E ele diz a consequência que ninguém pede: o acesso ANTIGO perdeu esta empresa.
 */
export function AvisoVinculoCriado({ vinculoCriado }) {
  const aviso = avisoDeVinculoCriado(vinculoCriado);
  if (!aviso) return null;
  return (
    <div style={CAIXA_AVISO} data-testid="aviso-vinculo-criado">
      <strong>Empresa vinculada a uma conta existente</strong>
      <span>{aviso.texto}</span>
      <span style={{ color: "var(--text-muted)" }}>
        Quem entrar com {aviso.email} passa a ver esta empresa junto das demais dessa conta.
      </span>
    </div>
  );
}
