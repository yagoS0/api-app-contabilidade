import { empresaIndividual, pessoaPreenchida, cpfValido } from '@contabilidade/shared/onboarding';
import { useEffect, useRef, useState } from "react";
import { cnpjTemDvValido } from "@contabilidade/shared/documentos-fiscais";
import { consultarCnpj, soDigitosCnpj, mapearParaFormularioEmpresa } from "../lib/brasilApi";

// Consulta cadastral não confirma análise comercial nem dispara consultas fiscais.
export function useConsultaCnpjOnboarding({ contexto, origem, dados, alterarCampo, habilitado = true, tokenPublico }) {
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
    try { resultado = await consultarCnpj(cnpj, { tokenPublico }); }
    catch { resultado = { ok: false, mensagem: "Consulta indisponível. Preencha os dados manualmente." }; }
    const agora = atual.current;
    if (numero !== sequencia.current || inicio.contexto !== agora.contexto || inicio.origem !== agora.origem || cnpj !== soDigitosCnpj(agora.dados.cnpj) || !agora.habilitado) return;
    setCarregando(false);
    setConsulta(resultado);
    if (!resultado.ok) return;
    const empresa = { ...resultado.empresa, ...mapearParaFormularioEmpresa(resultado.bruto, { incluirSocios: true }) };
    agora.alterarCampo("cadastroCnpj", { cnpj, fonte: resultado.fonte || "CONSULTA_CADASTRAL", consultadoEm: resultado.consultadoEm || new Date().toISOString(), empresa, situacao: resultado.situacao });
    const campoPessoas = empresaIndividual(agora.dados) ? 'titular' : 'socios';
    if (agora.dados.tipoEmpresa === inicio.dados.tipoEmpresa && JSON.stringify(agora.dados[campoPessoas]) === JSON.stringify(inicio.dados[campoPessoas]) && !(agora.dados[campoPessoas] || []).some(pessoaPreenchida) && empresa.socios?.length) {
      const unicas = [...new Map(empresa.socios.map(p => [cpfValido(p.cpf) ? String(p.cpf).replace(/\D/g, '') : `${p.nome || ''}|${p.cpf || ''}`, p])).values()];
      if (campoPessoas === 'socios' || unicas.length === 1) agora.alterarCampo(campoPessoas, unicas);
    }
    for (const campo of ["razaoSocial", "nomeFantasia"]) {
      // Correções durante a consulta vencem o retorno remoto.
      if (agora.dados[campo] === inicio.dados[campo] && (!agora.dados[campo] || agora.dados[campo] === inicio.dados.cadastroCnpj?.empresa?.[campo])) agora.alterarCampo(campo, empresa[campo] || "");
    }
  }

  useEffect(() => { const sequenciaDaExecucao = sequencia;
    ++sequencia.current;
    setConsulta(null); setCarregando(false);
    if (!permitido || dados.cadastroCnpj?.cnpj === cnpj) return () => { ++sequenciaDaExecucao.current; };
    timerRef.current = setTimeout(consultar, 500);
    return () => { clearTimeout(timerRef.current); ++sequenciaDaExecucao.current; };
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
  function adequarPessoas(campo, indice) {
    const destino = campo === 'socios' ? 'titular' : 'socios';
    const origemLista = dados[campo] || [], destinoLista = (dados[destino] || []).filter(pessoaPreenchida);
    const pessoa = origemLista[indice];
    if (!pessoaPreenchida(pessoa) || destino === 'titular' && destinoLista.length) return;
    editar(destino, [...destinoLista, pessoa]);
    editar(campo, origemLista.filter((_, i) => i !== indice));
  }
  return { consulta, carregando, consultar, editar, adequarPessoas, permitido };
}
