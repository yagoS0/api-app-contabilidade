import { identificarOrigemComercial, interpretarColetaComercial, pedidoOperacionalComercial, responderDuvidaComercial } from "../interpretacaoComercialWhatsapp.js";

const ler = (texto, campoEsperado = null, origem = "ABERTURA") => interpretarColetaComercial({ texto, campoEsperado, origem });
const dados = resultado => Object.fromEntries(resultado.operacoes.map(o => [o.campo, o.valor]));

test.each([
  ["Sou médico e preciso de CNPJ para meu consultório", "ABERTURA"],
  ["Quero abrir um MEI", "ABERTURA"], ["Preciso de um CNPJ", "ABERTURA"],
  ["Quero tirar um CNPJ para trabalhar", "ABERTURA"], ["quero formalizar meu negócio", "ABERTURA"],
  ["Gostaria de trocar meu contador", "TRANSFERENCIA"], ["Meu CNPJ está inapto", "INATIVA"],
  ["Preciso regularizar meu MEI", "INATIVA"], ["A empresa está inativa", "INATIVA"],
  ["Quero dar baixa na empresa", "INATIVA"], ["Quero abrir uma e transferir outra empresa", "MULTIPLOS"],
  ["Não quero abrir empresa, já tenho CNPJ", null], ["Não preciso de um CNPJ", null],
  ["Minha empresa não está inativa", null], ["Não quero trocar contador", null],
  ["Não quero abrir empresa, quero trocar de contador", "TRANSFERENCIA"], ["Vocês abrem empresa?", "ABERTURA"],
])("interpreta intenção afirmada: %s", (texto, esperado) => expect(identificarOrigemComercial(texto)).toBe(esperado));

test("clique usa ID estável, sem acreditar no título", () => {
  expect(identificarOrigemComercial("Empresa parada", { list_reply: { id: "altan.comercial.abertura.v1" } })).toBe("ABERTURA");
});

test.each([
  ["só abertura", "AVULSO"], ["avulso", "AVULSO"], ["só o serviço", "AVULSO"], ["serviço pontual", "AVULSO"],
  ["mensal", "RECORRENTE"], ["abertura e contabilidade", "RECORRENTE"], ["com contabilidade", "RECORRENTE"],
  ["as duas opções", "COMPARAR"], ["os dois", "COMPARAR"], ["quero comparar", "COMPARAR"],
  ["não quero contabilidade mensal", "AVULSO"], ["sem mensalidade", "AVULSO"],
])("entende a escolha oferecida: %s", (texto, esperado) => expect(dados(ler(texto, "modalidadeServico")).modalidadeServico).toBe(esperado));

test("opção isolada depende da pergunta, não vira modalidade fora de contexto", () => {
  expect(dados(ler("mensal", "atividadePretendida")).modalidadeServico).toBeUndefined();
});

test.each([
  ["não", 0], ["só eu", 0], ["nenhum", 0], ["não tenho", 0], ["dois", 2], ["2", 2], ["dois funcionários", 2], ["Tenho 5 funcionários", 5],
])("funcionários em linguagem cotidiana: %s", (texto, esperado) => expect(dados(ler(texto, "qtdFuncionarios")).qtdFuncionarios).toBe(esperado));

test("não isolado em outro campo não significa zero funcionários", () => {
  expect(ler("não", "responsavelNome").operacoes).toEqual([]);
});

test.each([
  ["desde janeiro de 2023", "2023-01"], ["janeiro de 2023", "2023-01"], ["desde 01/2022", "2022-01"], ["1/2022", "2022-01"],
])("inatividade com mês e ano explícitos: %s", (texto, esperado) => expect(dados(ler(texto, "paradaDesde", "INATIVA")).paradaDesde).toBe(esperado));

test.each(["desde 2022", "2020", "em 2024"])("pede mês sem inventar precisão para %s", texto => {
  const r = ler(texto, "paradaDesde", "INATIVA");
  expect(r.operacoes).toEqual([]); expect(r.resposta).toContain("Em que mês"); expect(r.respostaSubstituiPergunta).toBe(true);
  expect(r.anoParadaPendente).toMatch(/^\d{4}$/);
});

test.each([["janeiro", "01"], ["5", "05"], ["05", "05"], ["em março", "03"]])("mês isolado usa somente o ano declarado antes: %s", (texto, mes) => {
  const r = interpretarColetaComercial({ texto, origem: "INATIVA", campoEsperado: "paradaDesde", anoParadaPendente: "2020" });
  expect(dados(r)).toEqual({ paradaDesde: `2020-${mes}` }); expect(r.anoParadaPendente).toBeNull();
  expect(ler(texto, "paradaDesde", "INATIVA").operacoes).toEqual([]);
  expect(interpretarColetaComercial({ texto, origem: "INATIVA", campoEsperado: "cnpj", anoParadaPendente: "2020" }).operacoes).toEqual([]);
});
test("data explícita corrige o ano pendente; desconhecimento encerra a pergunta sem inventar mês", () => {
  const contexto = { origem: "INATIVA", campoEsperado: "paradaDesde", anoParadaPendente: "2020" };
  const corrigido = interpretarColetaComercial({ ...contexto, texto: "janeiro de 2023" });
  expect(dados(corrigido)).toEqual({ paradaDesde: "2023-01" }); expect(corrigido.anoParadaPendente).toBeNull();
  const desconhecido = interpretarColetaComercial({ ...contexto, texto: "não sei" });
  expect(desconhecido).toMatchObject({ operacoes: [], desconhecido: "paradaDesde", anoParadaPendente: null });
  expect(interpretarColetaComercial({ ...contexto, texto: "13" }).operacoes).toEqual([]);
  expect(interpretarColetaComercial({ ...contexto, texto: "2021" })).toMatchObject({ operacoes: [], anoParadaPendente: "2021" });
});

test.each([["quero fechar", "BAIXAR"], ["quero voltar", "REATIVAR"], ["dar baixa", "BAIXAR"], ["não sei", "INDECISO"]])("objetivo da empresa parada: %s", (texto, esperado) => {
  expect(dados(ler(texto, "pretendeReativar", "INATIVA")).pretendeReativar).toBe(esperado);
});

test.each(["voltei", "pode continuar", "já falei com vocês antes", "já mandei meu nome"])("retomada preserva cadastro: %s", texto => {
  const r = ler(texto, "responsavelNome"); expect(r.retomada).toBe(true); expect(r.operacoes).toEqual([]);
});
test.each(["tudo bem", "obrigado", "ok", "só um momento", "vou procurar e te mando"])("ack não vira nome ou erro: %s", texto => {
  const r = ler(texto, "responsavelNome"); expect(r.aguardar).toBe(true); expect(r.operacoes).toEqual([]);
});
test.each(["recomeçar", "quero reiniciar", "começar de novo", "cancelar atendimento"])("reinício é pedido, sem apagar dados: %s", texto => {
  const r = ler(texto, "responsavelNome"); expect(r.reinicio).toBe(true); expect(r.operacoes).toEqual([]);
});
test.each(["Olá", "Bom dia!", "quero orçamento", "Qual o prazo?", "Pode me ajudar?", "Sou médico", "Sou de Niterói"])("não registra fala social/dúvida/profissão como nome: %s", texto => {
  expect(dados(ler(texto, "responsavelNome")).responsavelNome).toBeUndefined();
});

test("aproveita nome, atividade e cidade de uma mensagem sem misturar os campos", () => {
  expect(dados(ler("Sou Ana, médica, moro em Niterói/RJ", "responsavelNome"))).toEqual({ responsavelNome: "Ana", atividadePretendida: "médica", municipioAtendimento: "Niterói/RJ" });
  expect(dados(ler("Meu nome é Caio, sou médico e moro em Rio de Janeiro, RJ", "responsavelNome"))).toEqual({ responsavelNome: "Caio", atividadePretendida: "médico", municipioAtendimento: "Rio de Janeiro, RJ" });
});
test("nome pode acompanhar email; não obriga repetir informação", () => {
  expect(dados(ler("Ana e meu email é ana@example.test", "responsavelNome"))).toEqual({ responsavelNome: "Ana", responsavelEmail: "ana@example.test" });
});
test("motivo da troca pode vir junto com a intenção", () => {
  expect(dados(ler("Quero trocar de contador porque o atual demora a responder", null, "TRANSFERENCIA")).motivoTroca).toBe("o atual demora a responder");
});

test.each([
  "Preço", "O preço", "Pelo preço", "Valor", "Honorários altos", "Muito caro", "Atendimento", "Falta de retorno",
  "preco", "O preço está muito alto", "É pelo valor que pago", "A mensalidade aumentou", "O valor e o atendimento",
  "ta mt caro", "tá caríssimo", "Não gostei do atendimento", "Não me respondem", "Não tenho retorno",
  "Quero pagar menos", "Preciso de um atendimento melhor", "É o preço, não o atendimento", "Não é pelo preço, é pelo atendimento",
])("resposta natural ao motivo da troca não vira pergunta de orçamento: %s", texto => {
  const r = ler(texto, "motivoTroca", "TRANSFERENCIA");
  expect(dados(r).motivoTroca).toBe(texto); expect(r.resposta).toBeNull();
});

test.each([
  "Quanto custa?", "Qual o preço?", "Qual é o valor da mensalidade?", "Preço?", "Valor?", "Qual valor",
  "Me passa o valor", "Quero saber o preço", "Pode informar os honorários", "O preço de vocês", "Seus honorários",
  "qto fica", "quanto tá a mensalidade", "Queria um orçamento", "Não sei o preço de vocês",
])("pergunta explícita de valores durante o motivo continua sendo dúvida: %s", texto => {
  const r = ler(texto, "motivoTroca", "TRANSFERENCIA");
  expect(dados(r).motivoTroca).toBeUndefined(); expect(r.resposta).toContain("O valor depende");
});
test.each(["Preço", "Valor", "Mensalidade"])("palavra de preço fora da pergunta de motivo continua como dúvida: %s", texto => {
  const r = ler(texto, "responsavelNome", "TRANSFERENCIA");
  expect(r.operacoes).toEqual([]); expect(r.resposta).toContain("O valor depende");
});
test.each(["Não sei", "menu", "Falar com a equipe", "Como funciona o atendimento?", "Qual o prazo?"])("dúvida e navegação não viram motivo da troca: %s", texto => {
  expect(dados(ler(texto, "motivoTroca", "TRANSFERENCIA")).motivoTroca).toBeUndefined();
});
test("CNPJ é validado, normalizado e nunca cria vínculo", () => {
  expect(dados(ler("11.222.333/0001-81", "cnpj", "TRANSFERENCIA"))).toEqual({ cnpj: "11222333000181" });
  const r = ler("11.222.333/0001-00", "cnpj", "TRANSFERENCIA"); expect(r.operacoes).toEqual([]); expect(r.resposta).toContain("CNPJ");
});
test("desconhecimento respeita campo solicitado e não contamina outros", () => {
  expect(ler("não sei", "cnpj", "TRANSFERENCIA").desconhecido).toBe("cnpj");
  expect(ler("não tenho o CNPJ comigo", "cnpj", "TRANSFERENCIA").desconhecido).toBe("cnpj");
  expect(ler("não sei meu faturamento", "cnpj", "TRANSFERENCIA").desconhecido).toBeNull();
  expect(ler("não sei quantas notas recebo", "cnpj", "TRANSFERENCIA").desconhecido).toBeNull();
  expect(ler("não sei quantas notas recebo", "notasRecebidasMes", "TRANSFERENCIA").desconhecido).toBe("notasRecebidasMes");
  expect(ler("Minha empresa está parada e não sei o que fazer", null, "INATIVA").desconhecido).toBeNull();
  expect(ler("ainda não tenho endereço", "enderecoPretendido").desconhecido).toBe("enderecoPretendido");
});

test.each([
  ["Quanto custa abrir uma empresa?", "valor depende"], ["Quais documentos preciso?", "documentos dos sócios"],
  ["Qual o prazo?", "prazo depende"], ["Como funciona?", "viabilidade"],
  ["Como faço a procuração?", "senha gov.br"], ["Por que precisam do CNPJ?", "razão social"],
  ["Qual a diferença entre as opções?", "serviço pontual"], ["Posso mandar áudio?", "mensagem de texto"],
])("dúvida tem resposta específica sem valores inventados: %s", (texto, trecho) => {
  const resposta = responderDuvidaComercial(texto, { origem: "ABERTURA" });
  expect(resposta.toLowerCase()).toContain(trecho); expect(resposta).not.toMatch(/R\$|\d+ dias|\d+,\d{2}/);
});
test("sinal de interrogação sozinho não provoca resposta sobre preço", () => expect(responderDuvidaComercial("Rio de Janeiro?")).toBeNull());
test.each(["Você é uma IA?", "Quem está falando?", "Com quem estou falando?"])("identifica automação e oferece equipe sem inventar atendente: %s", texto => {
  const r = ler(texto, "responsavelNome"); expect(r.operacoes).toEqual([]); expect(r.resposta).toContain("atendimento automático da Altan");
});
test("repergunta específica substitui pergunta geral, mas FAQ preserva pergunta pendente", () => {
  expect(ler("sim", "qtdFuncionarios")).toMatchObject({ operacoes: [], resposta: "Quantos funcionários, sem contar os sócios?", respostaSubstituiPergunta: true });
  expect(ler("11.222.333/0001-00", "cnpj", "TRANSFERENCIA").respostaSubstituiPergunta).toBe(true);
  expect(ler("Quanto custa?", "responsavelNome").respostaSubstituiPergunta).toBe(false);
});
test("antes da classificação, explicação de documentos e processo inclui abertura sem exigir CNPJ", () => {
  expect(responderDuvidaComercial("Quais documentos preciso?")).toContain("Na abertura");
  expect(responderDuvidaComercial("Como funciona?")).toContain("abrir uma empresa");
});
test("pergunta composta preserva dados explícitos sem transformar dúvida em atividade", () => {
  const r = ler("Sou Ana, médica, quanto custa?", "responsavelNome");
  expect(dados(r)).toEqual({ responsavelNome: "Ana", atividadePretendida: "médica" }); expect(r.resposta).toContain("valor depende");
  expect(responderDuvidaComercial("Vocês abrem empresa?")).toContain("Podemos ajudar");
});
test("objetivo futuro não dispara emissão; pedidos reais permanecem operacionais", () => {
  expect(pedidoOperacionalComercial("Quero abrir uma empresa para emitir notas")).toBe(false);
  expect(pedidoOperacionalComercial("Meu faturamento mensal é 10000")).toBe(false);
  expect(pedidoOperacionalComercial("Meu faturamento é R$ 10000")).toBe(false);
  expect(pedidoOperacionalComercial("Não sei meu faturamento")).toBe(false);
  for (const t of ["Me manda a guia", "Quero emitir nota", "Qual o faturamento?", "trocar de empresa", "documentos da empresa"]) expect(pedidoOperacionalComercial(t)).toBe(true);
});
test.each(["faturamento", "meu faturamento", "faturamento de agosto", "faturamemto de agosto"])("atalho de consulta permanece operacional e não vira nome: %s", texto => {
  expect(pedidoOperacionalComercial(texto)).toBe(true);
  if (!texto.includes("faturamemto")) expect(dados(ler(texto, "responsavelNome")).responsavelNome).toBeUndefined();
});
test.each(["Também me mande as guias em aberto", "Quero meu faturamento de agosto", "Preciso dos documentos da empresa"])("objetivo de abertura não oculta pedido operacional misto: %s", pedido => {
  expect(pedidoOperacionalComercial(`Quero abrir empresa para emitir notas. ${pedido}`)).toBe(true);
});

test.each([
  "Qual a diferença entre só abertura e mensal?", "O que está incluído na contabilidade mensal?",
  "Quero saber o preço da contabilidade mensal", "Se eu quiser só abertura, quanto fica?",
  "Talvez eu queira contabilidade mensal", "Estou pensando em só abertura", "Não quero só abertura",
  "Não quero comparar", "Não preciso de contabilidade mensal?", "Posso contratar só abertura?",
  "E se eu contratar contabilidade mensal?", "Contabilidade mensal ou serviço avulso?",
  "Pensei em contratar contabilidade mensal", "Qual seria melhor, contabilidade mensal",
])("pergunta, hipótese e negação não escolhem modalidade: %s", texto => {
  expect(dados(ler(texto, "modalidadeServico")).modalidadeServico).toBeUndefined();
});

test.each([
  ["quero abrir e ter contador", "RECORRENTE"], ["quero abrir com um contador", "RECORRENTE"],
  ["Quero contabilidade mensal; quanto custa?", "RECORRENTE"],
  ["Não quero só abertura, quero comparar", "COMPARAR"],
  ["Não quero contabilidade mensal, quero só abertura", "AVULSO"],
])("decisão explícita continua válida em texto livre: %s", (texto, modalidade) => {
  expect(dados(ler(texto, "modalidadeServico")).modalidadeServico).toBe(modalidade);
});

test.each([
  "Posso dar baixa?", "Quanto custa dar baixa?", "É melhor reativar ou fechar a empresa?",
  "Se eu reativar, como funciona?", "Talvez eu queira dar baixa", "Estou pensando em reativar",
  "Não quero reativar", "Não vou dar baixa", "Não gostaria de reativar", "Não tenho interesse em reativar",
  "Quero reativar ou dar baixa", "Quero reativar e depois dar baixa",
])("dúvida e objetivo não decidido preservam a empresa parada: %s", texto => {
  const r = dados(ler(texto, "pretendeReativar", "INATIVA"));
  expect(r.pretendeReativar).toBeUndefined(); expect(r.modalidadeServico).toBeUndefined();
});

test.each(["Quero dar baixa", "Quero fechar", "Quero encerrar minha empresa", "Não quero reativar, quero dar baixa"])("encerramento explícito é serviço avulso: %s", texto => {
  expect(dados(ler(texto, "pretendeReativar", "INATIVA"))).toMatchObject({ pretendeReativar: "BAIXAR", modalidadeServico: "AVULSO" });
});
test("mudança explícita de baixa para reativação pede uma nova escolha de modalidade", () => {
  const r = interpretarColetaComercial({ texto: "Quero reativar", origem: "INATIVA", campoEsperado: "cnpj", dadosAtuais: { pretendeReativar: "BAIXAR", modalidadeServico: "AVULSO" } });
  expect(r.operacoes).toContainEqual({ campo: "pretendeReativar", acao: "set", valor: "REATIVAR" });
  expect(r.operacoes).toContainEqual({ campo: "modalidadeServico", acao: "unset" });
});
test("mensalidade não substitui silenciosamente pedido anterior de encerramento", () => {
  const r = interpretarColetaComercial({ texto: "Quero contabilidade mensal", origem: "INATIVA", campoEsperado: "cnpj", dadosAtuais: { pretendeReativar: "BAIXAR", modalidadeServico: "AVULSO" } });
  expect(r.operacoes).toEqual([]); expect(r.resposta).toContain("nova solicitação");
});

test.each(["Aguarda um pouco", "Espera aí", "Pera aí", "Peraí", "Só um minutinho", "Pode aguardar um momento?", "Já te mando", "Um minuto, por favor", "Aguarda um pouco, estou no trabalho"])("pausa cotidiana não é dado de nome, atividade ou endereço: %s", texto => {
  for (const campo of ["responsavelNome", "atividadePretendida", "municipioAtendimento", "enderecoPretendido"]) {
    const r = ler(texto, campo); expect(r.aguardar).toBe(true); expect(r.operacoes).toEqual([]);
  }
});
test("não saber onde funciona como desconhecimento somente do endereço", () => {
  expect(ler("Ainda não sei onde", "enderecoPretendido").desconhecido).toBe("enderecoPretendido");
  expect(ler("Ainda não sei onde", "responsavelNome").desconhecido).toBeNull();
});

test.each([
  ["Quero abri uma empresa", "ABERTURA"], ["Minha empresa está sem movimento", "INATIVA"],
  ["Não uso mais meu CNPJ", "INATIVA"], ["Parei de movimentar minha empresa", "INATIVA"],
  ["Meu MEI não tem movimentação", "INATIVA"], ["Minha empresa não está sem movimento", null],
])("variações de intenção preservam negações cadastrais: %s", (texto, origem) => expect(identificarOrigemComercial(texto)).toBe(origem));

test.each([
  ["Sou médica, posso usar meu endereço de casa?", "ABERTURA", "viabilidade"],
  ["Preciso de licença da prefeitura?", "ABERTURA", "atividade"],
  ["Posso trocar de contador e continuar a emitir notas?", "TRANSFERENCIA", "competências"],
  ["Posso dar baixa com dívida?", "INATIVA", "situação fiscal"],
  ["Empresa sem movimento precisa pagar imposto?", "INATIVA", "regime"],
  ["Empresa parada precisa entregar declarações?", "INATIVA", "período"],
])("primeira dúvida recebe orientação específica sem conclusão fiscal: %s", (texto, origem, trecho) => {
  const r = ler(texto, "responsavelNome", origem);
  expect(r.resposta).toContain(trecho); expect(dados(r).responsavelNome).toBeUndefined();
  expect(r.resposta).not.toMatch(/R\$|\d+%|isento|sem impostos|não precisa declarar/);
});
test("explicar emissão durante troca não dispara operação, mas pedido real continua operacional", () => {
  expect(pedidoOperacionalComercial("Posso trocar de contador e continuar a emitir notas?")).toBe(false);
  expect(pedidoOperacionalComercial("Posso trocar de contador e continuar a emitir notas? Me mande as guias.")).toBe(true);
  expect(pedidoOperacionalComercial("Quero trocar de contador e emitir nota agora")).toBe(true);
});
test("preço de baixa não oferece plano mensal para empresa encerrada", () => {
  const r = responderDuvidaComercial("Quanto custa?", { origem: "INATIVA", pretendeReativar: "BAIXAR" });
  expect(r).toContain("orçamento avulso"); expect(r).not.toContain("comparar com o acompanhamento");
  expect(responderDuvidaComercial("Quanto custa dar baixa?", { origem: "INATIVA" })).toContain("orçamento avulso");
  expect(responderDuvidaComercial("Não quero dar baixa. Qual o preço da contabilidade mensal?", { origem: "INATIVA" })).not.toContain("orçamento avulso");
});
