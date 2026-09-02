// Leitor de ZIP — o Fisco Fácil entrega o lote zipado, e não há biblioteca de LEITURA no projeto.
//
// ⚠ POR QUE ESCRITO À MÃO, e não `yauzl`/`adm-zip`/`unzipper`. Medido em 23/08/2026: o repositório
// declara `archiver` (7.0.1), que é ZIP de **ESCRITA** — `NotasDownloadService` zipa o `xmlRaw` que
// já está no banco. Nenhum leitor de ZIP existe, nem declarado nem transitivo (o que há é
// `zip-stream`/`compress-commons`, dependências do próprio `archiver`, também de escrita). Instalar
// dependência nova reescreve o `package-lock.json` — que é compartilhado com as outras sessões
// ativas nesta árvore. O formato ZIP que interessa aqui é o clássico (deflate/stored), e
// `node:zlib` já traz o `inflateRaw` que ele exige.
//
// ⚠ A LEITURA É PELO DIRETÓRIO CENTRAL (fim do arquivo), NUNCA varrendo os cabeçalhos locais.
// O cabeçalho local pode trazer tamanho ZERO quando o gravador usou "data descriptor" (bit 3 do
// flag) — quem sempre tem o tamanho verdadeiro é o diretório central. Varrer o começo do arquivo
// acharia entrada com tamanho mentiroso e cortaria XML no meio, em silêncio.
//
// ⚠ MEMÓRIA LIMITADA POR ENTRADA. O lote de seis meses de varejo não cabe num Buffer: o ZIP fica em
// arquivo temporário (multer `diskStorage`) e cada entrada é lida por `createReadStream(start,end)`
// → `inflateRaw`. Em nenhum momento existem N documentos inflados ao mesmo tempo — existe UM.

import { createReadStream } from "node:fs";
import { open as abrirArquivo } from "node:fs/promises";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";
import { pipeline } from "node:stream/promises";

const ASSINATURA_EOCD = 0x06054b50; // fim do diretório central
const ASSINATURA_EOCD64_LOCATOR = 0x07064b50; // localizador do EOCD ZIP64
const ASSINATURA_EOCD64 = 0x06064b50; // EOCD ZIP64
const ASSINATURA_CD = 0x02014b50; // cabeçalho no diretório central
const ASSINATURA_LOCAL = 0x04034b50; // cabeçalho local

const METODO_ARMAZENADO = 0;
const METODO_DEFLATE = 8;

// O comentário do ZIP cabe em 65.535 bytes; +22 do próprio EOCD.
const MAX_CAUDA = 65535 + 22;

// Teto por entrada — um XML de NF-e tem dezenas de KB. 32 MB é folga de três ordens de grandeza e
// ao mesmo tempo barra "zip bomb" (arquivo minúsculo que infla para gigabytes).
export const MAX_BYTES_POR_ENTRADA = 32 * 1024 * 1024;

export class ZipError extends Error {
  constructor(codigo, mensagem) {
    super(mensagem || codigo);
    this.codigo = codigo;
  }
}

/**
 * O arquivo começa com a assinatura de um ZIP?
 * `PK\x03\x04` (com entradas) ou `PK\x05\x06` (ZIP vazio — que é resposta legítima aqui: o portal
 * tem o estado "Processada sem resultado").
 */
export async function ehArquivoZip(caminho) {
  let fh = null;
  try {
    fh = await abrirArquivo(caminho, "r");
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, 0);
    if (bytesRead < 4) return false;
    const assinatura = buf.readUInt32LE(0);
    return assinatura === 0x04034b50 || assinatura === ASSINATURA_EOCD || assinatura === 0x08074b50;
  } catch {
    return false;
  } finally {
    await fh?.close().catch(() => {});
  }
}

/**
 * Lê o diretório central e devolve a lista de entradas (sem inflar nada).
 * Cada entrada: { nome, tamanho, tamanhoComprimido, metodo, offsetLocal, criptografada }
 */
export async function lerDiretorioCentral(caminho) {
  const fh = await abrirArquivo(caminho, "r");
  try {
    const { size: tamanhoArquivo } = await fh.stat();
    if (tamanhoArquivo < 22) throw new ZipError("zip_invalido", "Arquivo pequeno demais para ser um ZIP");

    // ── EOCD ────────────────────────────────────────────────────────────────────────────────
    const tamanhoCauda = Math.min(MAX_CAUDA, tamanhoArquivo);
    const cauda = Buffer.alloc(tamanhoCauda);
    await fh.read(cauda, 0, tamanhoCauda, tamanhoArquivo - tamanhoCauda);

    let posEocd = -1;
    for (let i = cauda.length - 22; i >= 0; i -= 1) {
      if (cauda.readUInt32LE(i) === ASSINATURA_EOCD) {
        posEocd = i;
        break;
      }
    }
    if (posEocd < 0) throw new ZipError("zip_invalido", "Fim do diretório central (EOCD) não encontrado");

    let totalEntradas = cauda.readUInt16LE(posEocd + 10);
    let tamanhoCd = cauda.readUInt32LE(posEocd + 12);
    let offsetCd = cauda.readUInt32LE(posEocd + 16);

    // ── ZIP64 ───────────────────────────────────────────────────────────────────────────────
    // ⚠ NÃO É LUXO: os campos acima têm 16/32 bits. Lote com mais de 65.535 documentos, ou maior
    // que 4 GB, grava 0xFFFF/0xFFFFFFFF aqui e o número verdadeiro no registro ZIP64. Ler só o
    // EOCD clássico importaria uma fração do lote **sem avisar** — o defeito silencioso que este
    // import inteiro existe para não ter.
    const precisaZip64 =
      totalEntradas === 0xffff || tamanhoCd === 0xffffffff || offsetCd === 0xffffffff;
    if (precisaZip64) {
      let posLocator = -1;
      for (let i = posEocd - 20; i >= 0; i -= 1) {
        if (cauda.readUInt32LE(i) === ASSINATURA_EOCD64_LOCATOR) {
          posLocator = i;
          break;
        }
      }
      if (posLocator < 0) throw new ZipError("zip_zip64_sem_locator", "ZIP64 sem localizador do EOCD");
      const offsetEocd64 = Number(cauda.readBigUInt64LE(posLocator + 8));
      const buf64 = Buffer.alloc(56);
      await fh.read(buf64, 0, 56, offsetEocd64);
      if (buf64.readUInt32LE(0) !== ASSINATURA_EOCD64) {
        throw new ZipError("zip_zip64_invalido", "Registro EOCD ZIP64 inválido");
      }
      totalEntradas = Number(buf64.readBigUInt64LE(32));
      tamanhoCd = Number(buf64.readBigUInt64LE(40));
      offsetCd = Number(buf64.readBigUInt64LE(48));
    }

    if (totalEntradas === 0) return [];

    const cd = Buffer.alloc(tamanhoCd);
    await fh.read(cd, 0, tamanhoCd, offsetCd);

    const entradas = [];
    let p = 0;
    for (let i = 0; i < totalEntradas; i += 1) {
      if (p + 46 > cd.length) break;
      if (cd.readUInt32LE(p) !== ASSINATURA_CD) {
        throw new ZipError("zip_invalido", "Cabeçalho do diretório central inválido");
      }
      const flags = cd.readUInt16LE(p + 8);
      const metodo = cd.readUInt16LE(p + 10);
      let tamanhoComprimido = cd.readUInt32LE(p + 20);
      let tamanho = cd.readUInt32LE(p + 24);
      const tamNome = cd.readUInt16LE(p + 28);
      const tamExtra = cd.readUInt16LE(p + 30);
      const tamComentario = cd.readUInt16LE(p + 32);
      let offsetLocal = cd.readUInt32LE(p + 42);
      // Bit 11 = nome em UTF-8. Sem ele o padrão é CP437; para nomes de arquivo de NF-e
      // (dígitos + "-nfe.xml") os dois coincidem, e latin1 preserva os bytes sem inventar.
      const nome = cd.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + tamNome);

      // Extra field ZIP64 (header id 0x0001) — só os campos que estouraram vêm aqui, NA ORDEM.
      if (tamanho === 0xffffffff || tamanhoComprimido === 0xffffffff || offsetLocal === 0xffffffff) {
        let e = p + 46 + tamNome;
        const fimExtra = e + tamExtra;
        while (e + 4 <= fimExtra) {
          const idCampo = cd.readUInt16LE(e);
          const tamCampo = cd.readUInt16LE(e + 2);
          if (idCampo === 0x0001) {
            let q = e + 4;
            if (tamanho === 0xffffffff) { tamanho = Number(cd.readBigUInt64LE(q)); q += 8; }
            if (tamanhoComprimido === 0xffffffff) { tamanhoComprimido = Number(cd.readBigUInt64LE(q)); q += 8; }
            if (offsetLocal === 0xffffffff) { offsetLocal = Number(cd.readBigUInt64LE(q)); q += 8; }
            break;
          }
          e += 4 + tamCampo;
        }
      }

      entradas.push({
        nome,
        tamanho,
        tamanhoComprimido,
        metodo,
        offsetLocal,
        // Bit 0 = criptografado. Não tentamos senha: entrada assim vira motivo nomeado no relatório.
        criptografada: Boolean(flags & 0x1),
        diretorio: nome.endsWith("/") || nome.endsWith("\\"),
      });
      p += 46 + tamNome + tamExtra + tamComentario;
    }
    return entradas;
  } finally {
    await fh.close().catch(() => {});
  }
}

/**
 * Onde começam os bytes de dados da entrada. O cabeçalho local repete nome e extra com tamanhos
 * PRÓPRIOS (podem diferir dos do diretório central), então eles têm de ser lidos de lá.
 */
/**
 * ⚠ `fh` opcional: quando quem chama já tem o arquivo aberto, NÃO se abre de novo. Ver a medição em
 * `percorrerZip` — abrir e fechar por entrada era o custo dominante da leitura de um lote.
 */
async function resolverOffsetDados(caminho, entrada, fh = null) {
  const proprio = fh ? null : await abrirArquivo(caminho, "r");
  const alvo = fh || proprio;
  try {
    const cab = Buffer.alloc(30);
    await alvo.read(cab, 0, 30, entrada.offsetLocal);
    if (cab.readUInt32LE(0) !== ASSINATURA_LOCAL) {
      throw new ZipError("zip_cabecalho_local_invalido", `Cabeçalho local inválido em ${entrada.nome}`);
    }
    const tamNome = cab.readUInt16LE(26);
    const tamExtra = cab.readUInt16LE(28);
    return entrada.offsetLocal + 30 + tamNome + tamExtra;
  } finally {
    if (proprio) await proprio.close().catch(() => {});
  }
}

/**
 * Descompacta UMA entrada e devolve o texto.
 * ⚠ A codificação sai do prólogo do próprio XML — ver `decodificarXml`.
 */
export async function lerTextoDaEntrada(caminho, entrada, { maxBytes = MAX_BYTES_POR_ENTRADA, fh = null } = {}) {
  if (entrada.criptografada) throw new ZipError("zip_entrada_criptografada", `Entrada protegida por senha: ${entrada.nome}`);
  if (entrada.metodo !== METODO_ARMAZENADO && entrada.metodo !== METODO_DEFLATE) {
    throw new ZipError("zip_metodo_nao_suportado", `Método de compressão ${entrada.metodo} em ${entrada.nome}`);
  }
  if (entrada.tamanho > maxBytes) {
    throw new ZipError("zip_entrada_grande_demais", `${entrada.nome} tem ${entrada.tamanho} bytes`);
  }
  /**
   * ⚠⚠ O COMPRIMIDO TAMBÉM TEM TETO, e esta guarda é NOVA (02/09/2026).
   *
   * A de cima confia no tamanho DECLARADO pelo diretório central. Um ZIP hostil declara 1 KB e
   * guarda 4 GB comprimidos: a guarda de cima passa, e quem lê os bytes come a memória inteira
   * antes de inflar coisa nenhuma.
   *
   * ⚠ Ela não recusa arquivo legítimo: deflate praticamente nunca expande (o pior caso do formato é
   * ~0,03% de acréscimo), então comprimido acima do teto significa inflado acima do teto — que a
   * regra já recusa. O que ela pega é o cabeçalho MENTINDO, e o motivo é o mesmo.
   */
  if (entrada.tamanhoComprimido > maxBytes) {
    throw new ZipError("zip_entrada_grande_demais", `${entrada.nome} tem ${entrada.tamanhoComprimido} bytes comprimidos`);
  }
  if (entrada.tamanhoComprimido === 0) return "";

  const inicio = await resolverOffsetDados(caminho, entrada, fh);
  const partes = [];
  let total = 0;
  const coletar = async (origem) => {
    for await (const pedaco of origem) {
      total += pedaco.length;
      // O teto vale para o INFLADO, não para o comprimido — é aqui que a zip bomb morre.
      if (total > maxBytes) throw new ZipError("zip_entrada_grande_demais", `${entrada.nome} passou de ${maxBytes} bytes`);
      partes.push(pedaco);
    }
  };

  /**
   * ⚠⚠ A ORIGEM DOS BYTES DEPENDE DE QUEM CHAMOU, e a diferença foi MEDIDA (02/09/2026).
   *
   * Com `fh` (o caso do `percorrerZip`), os bytes comprimidos saem do handle que já está aberto —
   * **zero abertura de arquivo por entrada**. Sem `fh`, continua o `createReadStream(start,end)` de
   * sempre, para quem chama esta função solta não mudar de comportamento.
   *
   * ⚠ O bloco comprimido cabe na memória por causa da guarda acima; o INFLADO continua saindo por
   * stream, com o teto contado pedaço a pedaço. A zip bomb morre nos dois lugares.
   */
  let origem;
  if (fh) {
    const bruto = Buffer.alloc(entrada.tamanhoComprimido);
    let lidos = 0;
    while (lidos < bruto.length) {
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await fh.read(bruto, lidos, bruto.length - lidos, inicio + lidos);
      // ⚠ Fim de arquivo antes do tamanho declarado é ZIP truncado — e ele vira erro DA ENTRADA,
      // como todo o resto: um arquivo cortado no meio do lote não derruba os vizinhos.
      if (!bytesRead) throw new ZipError("zip_entrada_truncada", `${entrada.nome} acabou antes do tamanho declarado`);
      lidos += bytesRead;
    }
    origem = Readable.from([bruto]);
  } else {
    origem = createReadStream(caminho, {
      start: inicio,
      end: inicio + entrada.tamanhoComprimido - 1,
    });
  }

  if (entrada.metodo === METODO_DEFLATE) {
    await pipeline(origem, createInflateRaw(), coletar);
  } else {
    await pipeline(origem, coletar);
  }
  return decodificarXml(Buffer.concat(partes));
}

/**
 * Percorre o ZIP entrada por entrada, entregando o texto de cada uma.
 *
 * ⚠ GERADOR, não `Promise<array>`: o consumidor grava o documento e SOLTA o texto antes de a
 * próxima entrada ser inflada. Um `map` sobre as entradas teria o lote inteiro em memória — que é
 * exatamente o que o limite do import de NFS-e (50 arquivos) não conseguia sustentar.
 *
 * Entrada com defeito devolve `{ erro }` em vez de estourar: um XML corrompido no meio do lote não
 * pode derrubar os outros 5.000.
 */
export async function* percorrerZip(caminho, opcoes = {}) {
  const entradas = await lerDiretorioCentral(caminho);
  /**
   * ⚠⚠ UM HANDLE PARA O LOTE INTEIRO — e a diferença é grande o bastante para mudar o produto.
   *
   * MEDIDO em 02/09/2026, num ZIP de 500 notas: a leitura levava **37,6 s**, ou seja ~75 ms POR
   * ENTRADA, e o tempo não era do `inflate` — eram DUAS aberturas de arquivo por entrada (uma para
   * ler os 30 bytes do cabeçalho local, outra para o `createReadStream` dos dados). No Windows,
   * com antivírus no caminho, abrir arquivo é o custo dominante.
   *
   * ⚠ O desenho de memória NÃO mudou: continua UM documento inflado por vez, por stream. O que
   * deixou de acontecer foi abrir e fechar o mesmo arquivo mil vezes.
   * ⚠ O handle é fechado no `finally` — o gerador pode ser abandonado no meio (um `break` no
   * consumidor), e sem isso o descritor vazaria a cada lote interrompido.
   */
  const fh = await abrirArquivo(caminho, "r");
  try {
    for (const entrada of entradas) {
      if (entrada.diretorio) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const texto = await lerTextoDaEntrada(caminho, entrada, { ...opcoes, fh });
        yield { nome: entrada.nome, texto, tamanho: entrada.tamanho };
      } catch (err) {
        yield { nome: entrada.nome, texto: null, erro: err?.codigo || "zip_entrada_ilegivel", mensagem: err?.message || null };
      }
    }
  } finally {
    await fh.close().catch(() => {});
  }
}

/**
 * ⚠ XML DE NF-e NÃO É SEMPRE UTF-8. O leiaute admite `ISO-8859-1`, e vários emissores usam. Decodar
 * tudo como UTF-8 não quebra o parser (a estrutura é ASCII) — quebra o NOME: "COMÉRCIO" viraria
 * "COM�RCIO" gravado em `emitenteNome`, em silêncio, para sempre. O prólogo declara a codificação;
 * é ele quem manda.
 */
export function decodificarXml(buffer) {
  if (!buffer || buffer.length === 0) return "";
  // BOM UTF-8 — corta, senão o parser vê lixo antes do "<".
  let buf = buffer;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  const prologo = buf.subarray(0, 120).toString("latin1").toLowerCase();
  if (/encoding\s*=\s*["'](iso-8859-1|latin1|windows-1252)["']/.test(prologo)) {
    return buf.toString("latin1");
  }
  return buf.toString("utf8");
}
