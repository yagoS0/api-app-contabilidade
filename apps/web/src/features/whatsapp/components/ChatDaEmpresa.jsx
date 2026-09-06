// O CHAT DENTRO DA EMPRESA — ao lado das Anotações (F2, 06/09/2026).
//
// > Dono: *"em cada cliente tenha um chat, no mesmo lugar de anotações, assim podemos falar com o
// > cliente e usar as anotações para algo importante"*.
//
// ⚠ ZERO ROTA NOVA: é a MESMA listagem de `/firm/whatsapp/conversas`, com `?empresa`. Uma rota em
// `/firm/companies/:id/whatsapp/*` herdaria o middleware por posição, e `somenteAdminOuContador` ×
// `requireFirmCompanyAccess` são dois eixos de autorização diferentes — o servidor já intersecta
// `?empresa` com a carteira, e é essa a resposta.
//
// ⚠ A LINHA DA LISTA NÃO VEM PARA CÁ. Aqui a empresa é a mesma em todo fio: repeti-la em cada item
// seria ruído. O que muda entre os fios é a PESSOA — daí o seletor, e só quando há mais de uma.

import { useEffect, useMemo, useRef, useState } from "react";
import { useConversasWhatsapp } from "../hooks/useConversasWhatsapp";
import { FioDaConversa, NomeDaPessoa, campo } from "./FioDaConversa";
import { identidadeDaConversa, ordenarConversas } from "../lib/conversasTela";
import { ESCOLHA_DO_FIO, FRASE_SEM_FIO, escolhaDoFio, fioAberto } from "../lib/fiosDaEmpresa";

export function ChatDaEmpresa({ api, companyId, feedback = null }) {
  const hook = useConversasWhatsapp({ api, feedback, empresa: companyId });
  const [escolhido, setEscolhido] = useState(null);

  const fios = useMemo(() => ordenarConversas(hook.conversas), [hook.conversas]);
  const escolha = escolhaDoFio(fios);
  const fio = fioAberto(fios, escolhido);

  // ⚠ O fio ABERTO (com as mensagens) é OUTRA consulta: a listagem traz só o resumo.
  const aberto = hook.aberta?.conversa?.id === fio?.id ? hook.aberta : null;

  // ⚠⚠ Aqui o fio abre SOZINHO — é uma aba de conversa, não uma caixa de entrada: pedir um clique
  // para ver o que já está na tela é atrito. ⚠ A tentativa é registrada num ref: se `abrir` falhar,
  // `aberta` não muda e o efeito rodaria de novo para sempre — o mesmo id não é tentado duas vezes.
  const tentado = useRef(null);
  const abrir = hook.abrir;
  useEffect(() => {
    if (!fio?.id || aberto || tentado.current === fio.id) return;
    tentado.current = fio.id;
    abrir(fio.id);
  }, [fio?.id, aberto, abrir]);

  return (
    <section data-testid="chat-da-empresa" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>WhatsApp</h2>
        {escolha.situacao === ESCOLHA_DO_FIO.ESCOLHER ? (
          <label style={{ fontSize: "0.76rem", color: "var(--text-muted)", display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
            Falando com
            <select
              aria-label="Contato da conversa"
              data-testid="seletor-de-contato"
              style={{ ...campo, width: "auto" }}
              value={fio?.id || ""}
              onChange={(e) => { tentado.current = e.target.value; setEscolhido(e.target.value); hook.abrir(e.target.value); }}
            >
              {escolha.fios.map((c) => {
                const i = identidadeDaConversa(c);
                return <option key={c.id} value={c.id}>{i.papel ? `${i.pessoa} · ${i.papel}` : i.pessoa}</option>;
              })}
            </select>
          </label>
        ) : null}
      </div>

      {hook.carregando && !fios.length ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Carregando as conversas…</p>
      ) : null}

      {/* ⚠ Falha de carga NÃO é "não há conversa": a lista pode existir e não ter sido lida. */}
      {hook.erro && !fios.length ? (
        <p role="status" data-testid="chat-falha" style={{ color: "var(--state-warn)", fontSize: "0.82rem" }}>
          Não foi possível ler as conversas desta empresa{hook.erro.mensagem ? `: ${hook.erro.mensagem}` : ""}. Não dá para afirmar que não há nenhuma.
        </p>
      ) : null}

      {!hook.carregando && !hook.erro && escolha.situacao === ESCOLHA_DO_FIO.VAZIO ? (
        <p data-testid="chat-sem-fio" style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>{FRASE_SEM_FIO}</p>
      ) : null}

      {fio && !aberto ? (
        <div>
          {/* Enquanto o fio não chega, a identidade de quem está do outro lado já aparece. */}
          <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
            <NomeDaPessoa identidade={identidadeDaConversa(fio)} />
          </div>
          <p data-testid="chat-abrindo" style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Abrindo a conversa…</p>
        </div>
      ) : null}

      {aberto ? <FioDaConversa fio={aberto} hook={hook} temMais={hook.temMaisNoFio} /> : null}
    </section>
  );
}

export default ChatDaEmpresa;
