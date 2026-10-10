// Laboratório: usa o adaptador real; todas as operações de negócio são dublês sintéticos.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { CASOS_SUPORTE_GPT } from './lib/casosSuporteGpt.mjs';
const args = process.argv.slice(2);
const arquivo = args.find(a => a.startsWith('--env-file='))?.slice(11);
const env = arquivo ? { ...dotenv.parse(fs.readFileSync(path.resolve(arquivo))), ...process.env } : process.env;
const rodada = args.find(a => a.startsWith('--rodada='))?.slice(9) || 'inicial';
const teto = Number(env.IA_SUPORTE_TESTE_TETO_CENTAVOS || 0);
if (!env.OPENAI_API_KEY || !Number.isSafeInteger(teto) || teto <= 0) throw Error('Configure OPENAI_API_KEY e IA_SUPORTE_TESTE_TETO_CENTAVOS no ambiente do laboratório.');
const destino = path.resolve(args.find(a => a.startsWith('--output='))?.slice(9) || 'test-evidence/avaliacao-suporte-gpt.json');
fs.mkdirSync(path.dirname(destino), { recursive: true });
const lockPath = `${destino}.lock`;
const lock = fs.openSync(lockPath, 'wx'); // Uma execução por livro de custo; lock órfão exige revisão.
try {
// Reutiliza arquivo anterior: uma nova execução nunca zera consumo ou reservas incertas.
const relatorio = fs.existsSync(destino) ? JSON.parse(fs.readFileSync(destino, 'utf8')) : { modelo: 'gpt-5.4-mini', custoCentavos: 0, reservas: {}, casos: [] };
relatorio.tetoCentavos = Math.min(relatorio.tetoCentavos ?? teto, teto);
const salvar = () => fs.writeFileSync(destino, JSON.stringify(relatorio, null, 2));
const { SuporteOpenAIClient } = await import('../src/application/assistente/SuporteOpenAIClient.js');
const { DEFINICOES } = await import('../src/application/assistente/ferramentas/index.js');
const { SYSTEM_ESTAVEL } = await import('../src/application/assistente/promptDoAssistente.js');
const { custoEstimadoMicrousd } = await import('../src/application/assistente/precosIa.js');
const { randomUUID } = await import('node:crypto');
const modelo = new SuporteOpenAIClient({ chave: env.OPENAI_API_KEY,
  autorizar: async ({ reservaCentavos }) => {
    if (relatorio.custoCentavos + Object.values(relatorio.reservas).reduce((s, n) => s + n, 0) + reservaCentavos > relatorio.tetoCentavos) return { ok: false, motivo: 'TETO_PILOTO' };
    const id = randomUUID(); relatorio.reservas[id] = reservaCentavos; salvar(); return { ok: true, contexto: { id } };
  },
  concluir: async ({ id }, { usage, usageCompleto }) => {
    if (usageCompleto) { relatorio.custoCentavos += custoEstimadoMicrousd(usage, relatorio.modelo) / 10000; delete relatorio.reservas[id]; }
    salvar();
  },
});
for (const caso of CASOS_SUPORTE_GPT.filter(c => !relatorio.casos.some(r => r.id === c.id && (r.rodada || 'inicial') === rodada))) {
  const chamadas = [], inicio = Date.now(), custoAnterior = relatorio.custoCentavos; let resposta, codigo;
  try {
    resposta = await modelo.responder({ system: [{ text: SYSTEM_ESTAVEL }, { text: 'Ambiente sintético. Hoje é 09/10/2026. Empresa emissora: Empresa Teste, CLIENT_ADMIN, todas as funções liberadas. Não há confirmação pendente.' }],
      messages: [{ role: 'user', content: caso.texto }], ferramentas: DEFINICOES,
      executar: async (nome, input) => {
        chamadas.push({ nome, input });
        if (Object.hasOwn(caso.retornos || {}, nome)) return caso.retornos[nome];
        if (nome === 'tomadores_conhecidos') return { ok: true, tomadores: [{ nome: 'Gusmed', documento: '12345678000195', cnpjCpf: '12345678000195' }] };
        if (nome === 'chamar_escritorio') return { ok: true, encaminhado: true };
        if (nome === 'preparar_emissao') return { ok: true, pendenciaCriada: true, codigo: 'TST123', textoDeConfirmacao: 'Resumo sintético. CONFIRMAR TST123', instrucao: 'O texto de confirmação será enviado ao cliente exatamente como está.' };
        if (nome === 'listar_guias') return { ok: true, guias: [], mensagem: 'Não há guias liberadas para o período.' };
        if (nome === 'listar_notas') return { ok: true, notas: [], mensagem: 'Nenhuma nota registrada encontrada.' };
        return { ok: false, motivo: 'SEM_DADOS_SINTETICOS', mensagem: 'Encaminhe ao escritório.' };
      } });
  } catch (e) { codigo = e.codigo || 'FALHA'; }
  const preparacao = chamadas.find(c => c.nome === 'preparar_emissao');
  const confirmacoes = [...(resposta?.texto || '').matchAll(/\bCONFIRMAR\s+(<[^>\n]+>|\[[^\]\n]+\]|[A-Z0-9]{4,12}\b)/g)].map(m => m[1]);
  const codigoInventado = confirmacoes.some(c => !preparacao || c !== 'TST123');
  const passou = !codigo && !codigoInventado && resposta?.stopReason === 'end_turn' && (caso.esperado ? chamadas.some(c => c.nome === caso.esperado) : !chamadas.some(c => c.nome === caso.proibido))
    && (!caso.valor || preparacao?.input.valor === caso.valor && preparacao?.input.tomadorDoc === caso.tomadorDoc)
    && (!caso.textoProibido || !new RegExp(caso.textoProibido, 'i').test(resposta?.texto || ''))
    && (!caso.tambemEsperado || chamadas.some(c => c.nome === caso.tambemEsperado))
    && (!caso.argumentoEsperado || chamadas.some(c => c.nome === caso.argumentoEsperado.nome && c.input[caso.argumentoEsperado.campo] === caso.argumentoEsperado.valor));
  relatorio.casos.push({ id: caso.id, rodada, categoria: caso.categoria, passou, codigo, codigoInventado, chamadas, resposta: resposta?.texto, duracaoMs: Date.now() - inicio, custoCentavos: relatorio.custoCentavos - custoAnterior }); salvar();
  if (codigo === 'TETO_PILOTO' || codigo?.startsWith('OPENAI_')) break;
}
const casosDaRodada = relatorio.casos.filter(c => (c.rodada || 'inicial') === rodada);
process.stdout.write(JSON.stringify({ rodada, avaliados: casosDaRodada.length, aprovados: casosDaRodada.filter(c => c.passou).length, custoCentavos: relatorio.custoCentavos, reservas: relatorio.reservas, destino }));
if (casosDaRodada.length < CASOS_SUPORTE_GPT.length || casosDaRodada.some(c => !c.passou)) process.exitCode = 1;
} finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
