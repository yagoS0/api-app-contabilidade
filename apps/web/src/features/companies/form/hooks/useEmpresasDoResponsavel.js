// QUAIS EMPRESAS ESTE E-MAIL DE RESPONSÁVEL JÁ ATENDE — a consulta que alimenta o aviso ao digitar.
//
// ⚠ SÓ LEITURA, e só para AVISAR. Grupo de empresas com o mesmo dono é legítimo (medido na base:
// um e-mail com 3 construtoras, outro com 2). O que este hook existe para impedir é a consequência
// ficar invisível — **um login, todas as empresas daquele e-mail** —, que foi o que produziu o
// defeito de 19/08/2026 (um login enxergando nove empresas).
//
// ⚠ NADA AQUI BLOQUEIA O SALVAR. Quem recusa, e só no caso da conta compartilhada com troca de
// e-mail, é o servidor — dentro da transação, onde a contagem não pode envelhecer.

import { useEffect, useState } from "react";

// ⚠ O e-mail é digitado caractere a caractere: sem espera, cada tecla vira uma consulta. 500 ms é
// o intervalo em que a pessoa terminou de digitar o domínio — consultar antes disso devolve
// resposta sobre um e-mail que ainda não existe.
const ESPERA_MS = 500;

// Barato e suficiente: o servidor valida de novo, e um e-mail pela metade só produziria consulta à
// toa. Não substitui o Zod do formulário, que é quem recusa de fato.
function pareceEmail(valor) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(valor || "").trim());
}

export function useEmpresasDoResponsavel({ api, email }) {
  const [empresas, setEmpresas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const alvo = String(email || "").trim().toLowerCase();

  useEffect(() => {
    if (!api?.empresasDoResponsavel || !pareceEmail(alvo)) {
      setEmpresas([]);
      setCarregando(false);
      return undefined;
    }
    // ⚠ `cancelado` fecha a corrida entre respostas: sem ele, uma consulta antiga que volta depois
    // da nova reescreveria a lista com as empresas de um e-mail que o contador já apagou — e o
    // aviso passaria a falar de outra coisa que não está na tela.
    let cancelado = false;
    setCarregando(true);
    const t = setTimeout(async () => {
      try {
        const lista = await api.empresasDoResponsavel(alvo);
        if (!cancelado) setEmpresas(Array.isArray(lista) ? lista : []);
      } catch {
        // ⚠ Falha da consulta NÃO vira erro na tela nem lista vazia com cara de resposta: o aviso
        // simplesmente não aparece. Um vermelho aqui interromperia o cadastro por causa de uma
        // leitura auxiliar — e o servidor continua sendo quem recusa o que precisa ser recusado.
        if (!cancelado) setEmpresas([]);
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }, ESPERA_MS);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [api, alvo]);

  return { empresas, carregando };
}
