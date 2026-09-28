import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { precoDoModelo } from '../../src/application/assistente/precosIa.js';

// O laboratório usa milionésimos de dólar. A guarda de produção continua em centavos.
export function custoMicrousd(usage, modelo) {
  const campos = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
  assert(usage && campos.every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0), 'Uso inválido.');
  assert(campos.some(k => usage[k] > 0), 'Uso vazio.');
  const p = precoDoModelo(modelo);
  return Math.ceil((usage.input_tokens * p.entrada + usage.output_tokens * p.saida
    + usage.cache_read_input_tokens * p.cacheLeitura + usage.cache_creation_input_tokens * p.cacheEscrita) / 100);
}

export class OrcamentoEnsaio {
  constructor(arquivo, tetoUsd) {
    this.arquivo = path.resolve(arquivo);
    assert(Number.isFinite(tetoUsd) && tetoUsd > 0 && tetoUsd <= 5, 'Teto inválido.');
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    // Uma interrupção mantém o bloqueio e a reserva; exige revisão antes de reutilizar.
    this.lock = fs.openSync(`${this.arquivo}.lock`, 'wx');
    try {
      const teto = Math.floor(tetoUsd * 1_000_000);
      this.estado = fs.existsSync(this.arquivo) ? JSON.parse(fs.readFileSync(this.arquivo, 'utf8'))
        : { versao: 1, tetoMicrousd: teto, chamadas: [] };
      assert(this.estado.versao === 1 && this.estado.tetoMicrousd === teto && Array.isArray(this.estado.chamadas), 'Orçamento incompatível.');
      assert(this.estado.chamadas.every(c => Number.isSafeInteger(c.custoMicrousd) && c.custoMicrousd >= 0), 'Registro inválido.');
      this.salvar();
    } catch (e) { this.fechar(); throw e; }
  }
  get gasto() { return this.estado.chamadas.reduce((s, c) => s + c.custoMicrousd, 0); }
  salvar() {
    const temporario = `${this.arquivo}.tmp`;
    const conteudo = JSON.stringify(this.estado, null, 2);
    for (let tentativa = 0; ; tentativa++) {
      try {
        fs.writeFileSync(temporario, conteudo, { flush: true });
        fs.renameSync(temporario, this.arquivo);
        return;
      } catch (e) {
        // Leitores/antivírus no Windows podem segurar o arquivo brevemente.
        // Repetir somente a persistência local, nunca a chamada paga.
        if (tentativa >= 9 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code))
          throw Object.assign(new Error('Falha ao persistir orçamento.'), { codigo: `ORCAMENTO_PERSISTENCIA_${e.code || 'ERRO'}` });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  }
  reservar(reservaMicrousd, identificacao) {
    assert(Number.isSafeInteger(reservaMicrousd) && reservaMicrousd > 0, 'Reserva inválida.');
    if (this.gasto + reservaMicrousd > this.estado.tetoMicrousd) return null;
    const id = this.estado.chamadas.length;
    this.estado.chamadas.push({ id, identificacao, estado: 'RESERVADO', custoMicrousd: reservaMicrousd, criadoEm: new Date().toISOString() });
    this.salvar(); // Antes da chamada externa, inclusive se houver queda do processo.
    return id;
  }
  concluir(id, usage, modelo) {
    const c = this.estado.chamadas[id];
    assert(c?.estado === 'RESERVADO', 'Reserva inexistente ou concluída.');
    const custo = custoMicrousd(usage, modelo), excedeu = custo > c.custoMicrousd;
    Object.assign(c, { estado: 'CONCLUIDO', custoMicrousd: custo, usage, modelo });
    this.salvar();
    assert(!excedeu, 'Consumo excedeu a reserva: interromper ensaio.');
  }
  fechar() {
    if (this.lock !== undefined) {
      fs.closeSync(this.lock); this.lock = undefined;
      fs.unlinkSync(`${this.arquivo}.lock`);
    }
  }
}
