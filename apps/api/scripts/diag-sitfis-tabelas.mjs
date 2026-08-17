// Diagnóstico das TABELAS da aba Situação Fiscal — roda o parser sobre os relatórios REAIS
// guardados em `CompanyFiscalStatus.texto` e mede em que estado cada bloco cai.
//
//   node scripts/diag-sitfis-tabelas.mjs
//   node scripts/diag-sitfis-tabelas.mjs --cnpj=<cnpj>        (detalha uma empresa)
//   node scripts/diag-sitfis-tabelas.mjs --detalhe            (imprime cada bloco suspeito)
//   node scripts/diag-sitfis-tabelas.mjs --pdf                (confere o PDF no storage, ponta a ponta)
//
// ⚠ SÓ LEITURA. Não grava nada, não chama o SERPRO, não escreve arquivo.
//
// ── POR QUE ESTE SCRIPT EXISTE ──
//
// A contagem (`dados.length % colunas.length === 0`) é uma rede ARITMÉTICA: desalinhamento cujo
// tamanho seja múltiplo do número de colunas FECHA a divisão e vira tabela — com os valores em
// coluna trocada, silenciosamente. Foi o que aconteceu com a armadilha 8 (`Vl.Original` colado),
// que mostrava "30,65" debaixo de "Receita" em produção.
//
// Então este script mede TRÊS números, não dois:
//   (a) blocos que viram tabela;
//   (b) blocos que caem em `naoInterpretado` (o parser recusou — resposta legítima);
//   (c) blocos que viram tabela cuja FORMA NÃO BATE — data em coluna de valor, valor em coluna de
//       data, valor monetário em coluna de texto, célula vazia no meio. Esse terceiro número é o
//       único que denuncia o defeito silencioso.
//
// A verificação de forma aqui é DIAGNÓSTICO, não conserto: ela não altera o parser nem esconde
// nada. Serve para dizer se o que a tela mostra bate com o que o relatório imprime.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { parseSitfisRelatorio } from "../src/application/fiscal/serpro/parseSitfisRelatorio.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const temFlag = (n) => process.argv.includes(`--${n}`);

// ── A FORMA ESPERADA DE CADA COLUNA ──
// Mesma lista de colunas de dinheiro que a TELA usa (`SitfisRelatorioTabela.jsx`), de propósito:
// é ela que decide alinhamento à direita e fonte monoespaçada. Se a tela trata como dinheiro,
// aqui se confere que o conteúdo é dinheiro.
const COLUNAS_VALOR = new Set([
  "Vl. Original", "Sdo. Devedor", "Vl.Original", "Sdo.Devedor",
  "Multa", "Juros", "Sdo. Dev. Cons.", "Valor",
  // As duas colunas de dinheiro do bloco do parcelamento (SIEFPAR), que virou tabela em 17/08/2026.
  "Valor em Atraso", "Valor Suspenso",
]);
const COLUNAS_DATA = new Set(["Dt. Vcto", "Data"]);

const RE_MONETARIO = /^-?[\d.]+,\d{2}$/;           // mesma regra de `parseValorBR`
const RE_DATA = /^\d{2}\/\d{2}\/\d{4}$/;

function classificarCelula(coluna, valor) {
  const v = String(valor ?? "").trim();
  if (!v) return { grave: false, tipo: "vazia", coluna, valor: v };

  if (COLUNAS_VALOR.has(coluna)) {
    if (RE_MONETARIO.test(v)) return null;
    // Data numa coluna de dinheiro é o defeito antigo em pessoa.
    if (RE_DATA.test(v)) return { grave: true, tipo: "data_em_coluna_de_valor", coluna, valor: v };
    return { grave: true, tipo: "nao_monetario_em_coluna_de_valor", coluna, valor: v };
  }

  if (COLUNAS_DATA.has(coluna)) {
    if (RE_DATA.test(v)) return null;
    if (RE_MONETARIO.test(v)) return { grave: true, tipo: "valor_em_coluna_de_data", coluna, valor: v };
    return { grave: true, tipo: "nao_data_em_coluna_de_data", coluna, valor: v };
  }

  // Coluna de texto com dinheiro dentro: é literalmente o "30,65 debaixo de Receita".
  if (RE_MONETARIO.test(v)) return { grave: true, tipo: "valor_em_coluna_de_texto", coluna, valor: v };
  return null;
}

// ⚠ AQUI HAVIA UMA MEDIÇÃO QUE HOJE SERIA MENTIRA, e por isso ela saiu (17/08/2026).
// `colunasQueASomem` reproduzia a regra `colunasConstantes` de `SitfisRelatorioTabela.jsx` — a que
// tirava da tabela toda coluna não-monetária cujo valor se repetisse em todas as linhas — para
// medir quantas colunas o parser lia e a tela NÃO mostrava. Essa regra foi REMOVIDA da tela no
// commit 508a67b3 (pedido do dono: *"preciso que essa tabela seja consistente"*); a tela mostra
// todas as colunas, sempre. Manter a seção aqui faria o diagnóstico anunciar 19 colunas "somindo"
// numa tela onde nenhuma some — e diagnóstico que descreve regra inexistente é como o quadro de
// flags envelhecido: alguém dimensiona trabalho em cima dele.
// O número da coluna oculta continua sendo medível pelo `--tudo`, que imprime a tabela inteira.

function conferirForma(bloco) {
  const achados = [];
  for (const r of bloco.registros || []) {
    for (const c of bloco.colunas || []) {
      const a = classificarCelula(c, r[c]);
      if (a) achados.push(a);
    }
  }
  return achados;
}

// ⚠ QUATRO ESTADOS, não três. `descricao_apenas` é o bloco em que NENHUM rótulo bate com
// `COLUNAS_CONHECIDAS` — ele não vira tabela E TAMBÉM NÃO cai em `naoInterpretado` (o parser
// devolve `naoInterpretado: []` quando `colunas` está vazia, porque `dados` já ficou vazio).
// Ele sai inteiro em `descricao`, e a tela imprime uma linha âmbar por célula. Contar só três
// estados o torna INVISÍVEL na medição.
//
// ⚠ Foi este contador que dimensionou a tabulação do SIEFPAR (17/08/2026): ele mostrava **5**
// blocos aqui, dos quais 2 eram SIEFPAR — e um deles com TRÊS parcelamentos, o caso que decidiu o
// desenho. Depois da mudança são **3**, todos "Parcelamento com Exigibilidade Suspensa
// (PARCSN/PARCMEI)": uma descrição livre, sem rótulo nenhum, logo sem par a ler.
const ESTADOS = {
  tabela_ok: 0, tabela_forma_nao_bate: 0, nao_interpretado: 0, sem_colunas: 0, descricao_apenas: 0,
};

try {
  const cnpj = arg("cnpj");
  const where = cnpj
    ? { portalClient: { OR: [{ cnpj }, { cnpj: String(cnpj).replace(/\D+/g, "") }] } }
    : {};

  const status = await prisma.companyFiscalStatus.findMany({
    where,
    select: {
      portalClientId: true,
      situacao: true,
      texto: true,
      relatorioPdfFileId: true,
      rawPayload: true,
      checkedAt: true,
      ultimoRelatorioEm: true,
      portalClient: { select: { razao: true, cnpj: true } },
    },
  });

  const comTexto = status.filter((s) => s.texto && s.texto.trim());
  const semTexto = status.filter((s) => !s.texto || !s.texto.trim());
  const comPdfId = status.filter((s) => s.relatorioPdfFileId);

  console.log(`\n=== SITFIS · TABELAS · ${status.length} registro(s) de CompanyFiscalStatus ===`);
  console.log(`  com texto salvo ....... ${comTexto.length}`);
  console.log(`  SEM texto salvo ....... ${semTexto.length}`);
  console.log(`  com relatorioPdfFileId  ${comPdfId.length}`);

  // ── O PDF DE ORIGEM, sem gastar chamada ao SERPRO ──
  // `rawPayload.dados` é uma STRING JSON com um único campo, `pdf` (base64) — é o relatório
  // inteiro. Ou seja: o PDF original está no BANCO, e continua acessível mesmo quando o arquivo
  // do volume do Railway sumiu (o caso "registro existe, arquivo não").
  // ⚠ Escreva SEMPRE fora do repositório: o PDF traz identificadores reais do contribuinte.
  const destinoPdf = arg("pdf-para");
  if (destinoPdf) {
    if (!cnpj) { console.error("--pdf-para exige --cnpj=<cnpj>."); process.exit(2); }
    const { writeFile } = await import("node:fs/promises");
    const alvo = status.find((s) => s.rawPayload);
    if (!alvo) { console.error("Sem rawPayload para essa empresa."); process.exit(1); }
    const rp = alvo.rawPayload;
    const dados = typeof rp.dados === "string" ? JSON.parse(rp.dados) : rp.dados;
    if (!dados?.pdf) { console.error("rawPayload.dados não tem o campo `pdf`."); process.exit(1); }
    const buf = Buffer.from(dados.pdf, "base64");
    await writeFile(destinoPdf, buf);
    console.log(`PDF de origem (rawPayload.dados.pdf) gravado: ${destinoPdf} · ${buf.length} bytes`);
  }

  // ── O PDF ainda existe no volume? "registro existe, arquivo não" é caso REAL com SITFIS. ──
  let pdfOk = 0; let pdfAusente = 0; const pdfErros = [];
  if (temFlag("pdf") && comPdfId.length) {
    const { GuideStorageService } = await import("../src/application/guides/GuideStorageService.js");
    const storage = GuideStorageService.create();
    for (const s of comPdfId) {
      try {
        const buf = await storage.downloadBuffer({ key: s.relatorioPdfFileId });
        if (buf?.length) pdfOk += 1;
        else { pdfAusente += 1; pdfErros.push(`${s.portalClient?.cnpj}: buffer vazio`); }
      } catch (e) {
        pdfAusente += 1;
        pdfErros.push(`${s.portalClient?.cnpj}: ${e?.message || e}`);
      }
    }
    console.log(`  PDF legível no storage  ${pdfOk}   ·   ausente/ilegível: ${pdfAusente}`);
    for (const e of pdfErros.slice(0, 5)) console.log(`      ${e}`);
  }

  const empresasComBlocoSuspeito = new Set();
  const empresasComNaoInterpretado = new Set();
  const empresasComTabela = new Set();
  const empresasSoDescricao = new Set();
  const tiposDeAchado = new Map();
  const detalhes = [];

  for (const s of comTexto) {
    const rel = parseSitfisRelatorio(s.texto);
    const rotulo = `${s.portalClient?.razao || "?"}  ·  ${s.portalClient?.cnpj || "?"}`;

    for (const d of rel.diagnosticos || []) {
      for (const b of d.blocos || []) {
        const temTabela = (b.colunas?.length || 0) > 0 && (b.registros?.length || 0) > 0;
        const temNaoInterp = (b.naoInterpretado?.length || 0) > 0;

        if (temTabela) {
          const achados = conferirForma(b);
          const graves = achados.filter((a) => a.grave);
          const vazias = achados.filter((a) => a.tipo === "vazia");
          if (graves.length || vazias.length) {
            ESTADOS.tabela_forma_nao_bate += 1;
            empresasComBlocoSuspeito.add(rotulo);
            for (const a of achados) tiposDeAchado.set(a.tipo, (tiposDeAchado.get(a.tipo) || 0) + 1);
            detalhes.push({ rotulo, orgao: d.orgao, bloco: b, achados });
          } else {
            ESTADOS.tabela_ok += 1;
          }
          empresasComTabela.add(rotulo);
        } else if (temNaoInterp) {
          ESTADOS.nao_interpretado += 1;
          empresasComNaoInterpretado.add(rotulo);
          if (!(b.colunas?.length)) ESTADOS.sem_colunas += 1;
          detalhes.push({ rotulo, orgao: d.orgao, bloco: b, achados: [] });
        } else {
          ESTADOS.descricao_apenas += 1;
          empresasSoDescricao.add(rotulo);
        }
      }
    }
  }

  const totalBlocos = ESTADOS.tabela_ok + ESTADOS.tabela_forma_nao_bate
    + ESTADOS.nao_interpretado + ESTADOS.descricao_apenas;
  console.log(`\n--- BLOCOS (${totalBlocos} no total, sobre ${comTexto.length} relatórios) ---`);
  console.log(`  tabela, forma CONFERE ............. ${ESTADOS.tabela_ok}`);
  console.log(`  tabela, forma NÃO BATE ............ ${ESTADOS.tabela_forma_nao_bate}   <== o número que denuncia coluna trocada`);
  console.log(`  não interpretado (linhas cruas) ... ${ESTADOS.nao_interpretado}   (dos quais ${ESTADOS.sem_colunas} sem cabeçalho reconhecido)`);
  console.log(`  SÓ descrição (nenhum rótulo bate) . ${ESTADOS.descricao_apenas}   <== não vira tabela E não avisa nada`);

  console.log(`\n--- EMPRESAS ---`);
  console.log(`  com pelo menos uma tabela ......... ${empresasComTabela.size}`);
  console.log(`  com pelo menos um bloco suspeito .. ${empresasComBlocoSuspeito.size}`);
  console.log(`  com pelo menos um não interpretado  ${empresasComNaoInterpretado.size}`);
  console.log(`  com pelo menos um só-descrição .... ${empresasSoDescricao.size}`);

  if (tiposDeAchado.size) {
    console.log(`\n--- TIPOS DE DIVERGÊNCIA DE FORMA (célula a célula) ---`);
    for (const [t, n] of [...tiposDeAchado].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(36)} ${n}`);
  }

  // Toda linha crua de "Notificação de lançamento" dos 22 relatórios — é dela que sai a armadilha
  // 3 (o registro seguinte vem colado). Ver a FORMA de todas antes de escrever regra sobre uma.
  if (temFlag("anotacoes")) {
    console.log(`\n=== LINHAS "Notificação de lançamento" (cruas, com os espaços preservados) ===`);
    for (const s of comTexto) {
      for (const raw of s.texto.split(/\r?\n/)) {
        if (/Notifica[çc][ãa]o de lan[çc]amento/i.test(raw)) {
          console.log(`  [${s.portalClient?.cnpj}] ${JSON.stringify(raw)}`);
        }
      }
    }
  }

  // Todos os blocos que viraram TABELA, para conferir a olho coluna por coluna.
  if (temFlag("tudo")) {
    console.log(`\n=== TODOS OS BLOCOS ===`);
    for (const s of comTexto) {
      const rel = parseSitfisRelatorio(s.texto);
      for (const d of rel.diagnosticos || []) {
        if (d.semPendencia) { console.log(`\n[${s.portalClient?.cnpj}] ${d.chave} · NADA CONSTA`); continue; }
        for (const b of d.blocos || []) {
          const estado = (b.colunas?.length && b.registros?.length) ? "TABELA"
            : b.naoInterpretado?.length ? "NAO_INTERPRETADO" : "SO_DESCRICAO";
          console.log(`\n[${s.portalClient?.cnpj}] ${d.chave} · ${estado} · "${b.titulo || "(sem título)"}"`);
          if (b.descricao?.length) console.log(`  descricao: ${JSON.stringify(b.descricao)}`);
          if (b.colunas?.length) console.log(`  colunas: ${JSON.stringify(b.colunas)}`);
          for (const r of b.registros || []) console.log(`    ${JSON.stringify(b.colunas.map((c) => r[c]))}`);
          if (b.anotacoes?.length) console.log(`  anotacoes: ${JSON.stringify(b.anotacoes)}`);
          for (const l of b.naoInterpretado || []) console.log(`    | ${l}`);
        }
      }
      if (rel.naoInterpretado?.length) console.log(`  [relatório] ${JSON.stringify(rel.naoInterpretado)}`);
    }
  }

  if (temFlag("detalhe") || cnpj) {
    console.log(`\n=== DETALHE ===`);
    for (const d of detalhes) {
      console.log(`\n[${d.rotulo}] ${d.orgao} · "${d.bloco.titulo || "(sem título)"}"`);
      if (d.bloco.descricao?.length) console.log(`  descricao: ${JSON.stringify(d.bloco.descricao)}`);
      console.log(`  colunas (${d.bloco.colunas?.length || 0}): ${JSON.stringify(d.bloco.colunas || [])}`);
      if (d.bloco.registros?.length) {
        console.log(`  registros (${d.bloco.registros.length}):`);
        for (const r of d.bloco.registros) console.log(`    ${JSON.stringify(r)}`);
      }
      if (d.bloco.naoInterpretado?.length) {
        console.log(`  naoInterpretado (${d.bloco.naoInterpretado.length} linhas):`);
        for (const l of d.bloco.naoInterpretado) console.log(`    | ${l}`);
      }
      if (d.achados.length) {
        console.log(`  ⚠ divergências de forma:`);
        for (const a of d.achados) console.log(`    ${a.grave ? "GRAVE" : "aviso"} ${a.tipo}  coluna="${a.coluna}" valor="${a.valor}"`);
      }
    }
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
