import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { OpcoesProposta } from "../components/FluxoComercial";
export function PropostaPublica({
  api
}) {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [proposta, setProposta] = useState(null),
    [opcao, setOpcao] = useState(""),
    [confirmado, setConfirmado] = useState(false),
    [erro, setErro] = useState(""),
    [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    let vivo = true;
    if (!api.propostaPublica) {
      setErro("A proposta precisa ser aberta no endereço fornecido pelo escritório.");
      return;
    }
    api.propostaPublica(token).then(r => {
      if (vivo) setProposta(r.proposta);
    }).catch(e => {
      if (vivo) setErro(e.message);
    });
    return () => {
      vivo = false;
    };
  }, [api, token]);
  return <main style={{
    maxWidth: 850,
    margin: "40px auto",
    padding: 24
  }}><h1>Proposta de serviços — ALTAN</h1>{api.mode === "mock" && <p>Demonstração local. Nenhum serviço será contratado.</p>}{erro && <p role="alert">{erro}</p>}{proposta ? <><p>Para {proposta.destinatario} · versão {proposta.versao} · válida até {new Date(proposta.expiraEm).toLocaleDateString("pt-BR")}</p><OpcoesProposta proposta={proposta} />{proposta.status === "ACEITA" ? <p role="status">Opção aceita: {proposta.opcaoAceita}. O escritório vai preparar e conferir o contrato para assinatura.</p> : <fieldset disabled={ocupado}><legend>Escolha a opção que deseja contratar</legend>{proposta.opcoes.map(o => <label key={o.chave} style={{
          display: "block",
          padding: 8
        }}><input type="radio" name="opcao" checked={opcao === o.chave} onChange={() => setOpcao(o.chave)} />{o.titulo}</label>)}<label><input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} /> Li o escopo, os valores e as condições desta versão.</label><p>O aceite registra a opção escolhida. A assinatura do contrato é uma etapa separada.</p><Button disabled={!opcao || !confirmado} onClick={async () => {
          if (ocupado) return;
          setOcupado(true);
          setErro("");
          try {
            const r = await api.propostaPublica(token, {
              opcao,
              versao: proposta.versao,
              confirmado
            });
            setProposta(r.proposta);
            history.replaceState(null, "", location.pathname);
          } catch (e) {
            setErro(e.message);
          } finally {
            setOcupado(false);
          }
        }}>Aceitar opção escolhida</Button></fieldset>}</> : !erro && <p>Carregando proposta…</p>}</main>;
}
