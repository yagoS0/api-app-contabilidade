import { useEffect, useRef, useState } from "react";
import { CampoOnboarding } from "../components/CampoOnboarding";
import { FichaDeclarada } from "../components/PassoRevisao";
import { camposDoPasso, passosVisiveis, podarInvisiveis } from "../lib/onboardingSpec";
import { ConsultaCnpjOnboarding } from "../components/ConsultaCnpjOnboarding";
import { useConsultaCnpjOnboarding } from "../hooks/useConsultaCnpjOnboarding";
import { Button } from "../../../components/ui/Button";

const AJUDAS_CLIENTE = {
  razaoSocial: "Informe o nome que você gostaria de usar na nova empresa.",
  tipoEmpresa: "Se ainda não souber, deixe em branco. O contador ajudará na escolha.",
  atividadePretendida: "Descreva os produtos ou serviços que sua empresa vai oferecer.",
  capitalSocialPretendido: "Se souber, informe o valor que pretende investir para iniciar a empresa.",
};
const descritorDoCliente = (d, origem) => origem === "ABERTURA" && AJUDAS_CLIENTE[d.campo]
  ? { ...d, ajuda: AJUDAS_CLIENTE[d.campo] } : d;

// Token fica só na memória da página e no fragmento do link; nunca localStorage/query string.
export function FormularioPublico({ api }) {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [registro, setRegistro] = useState(null), [dados, setDados] = useState({}), [passo, setPasso] = useState("identificacao");
  const [erro, setErro] = useState(""), [aviso, setAviso] = useState(""), [ocupado, setOcupado] = useState(false), [concluido, setConcluido] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [dadosSalvos, setDadosSalvos] = useState("");
  const tituloEtapa = useRef(null);
  const etapaAnterior = useRef(null);
  function alterarCampo(campo, valor) { setDados(d => ({ ...d, [campo]: valor })); setAviso("Alterações ainda não salvas."); setConfirmado(false); }
  const cnpj = useConsultaCnpjOnboarding({ contexto: token, origem: registro?.origem, dados, alterarCampo, habilitado: Boolean(registro && !concluido) });
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
  useEffect(() => {
    if (etapaAnterior.current && atual && etapaAnterior.current !== atual) {
      tituloEtapa.current?.focus({ preventScroll: true });
      tituloEtapa.current?.scrollIntoView?.({ block: "start", behavior: "instant" });
    }
    etapaAnterior.current = atual;
  }, [atual]);
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
  return <main className="onboarding-workspace onboarding-public">
    <header className="onboarding-public__header"><span className="onboarding-eyebrow">ALTAN · ENTRADA DE CLIENTES</span>
    <h1>{registro?.origem === "ABERTURA" ? "Vamos preparar a abertura da sua empresa" : "Seu cadastro no escritório"}</h1>
    <p>Preencha o que souber. Os dados serão conferidos pelo contador. Não informe senhas ou certificados neste formulário.</p>
    {registro?.origem === "ABERTURA" && <p>Você ainda não precisa ter CNPJ. Conte sobre a empresa que pretende abrir.</p>}</header>
    {erro && <p role="alert">{erro}</p>}{aviso && <p role="status">{aviso}</p>}
    {concluido ? <h2>Cadastro enviado. O escritório dará continuidade ao atendimento.</h2> : !registro ? <p>{erro ? "Seu preenchimento não foi alterado." : "Carregando formulário…"}</p> : <>
      <div className="onboarding-public__progress"><h2 ref={tituloEtapa} tabIndex={-1} style={{ scrollMarginTop: 24 }}>Etapa {indice + 1} de {passos.length}: {passos[indice]?.titulo}</h2><progress aria-label="Progresso do formulário" value={indice + 1} max={passos.length} /></div>
      <fieldset disabled={ocupado} className="onboarding-public__fields">
        <legend style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" }}>{passos[indice]?.titulo}</legend>
        {atual === "identificacao" && <ConsultaCnpjOnboarding consulta={cnpj.consulta} carregando={cnpj.carregando} cadastro={dados.cadastroCnpj} />}
        {atual === "revisao" ? <><FichaDeclarada origem={registro.origem} dados={dados} origemPreenchimento="CLIENTE" /><label className="onboarding-public__consent"><input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} /><span>Conferi os dados e autorizo seu uso pelo escritório para este atendimento.</span></label></> : camposDoPasso(registro.origem, atual, dados).map((descritor) => <CampoOnboarding key={descritor.campo} descritor={descritorDoCliente(descritor, registro.origem)} dados={dados} valor={dados[descritor.campo]} onChange={(v) => cnpj.editar(descritor.campo, v)} acaoExtra={descritor.consultaReceita ? <Button type="button" variant="secondary" disabled={!cnpj.permitido || cnpj.carregando} onClick={cnpj.consultar}>Consultar novamente</Button> : null} origemPreenchimento="CLIENTE" />)}
        <div className="onboarding-public__actions">
          {indice > 0 && <Button variant="secondary" onClick={() => salvar(passos[indice - 1].chave)}>Salvar e voltar</Button>}
          <Button variant="secondary" onClick={() => salvar()}>Salvar para continuar depois</Button>
          {indice < passos.length - 1 ? <Button onClick={() => salvar(passos[indice + 1].chave)}>Salvar e continuar</Button> : <Button disabled={!confirmado} onClick={() => salvar(atual, true)}>Enviar cadastro ao escritório</Button>}
        </div>
      </fieldset>
    </>}
  </main>;
}
