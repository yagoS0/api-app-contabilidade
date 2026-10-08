import { useEffect, useRef, useState } from "react";
import { cnpjTemDvValido } from "@contabilidade/shared/documentos-fiscais";
import { consultarCnpj, soDigitosCnpj, mapearParaFormularioEmpresa } from "../lib/brasilApi";

// Consulta cadastral não confirma análise comercial nem dispara consultas fiscais.
export function useConsultaCnpjOnboarding({ contexto, origem, dados, alterarCampo, habilitado = true }) {
  const atual = useRef({});
  atual.current = { contexto, origem, dados, alterarCampo, habilitado };
  const sequencia = useRef(0);
  const timerRef = useRef(null);
  const [consulta, setConsulta] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const cnpj = soDigitosCnpj(dados.cnpj);
  const permitido = habilitado && origem !== "PESSOA_FISICA" && cnpjTemDvValido(cnpj);

  async function consultar() {
    if (!permitido) return;
    clearTimeout(timerRef.current);
    const numero = ++sequencia.current;
    const inicio = { ...atual.current, dados: { ...atual.current.dados } };
    setCarregando(true);
    let resultado;
    try { resultado = await consultarCnpj(cnpj); }
    catch { resultado = { ok: false, mensagem: "Consulta indisponível. Preencha os dados manualmente." }; }
    const agora = atual.current;
    if (numero !== sequencia.current || inicio.contexto !== agora.contexto || inicio.origem !== agora.origem || cnpj !== soDigitosCnpj(agora.dados.cnpj) || !agora.habilitado) return;
    setCarregando(false);
    setConsulta(resultado);
    if (!resultado.ok) return;
    const empresa = { ...resultado.empresa, ...mapearParaFormularioEmpresa(resultado.bruto) };
    agora.alterarCampo("cadastroCnpj", { cnpj, fonte: "BRASIL_API", consultadoEm: new Date().toISOString(), empresa, situacao: resultado.situacao });
    for (const campo of ["razaoSocial", "nomeFantasia"]) {
      // Correções durante a consulta vencem o retorno remoto.
      if (agora.dados[campo] === inicio.dados[campo] && (!agora.dados[campo] || agora.dados[campo] === inicio.dados.cadastroCnpj?.empresa?.[campo])) agora.alterarCampo(campo, empresa[campo] || "");
    }
  }

  useEffect(() => {
    ++sequencia.current;
    setConsulta(null); setCarregando(false);
    if (!permitido || dados.cadastroCnpj?.cnpj === cnpj) return () => { ++sequencia.current; };
    timerRef.current = setTimeout(consultar, 500);
    return () => { clearTimeout(timerRef.current); ++sequencia.current; };
    // Edições em outros campos não repetem nem cancelam a consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto, origem, cnpj, habilitado]);

  function editar(campo, valor) {
    if (campo === "cnpj" && soDigitosCnpj(valor) !== cnpj) {
      ++sequencia.current;
      for (const nome of ["razaoSocial", "nomeFantasia"]) {
        if (dados.cadastroCnpj && dados[nome] === dados.cadastroCnpj.empresa?.[nome]) alterarCampo(nome, "");
      }
      alterarCampo("cadastroCnpj", null);
      setConsulta(null); setCarregando(false);
    }
    alterarCampo(campo, valor);
  }
  return { consulta, carregando, consultar, editar, permitido };
}
