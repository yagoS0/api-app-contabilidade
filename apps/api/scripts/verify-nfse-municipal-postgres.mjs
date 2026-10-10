import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';

const [url, clientPath] = process.argv.slice(2);
const parsed = new URL(url);
if (parsed.hostname !== '127.0.0.1' || parsed.username !== 'nfse_municipal_test' || parsed.pathname !== '/nfse_municipal_check') {
  throw Error('Somente o banco local descartável nfse_municipal_check é permitido.');
}
// Este ensaio verifica banco real; certificado e serviço oficial são sintéticos.
const bloquear = () => { throw Error('HTTP externo proibido neste ensaio.'); };
http.request = http.get = https.request = https.get = globalThis.fetch = bloquear;
const { criarServicoParametros } = await import('../src/application/nfse/parametrosMunicipaisService.js');
const require = createRequire(import.meta.url);
const { PrismaClient } = require(path.join(clientPath, 'index.js'));
const db = new PrismaClient({ datasources: { db: { url } } });
const checks = [];
let chamadas = 0;
const resolvidos = [];
const deps = {
  db, habilitado: true, ambiente: 'homolog',
  resolverCertificados: async id => { resolvidos.push(id); return { transporte: { pfxBuffer: Buffer.from('sintetico') } }; },
  criarCliente: () => ({ origem: 'https://adn.producaorestrita.nfse.gov.br/parametrizacao', fechar() {},
    consultar: async () => { chamadas++; return { resposta: { sintetico: true, aliquota: '2.00' } }; } }),
};
try {
  assert.equal(await db.company.count(), 0, 'O banco precisa estar vazio.');
  const dono = await db.client.create({ data: { name: 'Teste', email: 'nfse@example.test', login: 'nfse', passwordHash: 'nao-utilizavel' } });
  async function empresa(cnpj) {
    const company = await db.company.create({ data: { clientId: dono.id, razaoSocial: 'Teste isolado', cnpj, atividades: [], codigoMunicipioIbge: '3304557', codigoServicoNacional: '171901' } });
    const portal = await db.portalClient.create({ data: { companyId: company.id, razao: 'Teste isolado', cnpj } });
    return { company, portal };
  }
  const a = await empresa('11111111000111');
  const b = await empresa('22222222000122');
  const servico = criarServicoParametros(deps);
  const pedido = { portalClientId: a.portal.id, autorId: 'contador-teste', recurso: 'convenio', requestKey: randomUUID() };
  const respostas = await Promise.all(Array.from({ length: 8 }, () => servico.consultar(pedido)));
  assert.equal(chamadas, 1);
  assert.equal(new Set(respostas.map(r => r.id)).size, 1);
  assert.equal(await db.nfseConsultaMunicipal.count(), 1);
  assert.ok(resolvidos.every(id => id === a.company.id));
  checks.push('oito pedidos concorrentes: uma reserva e uma consulta');

  const salvo = await db.nfseConsultaMunicipal.findFirst();
  assert.equal(salvo.status, 'RECEBIDO_PARA_CONFERENCIA');
  assert.deepEqual(salvo.resposta, { sintetico: true, aliquota: '2.00' });
  assert.ok(salvo.createdAt && salvo.concluidaEm);
  assert.equal(salvo.autorId, 'contador-teste');
  checks.push('retorno, autor, origem e datas persistidos pela migration');

  const reiniciado = criarServicoParametros(deps);
  assert.equal((await reiniciado.consultar(pedido)).id, salvo.id);
  assert.equal(chamadas, 1);
  await assert.rejects(() => reiniciado.consultar({ ...pedido, municipio: '3550308' }), { code: 'NFSE_PARAMETROS_CONFLITO' });
  checks.push('reinício recupera resultado; chave não aceita outro município');

  assert.equal((await servico.listar(b.portal.id)).consultas.length, 0);
  const producao = criarServicoParametros({ ...deps, ambiente: 'producao' });
  assert.equal((await producao.listar(a.portal.id)).consultas.length, 0);
  const outro = await servico.consultar({ ...pedido, portalClientId: b.portal.id });
  assert.notEqual(outro.id, salvo.id);
  checks.push('histórico e chave isolados por empresa e ambiente');

  const modelo = db.nfseConsultaMunicipal;
  const dbComFalha = { portalClient: db.portalClient, company: db.company, nfseConsultaMunicipal: {
    findUnique: args => modelo.findUnique(args), create: args => modelo.create(args),
    update: async () => { throw Error('falha-simulada-na-gravacao'); },
  } };
  const interrompido = { ...pedido, requestKey: randomUUID() };
  await assert.rejects(() => criarServicoParametros({ ...deps, db: dbComFalha }).consultar(interrompido), /falha-simulada/);
  const antes = chamadas;
  assert.equal((await reiniciado.consultar(interrompido)).status, 'CONSULTANDO');
  assert.equal(chamadas, antes);
  checks.push('retorno não gravado mantém reserva sem repetir após reinício');

  const comFalha = criarServicoParametros({ ...deps, criarCliente: () => ({ origem: deps.criarCliente().origem, fechar() {},
    consultar: async () => { chamadas++; throw Object.assign(Error('sintético'), { code: 'NFSE_PARAMETROS_CONSULTA_FALHOU', httpStatus: 503 }); } }) });
  const pedidoFalho = { ...pedido, requestKey: randomUUID() };
  assert.equal((await comFalha.consultar(pedidoFalho)).status, 'FALHOU');
  const aposFalha = chamadas;
  assert.equal((await reiniciado.consultar(pedidoFalho)).httpStatus, 503);
  assert.equal(chamadas, aposFalha);
  assert.deepEqual((await modelo.findUnique({ where: { id: salvo.id } })).resposta, salvo.resposta);
  checks.push('falha preservada, sem replay nem substituição do histórico anterior');

  await assert.rejects(() => modelo.create({ data: { ...salvo, id: randomUUID(), requestKey: randomUUID(), ambiente: 'invalido' } }));
  await assert.rejects(() => modelo.create({ data: { ...salvo, id: randomUUID(), requestKey: randomUUID(), status: 'APROVADO' } }));
  await assert.rejects(() => modelo.create({ data: { ...salvo, id: randomUUID(), requestKey: randomUUID(), companyId: randomUUID() } }));
  checks.push('constraints de ambiente, estado e vínculo da empresa aplicadas');
  const historico = await servico.consultar({ ...pedido, requestKey: randomUUID(), recurso: 'servico', codigoServico: '171901', codigoServicoMunicipal: '001' });
  const historicoSalvo = await modelo.findUnique({ where: { id: historico.id } });
  assert.equal(historicoSalvo.codigoServico, '171901001');
  assert.equal(historicoSalvo.caminho, '/3304557/17.19.01.001/historicoaliquotas');
  checks.push('código nacional e complemento preservados; caminho oficial formatado');
  console.log(JSON.stringify({ passed: true, checks, chamadasSinteticas: chamadas }, null, 2));
} finally { await db.$disconnect(); }
