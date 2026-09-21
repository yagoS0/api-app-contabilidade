import { pediuMenuWhatsapp, pediuEquipeWhatsapp } from "../whatsapp/navegacaoWhatsapp.js";
import { pedidoDeConsulta } from "../whatsapp/consultaClienteWhatsapp.js";

const normalizar = texto => String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const limpo = texto => normalizar(texto).replace(/[.!?]+$/g, "").trim();

function afirmado(texto, padrao) {
  for (const match of texto.matchAll(new RegExp(padrao.source, "g"))) {
    const antes = texto.slice(0, match.index);
    if (/\b(?:nao|nem|sem)\s+(?:(?:quero|preciso|pretendo|vou|desejo|gostaria de)\s+)?(?:mais\s+)?$/.test(antes)) continue;
    if (/\bnao\b/.test(match[0])) continue;
    return true;
  }
  return false;
}

export function identificarOrigemComercial(texto, interacao = null) {
  const id = typeof interacao === "string" ? interacao : interacao?.id || interacao?.button_reply?.id || interacao?.list_reply?.id;
  const botoes = { "altan.comercial.abertura.v1": "ABERTURA", "altan.comercial.transferencia.v1": "TRANSFERENCIA", "altan.comercial.inativa.v1": "INATIVA" };
  if (botoes[id]) return botoes[id];
  const t = normalizar(texto), tipos = [];
  if (afirmado(t, /\b(?:abrir|abrem|constituir|registrar|formalizar)\b.{0,45}\b(?:empresa|cnpj|consultorio|mei|negocio)\b|\babertura\b|\b(?:preciso|quero|necessito)\s+(?:de\s+)?(?:um\s+)?(?:novo\s+)?cnpj\b|\b(?:tirar|criar|fazer)\s+(?:um\s+)?(?:novo\s+)?cnpj\b/)) tipos.push("ABERTURA");
  if (afirmado(t, /\b(?:trocar|mudar|transferir)\b.{0,30}\b(?:contador|contadora|contabilidade)\b|\btransferir\b.{0,30}\bempresa\b|\btransferencia\b/)) tipos.push("TRANSFERENCIA");
  if (afirmado(t, /\b(?:empresa|cnpj|mei)\b.{0,35}\b(?:parad[ao]|inativ[ao]|inapt[ao]|irregular|suspens[ao]|baixad[ao]|regularizar)\b|\b(?:regularizar|reativar)\b.{0,30}\b(?:empresa|cnpj|mei)\b|\b(?:dar baixa|encerrar|fechar)\b.{0,20}\b(?:empresa|cnpj|mei)\b/)) tipos.push("INATIVA");
  return tipos.length === 1 ? tipos[0] : tipos.length > 1 ? "MULTIPLOS" : null;
}

export function pedidoOperacionalComercial(texto) {
  const t = normalizar(texto);
  if (/\b(?:guia|guias|boleto|boletos|cancelar nota|documentos da empresa|mand[ae] o documento|envie o documento|trocar empresa|trocar de empresa|mudar de empresa)\b/.test(t)) return true;
  // A declaração de volume para a proposta não é uma consulta à empresa atual.
  const declaracaoFaturamento = !/\?|\b(?:qual|quanto|consultar|ver|informe|me diga)\b/.test(t)
    && /\b(?:faturamento|receita bruta)\b(?: mensal| anual| por mes| por ano)?\s*(?:e|foi|sera|estimado de|previsto de|:|=)\s*(?:r\$\s*)?\d/.test(t);
  const faturamentoDesconhecido = /\b(?:nao sei|nao lembro|nao tenho ideia)\b.{0,30}\bfaturamento\b/.test(t);
  if (!declaracaoFaturamento && !faturamentoDesconhecido && pedidoDeConsulta(t)?.acao === "FATURAMENTO") return true;
  // A exceção do objetivo futuro não pode ocultar outro pedido operacional.
  const emissaoFutura = identificarOrigemComercial(t) === "ABERTURA" && /\b(?:para|pra|pois|porque)\b.{0,30}\b(?:emitir|emissao|nota|notas)\b/.test(t);
  return !emissaoFutura && /\b(?:emitir|emissao)\b/.test(t);
}

export function responderDuvidaComercial(texto, { origem = null } = {}) {
  const t = normalizar(texto);
  if (/\b(?:voce|voces|isso)\s+(?:e|sao)\s+(?:uma?\s+)?(?:ia|robo|bot|inteligencia artificial|atendimento automatico)\b|\b(?:quem (?:esta|ta) falando|com quem (?:estou|to) falando)\b/.test(t)) return "Sou o atendimento automático da Altan. Posso coletar os dados iniciais e explicar as etapas. Se preferir, é só pedir para falar com a equipe.";
  if (/\b(?:procuracao|autorizar acesso|autorizacao de acesso|senha do gov|senha gov)\b/.test(t)) return "Para a análise fiscal, a equipe orienta como autorizar o acesso à Receita por procuração. Não precisamos da sua senha gov.br. Se você já autorizou, a equipe confere antes de pedir novamente.";
  if (/\b(?:qual|o que|como|quais|preciso|precisa|posso)\b.{0,35}\b(?:documentos?|documentacao)\b|\blista de documentos\b/.test(t)) return origem === "ABERTURA"
    ? "Começamos com sua atividade, cidade e tipo de serviço desejado. Depois, a equipe orienta quais documentos dos sócios e do endereço serão necessários para a abertura."
    : origem ? "Para começar a análise de uma empresa existente, precisamos do CNPJ. Depois da consulta pública, a equipe indica os documentos e autorizações necessários para seu caso."
      : "Na abertura, começamos pela atividade e cidade; depois orientamos os documentos dos sócios e do endereço. Se a empresa já existe, começamos pelo CNPJ para indicar os documentos necessários.";
  if (/\b(?:quanto tempo|qual (?:e )?o prazo|prazo|demora|fica pront[oa])\b/.test(t) && (/\?|\b(?:quanto|qual|em quantos|que prazo|demora para|demora a abrir)\b/.test(t))) return "O prazo depende do serviço, dos documentos e, na abertura, da análise do endereço e dos órgãos responsáveis. A equipe confirma uma previsão depois dessa conferência.";
  if (/\b(?:(?:quanto|qto|qt) (?:custa|e|fica|cobram|ta|sai)|precos?|honorarios?|orcamento|valor(?:es)?|mensalidade)\b/.test(t) && !/\b(?:sem mensalidade|nao quero mensalidade)\b/.test(t)) return "O valor depende da atividade e do que sua empresa precisa. A proposta separa serviços pontuais, contabilidade mensal e eventuais taxas. Você pode escolher só o serviço ou comparar com o acompanhamento mensal.";
  if (/\b(?:como funciona|como (?:e|sera) (?:feito|o processo)|qual (?:e )?o (?:passo|processo)|por onde comec|quais (?:sao )?as etapas)\b/.test(t)) return origem === "ABERTURA"
    ? "Primeiro entendemos sua atividade e o endereço pretendido. A equipe confere a viabilidade e prepara a proposta; depois do aceite, orienta os documentos e o registro da empresa."
    : origem ? "Primeiro entendemos seu objetivo e consultamos os dados públicos do CNPJ. Se precisar de análise fiscal, a equipe orienta a autorização, confere as pendências e prepara a proposta antes de executar os serviços."
      : "Primeiro entendemos se você quer abrir uma empresa ou cuidar de uma que já existe. Conferimos os dados necessários e preparamos a proposta antes de executar os serviços.";
  if (/\b(?:cnpj)\b/.test(t) && /\b(?:por que|porque (?:precisam|precisa)|para que|consultar|consulta publica|verificar|conferir)\b/.test(t)) return "O CNPJ permite consultar razão social, atividade, endereço e situação cadastral públicos. Para conferir declarações e débitos fiscais, pode ser necessária uma autorização específica.";
  if (/\b(?:diferenca|inclui|incluso|o que vem|o que esta incluido)\b/.test(t)) return "O serviço pontual atende uma necessidade definida, como a abertura ou uma regularização. A contabilidade mensal acompanha as rotinas da empresa. A proposta descreve as entregas e o valor de cada opção.";
  if (/\b(?:posso|pode|consigo)\b.{0,20}\b(?:mandar|enviar)\b.{0,15}\baudio\b/.test(t)) return "Para preencher os dados por aqui, envie uma mensagem de texto. Se preferir explicar por áudio, a equipe pode continuar seu atendimento.";
  if (/\b(?:voces|altan)\b.{0,20}\b(?:abrem|fazem abertura|podem abrir)\b|\b(?:consigo|posso)\s+abrir\b/.test(t)) return "Podemos ajudar com a abertura. A equipe confere a atividade e a viabilidade do endereço; você pode contratar só a abertura ou também a contabilidade mensal.";
  return null;
}

function cnpjValido(cnpj) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;
  const digito = base => { let soma = 0, peso = base.length - 7; for (const d of base) { soma += Number(d) * peso--; if (peso < 2) peso = 9; } const resto = soma % 11; return resto < 2 ? 0 : 11 - resto; };
  return digito(cnpj.slice(0, 12)) === Number(cnpj[12]) && digito(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

const NUMEROS = { zero: 0, nenhum: 0, nenhuma: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, vinte: 20, trinta: 30 };
const MESES = { janeiro: "01", fevereiro: "02", marco: "03", abril: "04", maio: "05", junho: "06", julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12" };
const PROFISSAO = "m[ée]dic[oa]|dentista|advogad[oa]|engenheir[oa]|psic[óo]log[oa]|arquiteto|arquiteta|veterin[áa]ri[oa]|fisioterapeuta|nutricionista|programador[a]?|desenvolvedor[a]?|designer|consultor[a]?|comerciante|professor[a]?|eletricista|pedreiro|esteticista|cabeleireir[oa]";
const CAMPOS_DESCONHECIDOS = {
  cnpj: /\bcnpj\b/, responsavelNome: /\bnome\b/, atividadePretendida: /\b(?:atividade|profissao|trabalhar)\b/,
  municipioAtendimento: /\b(?:cidade|municipio|estado|local)\b/, enderecoPretendido: /\b(?:endereco|local|imovel)\b/,
  modalidadeServico: /\b(?:opcao|modalidade|mensal|avulso|contabilidade|contratar)\b/,
  qtdFuncionarios: /\b(?:funcionarios?|empregados?|contratar)\b/, notasRecebidasMes: /\b(?:notas?|compras)\b/,
  paradaDesde: /\b(?:quando|mes|ano|parou|parada|sem movimento)\b/, pretendeReativar: /\b(?:reativar|fechar|encerrar|fazer)\b/,
  motivoTroca: /\b(?:motivo|troca|contador)\b/,
};

function naoSabeCampo(t, campo) {
  if (!campo || !/\b(?:nao sei|nao tenho certeza|nao tenho ideia|a definir|nao lembro|nao me lembro)\b/.test(t)) return false;
  if (/^(?:ainda |eu )?(?:nao sei|nao tenho certeza|nao tenho ideia|a definir|nao lembro|nao me lembro)(?: agora| ainda| dizer| informar)?$/.test(t)) return true;
  const trecho = t.slice(t.search(/\b(?:nao sei|nao tenho certeza|nao tenho ideia|a definir|nao lembro|nao me lembro)\b/));
  return Boolean(CAMPOS_DESCONHECIDOS[campo]?.test(trecho));
}

function nomeValido(nome) {
  const t = normalizar(nome);
  return /^[\p{L}][\p{L}'’ -]{1,119}$/u.test(nome) && nome.trim().split(/\s+/).length <= 7
    && !/^(?:de|do|da|dos|das)\b/.test(t)
    && !new RegExp(`^(?:${PROFISSAO})$`, "i").test(nome)
    && !/\b(?:quero|preciso|gostaria|pode|posso|voces|voce|nome|voltei|continuar|continuando|ja|depois|amanha|hoje|bem|orcamento|empresa|cnpj|documento|faturamento|falar|aguarde|estou|tenho|nao|sim|sou|moro|trabalho|obrigad[oa]|entendi)\b/.test(t);
}

function parteDoCampo(valor) {
  return String(valor || "").split(/[;\n,.!?]|\s+e\s+(?=(?:meu|minha|sou|moro|atendo|trabalho|quero|preciso|tenho|gostaria|pretendo|vou|o email|o e-mail)\b)/i)[0].trim();
}

function declarouMotivoTroca(texto) {
  const t = normalizar(texto);
  // A pergunta pendente dá sentido a "preço" e a declarações como "não me
  // respondem". Pedidos de informação e referências aos nossos valores seguem
  // como dúvida, inclusive quando a pessoa não usa ponto de interrogação.
  if (texto.length > 1000 || /\?|\b(?:qual|quais|como|quanto|qto|qt|posso|pode|podem|poderia|consegue|conseguem|saber|informe|informar|por que)\b/.test(t)
    || /\b(?:me |nos )?(?:passa|passe|manda|mande|envia|envie|diga|diz|mostra|mostre)\b/.test(t)
    || /\b(?:voces|vcs|seus?|suas?|altan|orcamento|tabela)\b/.test(t)) return false;
  return /\b(?:precos?|valor(?:es)?|honorarios?|mensalidade|car[oa]s?|carissim[oa]s?|atendimento|demora|retorno|respondem?|respostas?|cobranca|atrasos?|erros?|suporte|pagar menos)\b/.test(t);
}

export function interpretarColetaComercial({ texto, origem, campoEsperado = null, anoParadaPendente = null }) {
  const raw = String(texto || "").trim(), t = limpo(raw), campos = new Map();
  const set = (campo, valor) => campos.set(campo, { campo, acao: "set", valor });
  const retomada = /^(?:voltei|estou de volta|vamos continuar|pode continuar|continuar|continuando|podemos continuar|quero continuar|retomar|quero retomar|ja (?:falei|conversei) com voces(?: antes)?|ja (?:enviei|mandei|informei)(?: (?:isso|meu nome|meus dados|os dados))?)$/.test(t);
  const aguardar = /^(?:ok|okay|entendi|certo|beleza|ta bom|tudo bem|tudo bom|obrigad[oa]|valeu|por nada|aguarde|um momento|so um momento|so um minuto|depois|falo depois|respondo depois|vou (?:ver|conferir|procurar)(?: e (?:te |lhe )?(?:mando|envio))?)$/.test(t);
  const reinicio = /^(?:(?:quero|vamos|pode) )?(?:recomecar|reiniciar|comecar (?:de novo|do zero)|zerar (?:o )?atendimento|cancelar (?:o )?atendimento)$/.test(t);
  const humano = pediuEquipeWhatsapp(raw) || /\b(?:falar com (?:alguem|uma pessoa|o contador|a equipe|atendente)|atendimento humano|quero um contador|reclamacao)\b/.test(t);
  const navegacao = pediuMenuWhatsapp(raw);
  if (retomada || aguardar || reinicio || navegacao || humano) return { operacoes: [], desconhecido: null, humano, resposta: null, retomada, aguardar, reinicio };
  const desconhece = naoSabeCampo(t, campoEsperado);
  // Quando perguntamos o motivo da troca, "Preço" é a resposta, não um orçamento.
  // Perguntas explícitas sobre nossos valores continuam na FAQ.
  const motivoInformado = origem === "TRANSFERENCIA" && campoEsperado === "motivoTroca" && !desconhece && declarouMotivoTroca(raw);
  let resposta = responderDuvidaComercial(raw, { origem });
  if (motivoInformado) { set("motivoTroca", raw); resposta = null; }
  let respostaSubstituiPergunta = false;
  let anoParadaAtualizado;
  const pergunta = Boolean(resposta) || raw.includes("?") || /\b(?:qual|quais|como|quanto|posso|pode me|voces fazem)\b/.test(t);

  const nomeExplicito = raw.match(/\b(?:me chamo|meu nome [ée]|nome\s*:)\s*([^;\n]+)/i)?.[1]
    || raw.match(/^(?:ol[áa][,!]?\s*)?sou (?:a |o )?([^;\n]+)/i)?.[1];
  const nome = parteDoCampo(nomeExplicito);
  if (nomeValido(nome) && !new RegExp(`^(?:${PROFISSAO})$`, "i").test(nome)) set("responsavelNome", nome);
  const email = raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  if (email) set("responsavelEmail", email.toLowerCase());

  const modalidadeEsperada = campoEsperado === "modalidadeServico";
  if (/\b(?:nao quero|nao preciso|sem)\b.{0,20}\b(?:contabilidade|mensalidade|mensal)\b/.test(t)
    || afirmado(t, /\b(?:so|somente|apenas)\b.{0,20}\b(?:abrir|abertura|avulso|servico|regularizar|regularizacao)\b/)
    || modalidadeEsperada && /^(?:avulso|avulsa|pontual|servico pontual|servico avulso|a abertura|abertura)$/.test(t)) set("modalidadeServico", "AVULSO");
  else if (afirmado(t, /\b(?:comparar|duas opcoes|as duas|ambas|os dois)\b/)) set("modalidadeServico", "COMPARAR");
  else if (!/\b(?:nao|sem)\b.{0,25}\b(?:mensal|contabilidade)\b/.test(t)
    && (/\b(?:com|tambem|quero|preciso|e)\b.{0,25}\bcontabilidade\b/.test(t) && !/\b(?:trocar|mudar)\b/.test(t)
      || /\bcontabilidade mensal\b/.test(t) || modalidadeEsperada && /(?:^|\bquero |\bprefiro )(?:mensal|recorrente|completa|acompanhamento mensal|contabilidade)$/.test(t))) set("modalidadeServico", "RECORRENTE");

  const cnpj = raw.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/)?.[0]?.replace(/\D/g, "");
  if (cnpj && origem !== "ABERTURA") {
    if (cnpjValido(cnpj)) set("cnpj", cnpj);
    else { resposta = "Esse CNPJ parece ter algum dígito incorreto. Pode conferir e enviar novamente?"; respostaSubstituiPergunta = true; }
  }
  const rotulos = { atividade: "atividadePretendida", cidade: "municipioAtendimento", municipio: "municipioAtendimento", endereço: "enderecoPretendido", endereco: "enderecoPretendido" };
  for (const [rotulo, campo] of Object.entries(rotulos)) {
    const v = raw.match(new RegExp(`(?:^|[;\\n])\\s*${rotulo}\\s*:\\s*([^;\\n]+)`, "i"))?.[1];
    if (v && (origem === "ABERTURA" || campo === "municipioAtendimento")) set(campo, v.trim());
  }
  if (origem === "ABERTURA") {
    const atividade = raw.match(new RegExp(`\\b(?:sou|atuo como|trabalho como)\\s+(?:a |o )?(${PROFISSAO})\\b`, "i"))?.[1]
      || (campos.has("responsavelNome") ? raw.match(new RegExp(`,\\s*(${PROFISSAO})\\b`, "i"))?.[1] : null);
    if (atividade) set("atividadePretendida", atividade);
    const cidade = raw.match(/\b(?:moro em|atendo em|vou atender em|sou de|(?:a empresa|o consult[óo]rio) (?:ser[áa]|fica) em)\s+([^;\n.!?]+)/i)?.[1];
    if (cidade) set("municipioAtendimento", cidade.split(/\s+e\s+(?=(?:meu|minha|sou|moro|atendo|trabalho|quero|preciso|tenho)\b)/i)[0].trim());
  }
  if (origem === "TRANSFERENCIA") {
    const motivo = raw.match(/\b(?:porque|pois|motivo\s*:)\s+([^\n;]+)/i)?.[1];
    if (motivo && /\b(?:trocar|mudar|transferencia|contador|contabilidade)\b/.test(t)) set("motivoTroca", motivo.trim());
  }
  if (/\b(?:nao (?:tenho|tera|tem)|sem|nenhum)\b.{0,15}\bfuncionarios?\b/.test(t)) set("qtdFuncionarios", 0);
  const quantidade = t.match(/\b(\d{1,4}|zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|vinte|trinta)\s+funcionarios?\b/)?.[1];
  if (quantidade && !campos.has("qtdFuncionarios")) set("qtdFuncionarios", /^\d+$/.test(quantidade) ? Number(quantidade) : NUMEROS[quantidade]);
  const notas = t.match(/\b(\d{1,5})\s+notas?\b/)?.[1];
  if (notas && /receb|compra|despesa/.test(t)) set("notasRecebidasMes", Number(notas));
  if (campoEsperado === "qtdFuncionarios" && /^(?:nao|nenhum|nenhuma|zero|nao tenho|so eu|apenas eu|somente eu|somos so os socios|so os socios)$/.test(t)) set("qtdFuncionarios", 0);
  if (campoEsperado === "qtdFuncionarios" && /^(?:sim|tenho|sim tenho)$/.test(t)) { resposta = "Quantos funcionários, sem contar os sócios?"; respostaSubstituiPergunta = true; }
  if (["qtdFuncionarios", "notasRecebidasMes"].includes(campoEsperado) && !desconhece) {
    if (/^\d{1,5}$/.test(t)) set(campoEsperado, Number(t));
    else if (NUMEROS[t] !== undefined) set(campoEsperado, NUMEROS[t]);
  }
  if (origem === "INATIVA") {
    if (afirmado(t, /\b(?:reativar|voltar a (?:usar|operar|funcionar))\b/) || campoEsperado === "pretendeReativar" && /^(?:quero )?voltar$/.test(t)) set("pretendeReativar", "REATIVAR");
    else if (afirmado(t, /\b(?:dar baixa|encerrar a empresa|fechar a empresa)\b/) || campoEsperado === "pretendeReativar" && /^(?:quero )?(?:fechar|encerrar|baixar)$/.test(t)) set("pretendeReativar", "BAIXAR");
    else if (/\bindecis[oa]\b/.test(t) || desconhece && campoEsperado === "pretendeReativar") set("pretendeReativar", "INDECISO");
    if (campoEsperado === "paradaDesde") {
      const numerico = t.match(/^(?:desde |em |parada desde )?(\d{1,2})[/-](\d{4})$/);
      const extenso = t.match(/^(?:desde |em |parada desde )?([a-z]+)(?: de)? (\d{4})$/);
      if (numerico && Number(numerico[1]) >= 1 && Number(numerico[1]) <= 12) set("paradaDesde", `${numerico[2]}-${numerico[1].padStart(2, "0")}`);
      else if (extenso && MESES[extenso[1]]) set("paradaDesde", `${extenso[2]}-${MESES[extenso[1]]}`);
      else {
        const ano = t.match(/^(?:desde |em |parada desde )?(\d{4})$/)?.[1];
        const mesIsolado = t.match(/^(?:em |mes de |no mes de )?([a-z]+|\d{1,2})$/)?.[1];
        const mes = MESES[mesIsolado] || (/^\d{1,2}$/.test(mesIsolado || "") && Number(mesIsolado) >= 1 && Number(mesIsolado) <= 12 ? mesIsolado.padStart(2, "0") : null);
        if (ano) {
          anoParadaAtualizado = ano;
          resposta = `Em que mês de ${ano} a empresa parou? Se não souber, pode dizer “não sei”.`;
          respostaSubstituiPergunta = true;
        } else if (mes && /^\d{4}$/.test(String(anoParadaPendente || ""))) set("paradaDesde", `${anoParadaPendente}-${mes}`);
        else if (mes) { resposta = "Pode informar o mês e o ano em que a empresa parou? Por exemplo: janeiro de 2023."; respostaSubstituiPergunta = true; }
      }
      if (campos.has("paradaDesde") || desconhece) anoParadaAtualizado = null;
    }
  }
  let desconhecido = desconhece && !campos.has(campoEsperado) ? campoEsperado : null;
  if (campoEsperado === "cnpj" && /^(?:ainda )?nao (?:tenho|encontrei|achei)(?: (?:o |um |meu )?cnpj)?(?: (?:aqui|agora|comigo))?$/.test(t)) desconhecido = campoEsperado;
  if (campoEsperado === "enderecoPretendido" && /^(?:ainda )?nao (?:tenho|defini|escolhi)(?: (?:o |um )?endereco)?(?: ainda)?$/.test(t)) desconhecido = campoEsperado;
  if (campoEsperado && !campos.has(campoEsperado) && !desconhecido && !pergunta && !identificarOrigemComercial(raw)) {
    if (campoEsperado === "responsavelNome") {
      const candidato = parteDoCampo(raw.replace(/^(?:sou )?(?:a |o )/i, ""));
      if (nomeValido(candidato)) set(campoEsperado, candidato);
    } else if (["atividadePretendida", "municipioAtendimento", "enderecoPretendido", "motivoTroca"].includes(campoEsperado) && !campos.size
      && raw.length >= 2 && raw.length <= 1000 && !/^(?:sim|nao|quero|preciso|pode|ja mandei|ja informei|vamos|ainda nao|nao sei)\b/.test(t)) set(campoEsperado, raw);
  }
  return { operacoes: [...campos.values()], desconhecido, humano, resposta, retomada, aguardar, reinicio, respostaSubstituiPergunta,
    ...(anoParadaAtualizado !== undefined ? { anoParadaPendente: anoParadaAtualizado } : {}) };
}
