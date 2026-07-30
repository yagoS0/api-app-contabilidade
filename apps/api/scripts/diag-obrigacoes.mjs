// Exercita o Controle de Obrigações contra o banco de verdade, do cadastro à conclusão automática.
//
// Existe porque as regras que importam aqui só aparecem gravando: a janela de 12 meses, o dia 31
// em fevereiro, o ajuste de dia útil e — principalmente — o verificador concluir sozinho olhando a
// competência CERTA (que é a do serviço, não a do vencimento).
//
//   node scripts/diag-obrigacoes.mjs            → cria, confere e APAGA tudo que criou
//   node scripts/diag-obrigacoes.mjs --manter   → não apaga (para inspecionar na tela)
//
// Cria uma obrigação de teste numa empresa real e a remove no fim. Não toca em nada existente.

import { prisma } from "../src/infrastructure/db/prisma.js";
import {
  aplicarVerificadores,
  atualizar,
  concluir,
  criar,
  listar,
  remover,
} from "../src/application/obrigacoes/ObrigacoesService.js";

const manter = process.argv.includes("--manter");
const NOME = "[DIAG] Obrigação de teste";

const ok = (m) => console.log(`  ✓ ${m}`);
const falha = (m) => { console.log(`  ✗ ${m}`); process.exitCode = 1; };
const checar = (cond, m) => (cond ? ok(m) : falha(m));

async function main() {
  // Prefere uma empresa que TENHA apuração transmitida numa competência que a janela alcança:
  // sem isso o passo 4 não exercita nada, e a conclusão automática é justamente o que precisa de
  // prova. `defasagemMeses` é ajustada abaixo para casar a competência dessa empresa.
  const hoje = new Date();
  const compAtual = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}`;
  const transmitida = await prisma.apuracaoSnapshot.findFirst({
    where: { estado: { in: ["transmitida", "confirmada"] }, competencia: { lte: compAtual } },
    select: { portalClientId: true, competencia: true, estado: true },
    orderBy: { competencia: "desc" },
  });

  const empresa = await prisma.portalClient.findFirst({
    where: transmitida ? { id: transmitida.portalClientId } : { status: "ATIVA" },
    select: { id: true, razao: true, municipio: true },
    orderBy: { razao: "asc" },
  });
  if (!empresa) {
    console.log("Nenhuma empresa ATIVA no banco — nada a exercitar.");
    return;
  }
  console.log(`Empresa: ${empresa.razao} (${empresa.municipio || "sem município"})`);
  if (transmitida) {
    console.log(`Apuração transmitida em ${transmitida.competencia} (${transmitida.estado}) — o passo 4 vai valer.`);
  } else {
    console.log("Nenhuma apuração transmitida no banco — o passo 4 não terá o que concluir.");
  }
  // Quantos meses atrás do mês corrente está a competência transmitida.
  const defasagemParaAcertar = transmitida
    ? (Number(compAtual.slice(0, 4)) * 12 + Number(compAtual.slice(5, 7))) -
      (Number(transmitida.competencia.slice(0, 4)) * 12 + Number(transmitida.competencia.slice(5, 7)))
    : 1;
  console.log("");

  // Limpa sobra de execução anterior interrompida.
  await prisma.obrigacao.deleteMany({ where: { portalClientId: empresa.id, nome: NOME } });

  console.log(`1) MENSAL, dia 31, ANTECIPAR, defasagem ${defasagemParaAcertar}`);
  const { obrigacao, criadas } = await criar({
    portalClientId: empresa.id,
    dados: {
      nome: NOME,
      categoria: "fiscal",
      periodicidade: "MENSAL",
      diaVencimento: 31,
      ajusteDiaUtil: "ANTECIPAR",
      defasagemMeses: defasagemParaAcertar,
      verificador: "APURACAO_TRANSMITIDA",
    },
  });
  checar(criadas === 12, `gerou 12 ocorrências (gerou ${criadas})`);

  const ocs = await prisma.ocorrenciaObrigacao.findMany({
    where: { obrigacaoId: obrigacao.id },
    orderBy: { dataVencimento: "asc" },
  });
  const iso = (d) => d.toISOString().slice(0, 10);

  checar(
    ocs.every((o) => { const d = o.dataVencimento.getUTCDay(); return d !== 0 && d !== 6; }),
    "nenhum vencimento caiu em sábado ou domingo",
  );

  const fev = ocs.find((o) => iso(o.dataVencimento).slice(5, 7) === "02");
  if (fev) {
    checar(
      Number(iso(fev.dataVencimento).slice(8)) <= 29,
      `dia 31 em fevereiro não transbordou para março (ficou ${iso(fev.dataVencimento)})`,
    );
  }

  const primeira = ocs[0];
  const mesVenc = iso(primeira.dataVencimento).slice(0, 7);
  if (defasagemParaAcertar > 0) {
    checar(
      primeira.competenciaRef !== mesVenc,
      `competência do serviço (${primeira.competenciaRef}) difere do mês do vencimento (${mesVenc})`,
    );
  } else {
    checar(primeira.competenciaRef === mesVenc, "defasagem 0: competência igual ao mês do vencimento");
  }

  console.log("\n2) Idempotência — regerar não duplica");
  const { criadas: recriadas } = await atualizar({
    portalIds: [empresa.id],
    obrigacaoId: obrigacao.id,
    dados: { nome: NOME },
  });
  const total = await prisma.ocorrenciaObrigacao.count({ where: { obrigacaoId: obrigacao.id } });
  checar(recriadas === 0 && total === 12, `continuou com 12 ocorrências (tem ${total})`);

  console.log("\n3) Conclusão automática não aceita clique");
  try {
    await concluir({ portalIds: [empresa.id], ocorrenciaId: primeira.id });
    falha("deixou concluir à mão uma obrigação com verificador");
  } catch (err) {
    checar(err.code === "conclusao_automatica", "recusou o clique, como deve");
  }

  console.log("\n4) Verificador olha a competência do SERVIÇO");
  const antes = await prisma.ocorrenciaObrigacao.count({
    where: { obrigacaoId: obrigacao.id, status: "CONCLUIDA" },
  });
  const { concluidas } = await aplicarVerificadores({ portalIds: [empresa.id] });
  const depois = await prisma.ocorrenciaObrigacao.findMany({
    where: { obrigacaoId: obrigacao.id, status: "CONCLUIDA" },
    select: { competenciaRef: true, fonteConclusao: true },
  });
  console.log(`  concluídas nesta passada: ${concluidas} (antes havia ${antes})`);
  if (depois.length) {
    const comps = depois.map((d) => d.competenciaRef).join(", ");
    checar(
      depois.every((d) => d.fonteConclusao === "AUTOMATICA"),
      `marcadas como AUTOMATICA — competências: ${comps}`,
    );
    const snaps = await prisma.apuracaoSnapshot.findMany({
      where: { portalClientId: empresa.id, competencia: { in: depois.map((d) => d.competenciaRef) } },
      select: { competencia: true, estado: true },
    });
    checar(
      snaps.length > 0 && snaps.every((s) => ["transmitida", "confirmada"].includes(String(s.estado))),
      `cada conclusão tem apuração transmitida de verdade (${snaps.map((s) => `${s.competencia}=${s.estado}`).join(", ") || "nenhuma"})`,
    );
  } else {
    console.log("  (esta empresa não tem apuração transmitida nas competências da janela — nada a concluir)");
  }

  console.log("\n5) Leitura: VENCIDA é derivada, não gravada");
  const { obrigacoes, resumo } = await listar({ portalIds: [empresa.id] });
  const minha = obrigacoes.find((o) => o.obrigacaoId === obrigacao.id);
  checar(Boolean(minha?.proximoVencimento), `próximo vencimento: ${minha?.proximoVencimento}`);
  checar(minha?.conclusaoAutomatica === true, "a UI sabe que esta não pede clique");
  const gravadasVencidas = await prisma.ocorrenciaObrigacao.count({
    where: { obrigacaoId: obrigacao.id, status: "VENCIDA" },
  });
  checar(gravadasVencidas === 0, "nenhuma linha com status VENCIDA no banco");
  console.log(`  resumo do escritório: ${resumo.pendentes} pendentes · ${resumo.vencendoEm7Dias} em 7 dias · ${resumo.vencidas} vencidas`);

  console.log("\n6) Inativar remove só o futuro pendente");
  await atualizar({ portalIds: [empresa.id], obrigacaoId: obrigacao.id, dados: { ativa: false } });
  const restantes = await prisma.ocorrenciaObrigacao.count({ where: { obrigacaoId: obrigacao.id } });
  const concluidasRestantes = await prisma.ocorrenciaObrigacao.count({
    where: { obrigacaoId: obrigacao.id, status: "CONCLUIDA" },
  });
  checar(
    restantes === concluidasRestantes,
    `sobraram só as concluídas (${concluidasRestantes} de ${restantes})`,
  );

  if (manter) {
    console.log(`\n--manter: a obrigação "${NOME}" ficou no banco.`);
  } else {
    await remover({ portalIds: [empresa.id], obrigacaoId: obrigacao.id });
    console.log("\nLimpo: obrigação de teste removida.");
  }
}

main()
  .catch((err) => { console.error("ERRO:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
