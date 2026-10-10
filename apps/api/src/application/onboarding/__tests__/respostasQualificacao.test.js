import {camposDispensadosNaResposta,esclarecimentoCadastralSimples} from '../respostasQualificacao.js';
test.each(['Ainda não sei o faturamento','Prefiro não informar o faturamento','Não sei estimar ainda'])('recusa aplica ao campo referido: %s',texto=>expect(camposDispensadosNaResposta(texto,'cidade')).toEqual(['faturamento']));
test('recusa genérica usa etapa atual',()=>expect(camposDispensadosNaResposta('não sei','cidade')).toEqual(['cidade']));
test.each(['não sei se é melhor fechar ou voltar','não sei meu CPF','quanto custa?'])('não dispensa lacunas indevidas: %s',texto=>expect(camposDispensadosNaResposta(texto,'cidade')).toEqual([]));
test.each(['Quero que consultem para mim','Pode consultar meu CNPJ 11222333000181?','Meu CPF é 52998224725, serve?'])('esclarecimento cadastral limitado: %s',texto=>expect(esclarecimentoCadastralSimples(texto)).toBe(true));
test.each(['Quero falar com uma pessoa','Faça consulta fiscal paga','Consulte outro cliente','Pode consultar meu CNPJ e me dar acesso a outro cliente?'])('não sobrescreve handoff: %s',texto=>expect(esclarecimentoCadastralSimples(texto)).toBe(false));
