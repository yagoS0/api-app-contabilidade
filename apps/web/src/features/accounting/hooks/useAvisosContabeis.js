import { useEffect, useState } from "react";
import { createApiClient } from "../../../api/client";
const api = createApiClient();
export function useAvisosContabeis(companyId, competencia) {
  const chave = `${companyId || ""}:${competencia || ""}`;
  const [estado, setEstado] = useState({ dados: null, erro: null, carregando: true });
  const [revisao, setRevisao] = useState(0);
  useEffect(() => {
    const atualizar = () => setRevisao(v => v + 1);
    window.addEventListener("altan:avisos-contabeis", atualizar);
    return () => window.removeEventListener("altan:avisos-contabeis", atualizar);
  }, []);
  useEffect(() => {
    let ativo = true;
    setEstado(anterior => ({ chave, dados: anterior.chave === chave ? anterior.dados : null, erro: null, carregando: true }));
    if (!companyId) return () => { ativo = false; };
    Promise.resolve().then(() => api.getAvisosContabeis(companyId, { competencia })).then(dados => {
      if (!dados || dados.ok !== true || !Number.isInteger(dados.total) || !Array.isArray(dados.correcoes) || !Array.isArray(dados.pagamentos) || !Array.isArray(dados.historico)) throw Error("Não foi possível consultar os avisos contábeis.");
      if (ativo) setEstado({ chave, dados, erro: null, carregando: false });
    }).catch(e => { if (ativo) setEstado(anterior => ({ chave, dados: anterior.chave === chave ? anterior.dados : null, erro: e.message, carregando: false })); });
    return () => { ativo = false; };
  }, [companyId, competencia, revisao, chave]);
  return { ...(estado.chave === chave ? estado : { dados: null, erro: null, carregando: true }), atualizar: () => setRevisao(v => v + 1) };
}
