import { useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// O histórico guarda só contexto de navegação; dados e conclusão continuam na API.
export function useCalendarioNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const ultimaVisao = useRef(null);
  const contexto = location.state?.obrigacoesContext || {};
  const onContextChange = useCallback((valor) => { ultimaVisao.current = valor; }, []);
  const abrir = useCallback((opcoes = {}) => {
    const origem = /^\/companies(?:\/[^/]+\/obrigacoes)?$/.test(location.pathname) ? location.pathname : "/companies";
    navigate("/obrigacoes", { state: { obrigacoesContext: {
      origem, calendario: ultimaVisao.current,
      companyId: opcoes.companyId || ultimaVisao.current?.empresaFiltro || "",
      periodo: opcoes.criar || opcoes.ocorrenciaId ? null : { dataInicio: opcoes.dataInicio, dataFim: opcoes.dataFim },
      criacao: opcoes.criar ? { companyId: opcoes.companyId || ultimaVisao.current?.empresaFiltro || "", dataInicio: opcoes.dataInicio, dataFim: opcoes.dataFim } : null,
      ocorrenciaId: opcoes.ocorrenciaId || null,
    } } });
  }, [location.pathname, navigate]);
  const voltar = useCallback((data, companyId) => {
    const origem = /^\/companies(?:\/[^/]+\/obrigacoes)?$/.test(contexto.origem || "") ? contexto.origem : "/companies";
    const calendario = { ...(contexto.calendario || {}) };
    if (typeof data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
      calendario.referencia = data;
      if (!calendario.visao || calendario.visao === "ano") calendario.visao = "mes";
    }
    if (companyId) calendario.empresaFiltro = companyId;
    navigate(origem, { state: { calendarContext: calendario } });
  }, [contexto, navigate]);
  const criado = useCallback((resultado) => {
    navigate("/obrigacoes", { replace: true, state: { obrigacoesContext: {
      ...contexto, criacao: null, ocorrenciaId: null,
      companyId: resultado.companyId || contexto.companyId || "",
    } } });
  }, [contexto, navigate]);
  return { abrir, voltar, criado, onContextChange, initialContext: location.state?.calendarContext, contexto };
}
