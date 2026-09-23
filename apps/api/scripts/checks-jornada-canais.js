import { diagnosticoSintetico } from "../src/application/onboarding/__tests__/fixtures/diagnosticoSintetico.js";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { garantirIdentidadeWhatsapp } from "../src/application/whatsapp/IdentidadeComunicacaoService.js";
import { janelaDaConversa } from "../src/application/whatsapp/ConversaWhatsappService.js";
import { iniciarAtendimento, registrarCampos } from "../src/application/onboarding/LeadService.js";
import { criarJornadaLead } from "../src/application/onboarding/JornadaLeadService.js";
import { criarPropostasComerciais } from "../src/application/onboarding/PropostasComerciaisService.js";
import { criarRecursosComerciais } from "../src/application/onboarding/RecursosComerciaisService.js";
import { criarFichaEmpresaAvulsa } from "../src/application/onboarding/FichaEmpresaAvulsaService.js";
import { prepararArquivoConversao } from "../src/application/onboarding/ArquivoConversaoService.js";
import { enviarProposta } from "../src/application/onboarding/EnvioPropostaService.js";
import { CATALOGO_SINTETICO } from "../src/application/onboarding/__tests__/fixtures/catalogoSintetico.js";

// Chamado pelo verificador descartável: PostgreSQL e regras reais, HTTP bloqueado.
// Transporte, assinatura, pagamento e armazenamento são provas sintéticas locais.
export async function verificarJornadaCanais({ db, user, ok }) {
  const run = `jornada-canais-${randomUUID()}`;
  const recursos = criarRecursosComerciais({ db });
  const catalogo = await recursos.criar({ tipo: "CATALOGO", chave: "honorarios", titulo: "Catálogo fictício da jornada entre canais", dados: CATALOGO_SINTETICO }, user);
  await recursos.aprovar(catalogo.id, user);
  const modelo = await recursos.criar({ tipo: "CONTRATO", chave: run, titulo: "Contrato fictício da jornada", texto: "{{nome}} — {{servico}} — {{honorarios}}", dados: { recorrente: false, permitePreCnpj: true } }, user);
  await recursos.aprovar(modelo.id, user);
  const propostas = criarPropostasComerciais({ db, cifrar: async s => `TEST:${s}`, decifrar: async s => s.slice(5) });
  const arquivos = new Map();
  const storage = { upload: async ({ key, buffer }) => arquivos.set(key, Buffer.from(buffer)), downloadBuffer: async ({ key }) => Buffer.from(arquivos.get(key)) };
  const avulsas = criarFichaEmpresaAvulsa({ db, storage, preparar: args => prepararArquivoConversao({ ...args, decifrar: async s => s.slice(5) }) });
  let sequencia = 0;
  for (const manual of [false, true]) {
    const cenario = manual ? "ambos-fechados" : "comercial-aberto";
    const telefone = manual ? "5511932160002" : "5511932160001";
    const identidade = await garantirIdentidadeWhatsapp({ telefone, client: db });
    const criarCanal = async (rotulo, horas) => {
      const canalId = `${run}-${cenario}-${rotulo}`;
      await db.canalWhatsapp.create({ data: { id: canalId, chave: canalId, finalidade: rotulo === "principal" ? "PRINCIPAL" : "COMERCIAL", phoneNumberId: canalId, wabaId: run } });
      const c = await db.conversaWhatsapp.create({ data: { telefoneE164: telefone, canalId, vinculoNumeroId: identidade.vinculoNumero.id, chaveEscopo: canalId } });
      const instante = new Date(Date.now() - horas * 3600000);
      await db.mensagemWhatsapp.create({ data: { conversaId: c.id, providerMessageId: `${run}-entrada-${++sequencia}`, direcao: "in", tipo: "text", corpo: "Contato sintético", ocorridaEmProvedor: instante, registradaEm: instante } });
      return c;
    };
    const principal = await criarCanal("principal", 49), comercial = await criarCanal("comercial", manual ? 48 : 1);
    // Uma entrada antiga entregue agora não muda qual ocorrência abriu a janela.
    await db.mensagemWhatsapp.create({ data: { conversaId: comercial.id, providerMessageId: `${run}-atrasada-${++sequencia}`, direcao: "in", tipo: "text", corpo: "Entrega atrasada sintética", ocorridaEmProvedor: new Date(Date.now() - 72 * 3600000) } });
    assert.equal((await janelaDaConversa(principal.id)).situacao, "EXPIRADA");
    assert.equal((await janelaDaConversa(comercial.id)).situacao, manual ? "EXPIRADA" : "ABERTA");
    const a = await iniciarAtendimento({ conversaId: principal.id, origem: "ABERTURA", atorId: user.id, client: db });
    assert.equal((await iniciarAtendimento({ conversaId: comercial.id, origem: "ABERTURA", atorId: user.id, client: db })).id, a.id);
    const ficha = await registrarCampos({ onboardingId: a.onboardingId, versao: 0, atorId: user.id, client: db, operacoes: [
      ["responsavelNome", "Pessoa sintética"], ["atividadePretendida", "Consultoria"], ["municipioAtendimento", "Rio de Janeiro/RJ"],
      ["enderecoPretendido", "Rua Sintética 100"], ["modalidadeServico", "AVULSO"],
    ].map(([campo, valor]) => ({ campo, acao: "set", valor })) });
    const id = ficha.id, chamadas = [];
    const cloud = {
      enviarTexto: async payload => { chamadas.push({ tipo: "text", payload }); return { wamid: `${run}-saida-${++sequencia}` }; },
      enviarDocumento: async payload => { chamadas.push({ tipo: "document", payload }); return { wamid: `${run}-saida-${++sequencia}` }; },
    };
    const jornada = criarJornadaLead({ db, cloud }); // usa janelaDaConversa real
    const diagnostico = await jornada.diagnosticar(id, user, { versao: ficha.versao, ...diagnosticoSintetico("SIMULAÇÃO: atividade e endereço conferidos."), servicos: "Abertura avulsa sintética, sem contabilidade mensal." });
    const proposta = await propostas.gerar(id, user, { versao: ficha.versao, ajustes: { aberturaCentavos: 123457, justificativa: "Preço fictício conferido exclusivamente para teste." } });
    await assert.rejects(propostas.aprovar(id, proposta.id, user), e => e.code === "jornada_pendente");
    await assert.rejects(jornada.enviarDevolutiva(id, user, { diagnosticoId: diagnostico.id, conversaId: principal.id }), e => e.code === "canal_comercial_necessario");
    await assert.rejects(jornada.enviarDevolutiva(id, user, { diagnosticoId: diagnostico.id, conversaId: null }), e => e.code === "canal_comercial_necessario");
    assert.equal(chamadas.length, 0);
    if (manual) {
      await assert.rejects(jornada.enviarDevolutiva(id, user, { diagnosticoId: diagnostico.id }), e => e.code === "FORA_DA_JANELA");
      const body = { versao: ficha.versao, diagnosticoId: diagnostico.id, meio: "Reunião simulada", evidencia: "Escopo e entregas apresentados neste ensaio offline." };
      await assert.rejects(jornada.registrarApresentacao(id, user, { ...body, diagnosticoId: "diagnostico-inexistente" }), e => e.code === "diagnostico_alterado");
      const apresentacoes = await Promise.all([1, 2].map(() => jornada.registrarApresentacao(id, user, body)));
      assert.equal(apresentacoes[0].id, apresentacoes[1].id);
      assert.equal(apresentacoes[0].atorId, user.id);
      assert.equal(apresentacoes[0].dados.diagnosticoId, diagnostico.id);
      assert.equal(chamadas.length, 0);
      ok("Jornada em dois canais: ambas as janelas fechadas impedem envio; apresentação manual auditada e idempotente libera a etapa");
    } else {
      await jornada.enviarDevolutiva(id, user, { diagnosticoId: diagnostico.id });
      const saidas = await db.mensagemWhatsapp.findMany({ where: { conversaId: { in: [principal.id, comercial.id] }, direcao: "out" } });
      assert.equal(saidas.length, 1); assert.equal(saidas[0].conversaId, comercial.id);
      assert.equal(saidas[0].referenciaComercial.diagnosticoId, diagnostico.id);
      assert.equal((await jornada.enviarDevolutiva(id, user, { diagnosticoId: diagnostico.id, conversaId: comercial.id })).jaEnviada, true);
      assert.equal(chamadas.length, 1);
      assert.equal((await janelaDaConversa(principal.id)).situacao, "EXPIRADA");
      ok("Jornada em dois canais: omissão resolve comercial aberto pelo Prisma real; null/principal recusados; devolutiva sem duplicação");
    }
    assert.equal((await jornada.carregar(id, user)).devolutiva.concluida, true);
    await propostas.aprovar(id, proposta.id, user);
    const transporte = { db, cloud, webUrl: "https://example.invalid" };
    await assert.rejects(enviarProposta(id, proposta.id, user, { ...transporte, conversaId: null }), e => e.code === "canal_comercial_necessario");
    let token;
    if (manual) {
      await assert.rejects(enviarProposta(id, proposta.id, user, transporte), e => e.code === "FORA_DA_JANELA");
      assert.equal(chamadas.length, 0);
      ({ token } = await propostas.emitirLink(id, proposta.id, user)); // exercício local do endpoint público, sem distribuição
    } else {
      const envio = await enviarProposta(id, proposta.id, user, transporte);
      const mensagem = await db.mensagemWhatsapp.findUnique({ where: { id: envio.mensagemId } });
      assert.equal(mensagem.conversaId, comercial.id); assert.equal(mensagem.statusEnvio, "enviado");
      assert.equal(mensagem.referenciaComercial.propostaId, proposta.id);
      assert.equal(chamadas.at(-1).payload.conteudo.subarray(0, 5).toString(), "%PDF-");
      token = /token=([A-Za-z0-9_-]{43})/.exec(chamadas.at(-1).payload.legenda)[1];
    }
    await assert.rejects(propostas.publico(token, { versao: proposta.versao + 1, opcao: "AVULSO", confirmado: true }));
    const aceita = await propostas.publico(token, { versao: proposta.versao, opcao: "AVULSO", confirmado: true });
    assert.equal(aceita.proposta.status, "ACEITA");
    const contrato = await propostas.contrato(id, proposta.id, user, { modeloId: modelo.id });
    await propostas.aprovarContrato(id, contrato.id, user);
    const pagamento = { contratoId: contrato.id, evidencia: "Pagamento fictício conferido; não houve cobrança ou transferência." };
    await assert.rejects(jornada.confirmarPagamento(id, user, pagamento), e => e.code === "contrato_pendente");
    const original = Buffer.from("%PDF-1.4\nCONTRATO ASSINADO SINTETICO\n%%EOF");
    const doc = await propostas.salvarDocumento(id, user, { buffer: original, mimetype: "application/pdf", originalname: "contrato-assinado-sintetico.pdf" });
    assert.equal((await db.contratoComercial.findUnique({ where: { id: contrato.id } })).status, "AGUARDANDO_ASSINATURA");
    await propostas.conferirAssinatura(id, contrato.id, user, doc.id);
    await assert.rejects(propostas.concluirAvulso(id, user, "Entrega sintética conferida"), e => e.code === "pagamento_pendente");
    await jornada.confirmarPagamento(id, user, pagamento);
    await assert.rejects(propostas.concluirAvulso(id, user, "Entrega sintética conferida"), e => e.code === "ficha_avulsa_pendente");
    const antes = { usuarios: await db.user.count(), empresas: await db.portalClient.count() };
    const arquivada = await avulsas.salvar(id, user, { versao: ficha.versao, dados: { cnpj: "11222333000181", razaoSocial: "EMPRESA SINTÉTICA DA JORNADA", regimeTributario: "SIMPLES", cnaePrincipal: "7020400", endereco: { rua: "Rua Sintética", numero: "100", bairro: "Centro", cidade: "Rio de Janeiro", uf: "RJ", cep: "20000000" } } });
    assert.equal(arquivada.documentos.length, 3);
    assert.equal(arquivada.contabilidadeAtiva, false); assert.equal(arquivada.portalHabilitado, false);
    for (const documento of arquivada.documentos) {
      assert.equal(documento.fileKey, undefined);
      const arquivo = await avulsas.documento(id, documento.id, user);
      assert.equal(arquivo.buffer.subarray(0, 5).toString(), "%PDF-");
      assert.equal(arquivo.buffer.length, documento.bytes);
      if (documento.nome === "contrato-assinado-sintetico.pdf") assert.equal(createHash("sha256").update(arquivo.buffer).digest("hex"), doc.sha256);
    }
    await propostas.concluirAvulso(id, user, "SIMULAÇÃO: registro externo e entrega final conferidos pelo contador.");
    assert.equal((await db.onboarding.findUnique({ where: { id } })).status, "CONCLUIDO_AVULSO");
    assert.ok((await db.atendimentoLead.findUnique({ where: { id: a.id } })).encerradoEm);
    assert.equal((await avulsas.obter(id, user)).documentos.length, 3);
    assert.deepEqual({ usuarios: await db.user.count(), empresas: await db.portalClient.count() }, antes);
    assert.equal(chamadas.length, manual ? 0 : 2);
    ok(`Jornada ${cenario}: proposta/aceite exatos, contrato conferido, pagamento e ficha final com três PDFs íntegros; sem criar cliente ou portal`);
  }
}
