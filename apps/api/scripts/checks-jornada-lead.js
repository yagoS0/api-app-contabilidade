import assert from "node:assert/strict";
import { criarJornadaLead } from "../src/application/onboarding/JornadaLeadService.js";
import { iniciarAtendimento, registrarCampos } from "../src/application/onboarding/LeadService.js";

// Executado somente pelo verificador PostgreSQL descartável, com a rede já bloqueada.
export async function verificarJornada({ db, user, ok }) {
  let n = 0, chamadas = [], falhaTexto = null, durantePdf = null, janelaAberta = true;
  const cloud = {
    enviarDocumento: async args => { chamadas.push(["PDF", args]); await durantePdf?.(); return { wamid: `wamid.JORNADA.${++n}` }; },
    enviarTexto: async args => { chamadas.push(["TEXTO", args]); if (falhaTexto) throw falhaTexto; return { wamid: `wamid.JORNADA.${++n}` }; },
  };
  const j = criarJornadaLead({ db, cloud, janela: async () => ({ situacao: janelaAberta ? "ABERTA" : "FECHADA" }), comercial: { documento: async () => Buffer.from("%PDF-1.4\nSINTETICO\n%%EOF") } });
  const criar = async origem => {
    const c = await db.conversaWhatsapp.create({ data: { telefoneE164: `551190001${String(++n).padStart(4, "0")}`, chaveEscopo: `jornada:${n}` } });
    await db.mensagemWhatsapp.create({ data: { conversaId: c.id, providerMessageId: `wamid.JORNADA.IN.${n}`, direcao: "in", tipo: "text", corpo: "Contato sintético para testar o atendimento." } });
    const a = await iniciarAtendimento({ conversaId: c.id, origem, atorId: user.id, client: db });
    return { c, a, o: await db.onboarding.findUnique({ where: { id: a.onboardingId } }) };
  };
  const diagnostico = o => ({ versao: o.versao, achados: "Análise sintética conferida pelo contador.", servicos: "Serviços sintéticos para teste do atendimento." });
  const abertura = await criar("ABERTURA"), id = abertura.o.id;
  assert.equal((await j.carregar(id, user)).dadosPendentes.length, 4);
  await assert.rejects(j.diagnosticar(id, user, diagnostico(abertura.o)), e => e.code === "dados_incompletos");
  await assert.rejects(j.carregar(id, { id: user.id, role: "cliente" }), e => e.code === "forbidden");
  const o = await registrarCampos({ onboardingId: id, versao: 0, atorId: user.id, client: db, operacoes: [
    ["responsavelNome", "Pessoa sintética"], ["atividadePretendida", "Consultoria"], ["municipioAtendimento", "Rio de Janeiro"], ["enderecoPretendido", "Endereço sintético 100"],
  ].map(([campo, valor]) => ({ campo, acao: "set", valor })) });
  await assert.rejects(j.diagnosticar(id, user, diagnostico(abertura.o)), e => e.code === "formulario_alterado");
  const ds = await Promise.all([1, 2].map(() => j.diagnosticar(id, user, diagnostico(o))));
  assert.equal(ds[0].id, ds[1].id);
  ok("Jornada: coleta obrigatória, papel do contador, versão e diagnóstico idempotente concorrente");
  const antes = chamadas.length;
  janelaAberta = false;
  await assert.rejects(j.enviarDevolutiva(id, user, { diagnosticoId: ds[0].id }), e => e.code === "FORA_DA_JANELA");
  assert.equal(chamadas.length, antes); janelaAberta = true;
  await j.enviarDevolutiva(id, user, { diagnosticoId: ds[0].id });
  assert.equal((await j.carregar(id, user)).devolutiva.concluida, true);
  assert.equal((await j.enviarDevolutiva(id, user, { diagnosticoId: ds[0].id })).jaEnviada, true);
  assert.equal(chamadas.length, antes + 1); assert.equal(chamadas.at(-1)[0], "TEXTO");
  ok("Jornada: abertura envia somente texto, respeita janela e não duplica a devolutiva");
  await registrarCampos({ onboardingId: id, versao: o.versao, atorId: user.id, client: db, operacoes: [{ campo: "enderecoPretendido", acao: "set", valor: "Outro endereço sintético" }] });
  assert.equal((await j.carregar(id, user)).diagnosticoDesatualizado, true);
  await assert.rejects(j.enviarDevolutiva(id, user, { diagnosticoId: ds[0].id }), e => e.code === "atendimento_alterado");
  ok("Jornada: alteração material invalida diagnóstico e impede envio da versão anterior");
  for (const origem of ["TRANSFERENCIA", "INATIVA"]) {
    const caso = await criar(origem);
    const f = await registrarCampos({ onboardingId: caso.o.id, versao: 0, atorId: user.id, client: db, operacoes: [{ campo: "cnpj", acao: "set", valor: "11222333000181" }] });
    const salvarAnalise = tipo => db.onboardingAnalise.create({ data: { onboardingId: f.id, cnpj: f.cnpj, tipo, status: "CONCLUIDA", resultado: tipo === "SITFIS" ? { relatorioDisponivel: true } : { razaoSocial: "EMPRESA SINTÉTICA" }, criadoPorId: user.id } });
    const publica = await salvarAnalise("PUBLICA");
    assert.equal((await j.carregar(f.id, user)).publicaConferida, false);
    await assert.rejects(j.conferirAnalise(f.id, user, { versao: 0, analiseId: publica.id, tipo: "PUBLICA" }), e => e.code === "formulario_alterado");
    await j.conferirAnalise(f.id, user, { versao: f.versao, analiseId: publica.id, tipo: "PUBLICA" });
    assert.equal((await j.carregar(f.id, user)).publicaConferida, true);
    await assert.rejects(j.diagnosticar(f.id, user, diagnostico(f)), e => e.code === "analise_pendente");
    const fiscal = await salvarAnalise("SITFIS"), body = { ...diagnostico(f), analiseId: fiscal.id };
    await assert.rejects(j.diagnosticar(f.id, user, body), e => e.code === "analise_pendente");
    await j.conferirAnalise(f.id, user, { versao: f.versao, analiseId: fiscal.id, tipo: "SITFIS" });
    const d = await j.diagnosticar(f.id, user, body), envio = { diagnosticoId: d.id };
    const inicio = chamadas.length;
    if (origem === "TRANSFERENCIA") {
      falhaTexto = Object.assign(Error("Rejeição sintética"), { httpStatus: 400 });
      await assert.rejects(j.enviarDevolutiva(f.id, user, envio));
      let estado = await j.carregar(f.id, user);
      assert.deepEqual(estado.devolutiva.partes.map(p => p.status), ["enviado", "falhou"]);
      falhaTexto = null; await j.enviarDevolutiva(f.id, user, envio);
      assert.deepEqual(chamadas.slice(inicio).map(c => c[0]), ["PDF", "TEXTO", "TEXTO"]);
      assert.equal((await j.carregar(f.id, user)).devolutiva.concluida, true);
    } else {
      falhaTexto = Error("Timeout sintético");
      await assert.rejects(j.enviarDevolutiva(f.id, user, envio));
      falhaTexto = null;
      assert.equal((await j.carregar(f.id, user)).devolutiva.incerta, true);
      await assert.rejects(j.enviarDevolutiva(f.id, user, envio), e => e.code === "envio_incerto");
      assert.equal(chamadas.length, inicio + 2);
    }
    ok(`Jornada ${origem}: conferência real por análise; ${origem === "TRANSFERENCIA" ? "rejeição parcial retoma só o texto" : "timeout bloqueia repetição"}`);
    const novo = await salvarAnalise("SITFIS");
    assert.notEqual(novo.id, fiscal.id);
    assert.equal((await j.carregar(f.id, user)).diagnostico, null);
    assert.equal((await j.carregar(f.id, user)).fiscalConferido, false);
    await j.conferirAnalise(f.id, user, { versao: f.versao, analiseId: novo.id, tipo: "SITFIS" });
    const atual = await j.diagnosticar(f.id, user, { ...body, analiseId: novo.id });
    durantePdf = () => db.onboarding.update({ where: { id: f.id }, data: { status: "DESISTIU" } });
    const qt = chamadas.length;
    await assert.rejects(j.enviarDevolutiva(f.id, user, { diagnosticoId: atual.id }), e => e.code === "atendimento_alterado");
    assert.equal(chamadas.length, qt + 1); durantePdf = null;
    ok(`Jornada ${origem}: novo relatório exige revisão e encerramento durante PDF impede o texto`);
  }
  const p = await db.propostaComercial.create({ data: { onboardingId: id, versao: 1, fichaVersao: o.versao, snapshot: {}, expiraEm: new Date(Date.now() + 60000), status: "ACEITA" } });
  const contrato = await db.contratoComercial.create({ data: { onboardingId: id, propostaId: p.id, modeloId: "sintetico", texto: "SINTÉTICO", dados: {} } });
  const pagamento = { contratoId: contrato.id, evidencia: "Comprovante sintético conferido, nenhuma cobrança real." };
  await assert.rejects(j.confirmarPagamento(id, user, pagamento), e => e.code === "contrato_pendente");
  await db.contratoComercial.update({ where: { id: contrato.id }, data: { status: "ASSINADO_CONFERIDO" } });
  const pagos = await Promise.all([1, 2].map(() => j.confirmarPagamento(id, user, pagamento)));
  assert.equal(pagos[0].id, pagos[1].id);
  assert.equal(pagos[0].dados.contratoId, contrato.id);
  await db.propostaComercial.update({ where: { id: p.id }, data: { revogadaEm: new Date() } });
  await assert.rejects(j.confirmarPagamento(id, user, pagamento), e => e.code === "contrato_pendente");
  ok("Jornada: pagamento manual exige assinatura da proposta aceita, não duplica nem aceita contrato revogado");
}
