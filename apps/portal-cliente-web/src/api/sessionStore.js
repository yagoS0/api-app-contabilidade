// Guarda do token, FORA do React.
//
// Por que fora: quem precisa do token é o `realApi` (um módulo, não um
// componente) e o refresh acontece no meio de uma requisição, longe de
// qualquer render. Um store minúsculo com `subscribe` deixa o React observar
// via `useSyncExternalStore` sem inverter essa dependência.
//
// ⚠ `expirou` existe para que a volta ao login DIGA o que houve. Sessão que
// morre e devolve uma tela de login muda sem explicação é indistinguível de
// "o app deslogou sozinho".

const CHAVE = "pcw.sessao";
const CHAVE_EMPRESA = "pcw.empresaId";

const VAZIO = { accessToken: null, refreshToken: null, user: null, expirou: false };

function ler() {
  try {
    const raw = window.localStorage.getItem(CHAVE);
    if (!raw) return { ...VAZIO };
    const parsed = JSON.parse(raw);
    return {
      accessToken: parsed?.accessToken || null,
      refreshToken: parsed?.refreshToken || null,
      user: parsed?.user || null,
      expirou: false,
    };
  } catch {
    // localStorage bloqueado (modo privado) ou JSON corrompido: segue sem sessão.
    return { ...VAZIO };
  }
}

function gravar(estado) {
  try {
    if (!estado.accessToken) {
      window.localStorage.removeItem(CHAVE);
      return;
    }
    window.localStorage.setItem(
      CHAVE,
      JSON.stringify({
        accessToken: estado.accessToken,
        refreshToken: estado.refreshToken,
        user: estado.user,
      })
    );
  } catch {
    // Sem persistência a sessão vale só para a aba atual — não é motivo para quebrar.
  }
}

let estado = ler();
const ouvintes = new Set();

function emitir() {
  for (const fn of ouvintes) fn();
}

export function assinarSessao(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

export function lerSessao() {
  return estado;
}

export function definirSessao({ accessToken, refreshToken, user }) {
  estado = { accessToken, refreshToken, user, expirou: false };
  gravar(estado);
  emitir();
}

export function definirTokens({ accessToken, refreshToken }) {
  estado = { ...estado, accessToken, refreshToken, expirou: false };
  gravar(estado);
  emitir();
}

export function limparSessao({ expirou = false } = {}) {
  estado = { ...VAZIO, expirou };
  gravar(estado);
  emitir();
}

export function reconhecerExpiracao() {
  if (!estado.expirou) return;
  estado = { ...estado, expirou: false };
  emitir();
}

// --- Empresa ativa -----------------------------------------------------------
// Mora aqui porque é preferência de sessão, não dado de servidor.

export function lerEmpresaSalva() {
  try {
    return window.localStorage.getItem(CHAVE_EMPRESA) || null;
  } catch {
    return null;
  }
}

export function salvarEmpresa(companyId) {
  try {
    if (companyId) window.localStorage.setItem(CHAVE_EMPRESA, String(companyId));
    else window.localStorage.removeItem(CHAVE_EMPRESA);
  } catch {
    // idem: sem persistência, a escolha vale só para esta sessão.
  }
}
