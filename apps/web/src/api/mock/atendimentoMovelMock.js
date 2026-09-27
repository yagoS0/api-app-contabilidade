import { MODOS_RASCUNHO_ATENDIMENTO } from "@contabilidade/shared";
function pdfDemonstracao() {
  const conteudo = "BT /F1 16 Tf 40 740 Td (Documento de demonstracao - sem validade fiscal) Tj ET";
  const objetos = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objetos.forEach((obj,i) => { offsets.push(pdf.length); pdf += `${i+1} 0 obj\n${obj}\nendobj\n`; });
  const xref = pdf.length; pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return btoa(pdf);
}
export function criarAtendimentoMovelMock({ conversas, usuario }) {
  const drafts = new Map(), intencoes = new Map(), arquivos = new Map();
  const copia = v => JSON.parse(JSON.stringify(v));
  const obter = id => { const c = conversas.find(c => c.id === id); if (!c) throw Object.assign(new Error("Conversa não encontrada."), { status: 404 }); return c; };
  const chave = (id, modo = "texto") => { if (!MODOS_RASCUNHO_ATENDIMENTO.includes(modo)) throw Object.assign(new Error("Modo de rascunho inválido."), { status: 400 }); return `${usuario()}:${id}:${modo}`; };
  const conflito = () => Object.assign(new Error("Este rascunho mudou em outro aparelho."), { status: 409, code: "RASCUNHO_CONFLITO" });
  return {
    async getRascunhoWhatsapp(id, modo = "texto") { obter(id); return { ok: true, rascunho: drafts.has(chave(id, modo)) ? copia(drafts.get(chave(id, modo))) : null }; },
    async salvarRascunhoWhatsapp(id, { versao, conteudo, modo = "texto" }) {
      obter(id); const atual = drafts.get(chave(id, modo)); if ((atual?.versao || 0) !== versao) throw conflito();
      const rascunho = { versao: versao + 1, conteudo: copia(conteudo), expiraEm: new Date(Date.now() + 7 * 86400000).toISOString() };
      drafts.set(chave(id, modo), rascunho); return { ok: true, rascunho: copia(rascunho) };
    },
    async excluirRascunhoWhatsapp(id, versao, modo = "texto") {
      obter(id); if ((drafts.get(chave(id, modo))?.versao || 0) !== versao) throw conflito();
      drafts.set(chave(id, modo), { versao: versao + 1, conteudo: { texto: "" }, expiraEm: null }); return { ok: true, excluido: true, versao: versao + 1 };
    },
    async getIntencaoWhatsapp(id, clientRequestId) { obter(id); return { ok: true, intencao: copia(intencoes.get(`${chave(id)}:${clientRequestId}`) || { status: "PROCESSANDO", clientRequestId }) }; },
    async responderConversaWhatsapp(id, texto, { clientRequestId } = {}) {
      const c = obter(id), key = `${chave(id)}:${clientRequestId}`;
      const anterior = clientRequestId && intencoes.get(key);
      if (anterior) { if (anterior.texto !== texto) throw Object.assign(new Error("Esta tentativa já pertence a outra mensagem."), { status: 409 }); return copia(anterior.resultado); }
      if (c.janela?.situacao !== "ABERTA") throw Object.assign(new Error("Aguarde uma mensagem do cliente ou envie um modelo de retomada aprovado."), { status: 409, code: "FORA_DA_JANELA" });
      if (c.excluidaEm) throw Object.assign(new Error("Conversa excluída. Restaure para responder."), { status: 409, code: "CHAT_EXCLUIDO" });
      if (c.escopoVerificado === false) throw Object.assign(new Error("Conversa disponível apenas para consulta."), { status: 409, code: "ESCOPO_NAO_VERIFICADO" });
      if (!String(texto || "").trim()) throw Object.assign(new Error("Escreva a mensagem."), { status: 400 });
      const mensagem = { id: `mock-msg-${crypto.randomUUID()}`, direcao: "out", autor: "HUMANO", tipo: "text", corpo: texto.trim(), providerMessageId: `wamid.mock.${crypto.randomUUID()}`, statusEnvio: "enviado", registradaEm: new Date().toISOString() };
      c.mensagens.push(mensagem); c.atendidaPor = "mock-user"; c.atendidaDesde = mensagem.registradaEm; c.atendente = { nome: "Equipe de demonstração" }; c.updatedAt = mensagem.registradaEm;
      const resultado = { ok: true, mensagem };
      if (clientRequestId) intencoes.set(key, { clientRequestId, texto, status: "ACEITA", resultado });
      return copia(resultado);
    },
    async enviarAnexoWhatsapp(id, arquivo, legenda = "", { clientRequestId } = {}) {
      const c = obter(id);
      if (c.excluidaEm) throw Object.assign(new Error("Restaure a conversa para enviar."), { status: 409, code: "CHAT_EXCLUIDO" });
      if (c.escopoVerificado === false) throw Object.assign(new Error("Confira a identidade antes de enviar."), { status: 409 });
      if (c.janela?.situacao !== "ABERTA") throw Object.assign(new Error("Fora da janela de atendimento. Aguarde a resposta do cliente."), { status: 409, code: "FORA_DA_JANELA" });
      if (!arquivo || !["application/pdf", "image/jpeg", "image/png"].includes(arquivo.type) || arquivo.size > 5 * 1024 * 1024 || !arquivo.size) throw Object.assign(new Error("Escolha PDF, JPEG ou PNG de até 5 MB."), { status: 400 });
      const base64 = await new Promise((resolve, reject) => { const leitor = new FileReader(); leitor.onload = () => resolve(String(leitor.result).split(",")[1]); leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo.")); leitor.readAsDataURL(arquivo); });
      const key = `${chave(id)}:${clientRequestId}`, assinatura = JSON.stringify([arquivo.name, arquivo.type, base64, legenda]);
      const anterior = clientRequestId && intencoes.get(key);
      if (anterior) { if (anterior.texto !== assinatura) throw Object.assign(new Error("Esta tentativa pertence a outro arquivo."), { status: 409 }); return copia(anterior.resultado); }
      const mensagem = { id: `mock-anexo-${crypto.randomUUID()}`, direcao: "out", autor: "HUMANO", tipo: arquivo.type === "application/pdf" ? "document" : "image", corpo: legenda || null, statusEnvio: "enviado", registradaEm: new Date().toISOString(), providerMessageId: `wamid.mock.${crypto.randomUUID()}`, arquivo: { nomeArquivo: arquivo.name, mimeType: arquivo.type, tamanho: arquivo.size, estado: "DISPONIVEL", podeAbrir: true, origem: "ORIGINAL_REGISTRADO" } };
      arquivos.set(mensagem.id, { ...mensagem.arquivo, base64 }); c.mensagens.push(mensagem); c.updatedAt = mensagem.registradaEm; c.atendidaPor = "mock-user"; c.atendidaDesde = mensagem.registradaEm;
      const resultado = { ok: true, mensagem };
      if (clientRequestId) intencoes.set(key, { clientRequestId, texto: assinatura, status: "ACEITA", resultado });
      return copia(resultado);
    },
    async buscarMensagensWhatsapp(id, { q, cursor, limite = 20 }) {
      const c = obter(id), termo = String(q || "").toLocaleLowerCase("pt-BR");
      const todos = [...c.mensagens].reverse().filter(m => JSON.stringify([m.corpo,m.cartaoGuia,m.arquivo]).toLocaleLowerCase("pt-BR").includes(termo));
      const inicio = cursor ? todos.findIndex(m => m.id === cursor) + 1 : 0, mensagens = todos.slice(inicio, inicio + limite).map(m => ({ ...m, conversaId: id }));
      return { ok: true, resultados: mensagens, proximoCursor: inicio + limite < todos.length ? mensagens.at(-1).id : null };
    },
    async getRetomadaWhatsapp(id) { obter(id); return { ok: true, disponivel: false, motivo: "MODELO_NAO_CONFIRMADO", message: "Demonstração: nenhum modelo aprovado na Meta foi confirmado para este canal.", configuracao: "/configuracoes", texto: null }; },
    async retomarConversaWhatsapp() { throw Object.assign(new Error("Não há modelo aprovado disponível na demonstração."), { status: 409 }); },
    async getArquivoMensagemWhatsapp(id, mensagemId) { const m = obter(id).mensagens.find(m => m.id === mensagemId); const arquivo = m?.cartaoGuia?.arquivo || m?.arquivo; if (!arquivo?.podeAbrir) throw Object.assign(new Error("Arquivo indisponível neste histórico."), { status: 404 }); return { ok: true, arquivo: arquivos.has(mensagemId) ? copia(arquivos.get(mensagemId)) : { nomeArquivo: arquivo.nomeArquivo, mimeType: arquivo.mimeType, base64: pdfDemonstracao(), origem: arquivo.origem } }; },
    async getAtendimentoPushConfig() { return { ok: true, enabled: false, publicKey: null }; },
    async registrarAtendimentoPush() { throw new Error("Notificações reais não são ativadas na demonstração."); },
    async revogarAtendimentoPush() { return { ok: true }; },
  };
}
