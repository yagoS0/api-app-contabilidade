import { useEffect, useState } from "react";
import { CampoOnboarding } from "../components/CampoOnboarding";
import { FichaDeclarada } from "../components/PassoRevisao";
import { camposDoPasso, passosVisiveis, podarInvisiveis } from "../lib/onboardingSpec";
import { Button } from "../../../components/ui/Button";

// Token fica só na memória da página e no fragmento do link; nunca localStorage/query string.
export function FormularioPublico({ api }) {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [registro, setRegistro] = useState(null), [dados, setDados] = useState({}), [passo, setPasso] = useState("identificacao");
  const [erro, setErro] = useState(""), [aviso, setAviso] = useState(""), [ocupado, setOcupado] = useState(false), [concluido, setConcluido] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [dadosSalvos, setDadosSalvos] = useState("");
  const dadosAtuais = registro ? JSON.stringify(podarInvisiveis(registro.origem, dados)) : "";
  const alterado = Boolean(registro && !concluido && dadosAtuais !== dadosSalvos);
  useEffect(() => {
    if (!alterado) return;
    const antesDeSair = (evento) => { evento.preventDefault(); evento.returnValue = ""; };
    window.addEventListener("beforeunload", antesDeSair);
    return () => window.removeEventListener("beforeunload", antesDeSair);
  }, [alterado]);
  useEffect(() => {
    let vivo = true;
    if (!token) { setErro("Link incompleto. Peça um novo link ao escritório."); return; }
    api.consultarFormularioOnboarding(token).then((r) => {
      if (!vivo) return; setRegistro(r.onboarding); setDados(r.onboarding.dados || {}); setPasso(r.onboarding.ultimoPasso || "identificacao"); setDadosSalvos(JSON.stringify(podarInvisiveis(r.onboarding.origem, r.onboarding.dados || {})));
    }).catch((e) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [api, token]);
  const passos = registro ? passosVisiveis(registro.origem).filter((p) => p.chave !== "origem") : [];
  const indice = Math.max(0, passos.findIndex((p) => p.chave === passo));
  const atual = passos[indice]?.chave;
  async function salvar(destino = atual, finalizar = false) {
    if (ocupado || !registro || (finalizar && !confirmado)) return;
    setOcupado(true); setErro(""); setAviso("");
    try {
      const r = await api.salvarFormularioOnboarding(token, { dados: podarInvisiveis(registro.origem, dados), ultimoPasso: destino, finalizar, versao: registro.versao });
      setDadosSalvos(JSON.stringify(podarInvisiveis(registro.origem, dados)));
      if (finalizar) { setConcluido(true); window.history.replaceState(null, "", window.location.pathname); }
      else { setRegistro(r.onboarding); setPasso(destino); setAviso("Dados salvos. Você pode continuar depois usando o mesmo link."); }
    } catch (e) { setErro(e.message); } finally { setOcupado(false); }
  }
  return <main style={{ maxWidth: 760, margin: "32px auto", padding: 24 }}>
    <h1>Seu cadastro no escritório</h1>
    <p>Preencha o que souber. Os dados serão conferidos pelo contador. Não informe senhas ou certificados neste formulário.</p>
    {erro && <p role="alert">{erro}</p>}{aviso && <p role="status">{aviso}</p>}
    {concluido ? <h2>Cadastro enviado. O escritório dará continuidade ao atendimento.</h2> : !registro ? <p>{erro ? "Seu preenchimento não foi alterado." : "Carregando formulário…"}</p> : <>
      <p>Etapa {indice + 1} de {passos.length}: {passos[indice]?.titulo}</p>
      <fieldset disabled={ocupado} style={{ border: 0, padding: 0 }}>
        {atual === "revisao" ? <><FichaDeclarada origem={registro.origem} dados={dados} origemPreenchimento="CLIENTE" /><label><input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />Conferi os dados e autorizo seu uso pelo escritório para este atendimento.</label></> : camposDoPasso(registro.origem, atual, dados).map((descritor) => <CampoOnboarding key={descritor.campo} descritor={descritor} dados={dados} valor={dados[descritor.campo]} onChange={(v) => { setDados((d) => ({ ...d, [descritor.campo]: v })); setAviso("Alterações ainda não salvas."); setConfirmado(false); }} origemPreenchimento="CLIENTE" />)}
        <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
          {indice > 0 && <Button variant="secondary" onClick={() => salvar(passos[indice - 1].chave)}>Salvar e voltar</Button>}
          <Button variant="secondary" onClick={() => salvar()}>Salvar para continuar depois</Button>
          {indice < passos.length - 1 ? <Button onClick={() => salvar(passos[indice + 1].chave)}>Salvar e continuar</Button> : <Button disabled={!confirmado} onClick={() => salvar(atual, true)}>Enviar cadastro ao escritório</Button>}
        </div>
      </fieldset>
    </>}
  </main>;
}
