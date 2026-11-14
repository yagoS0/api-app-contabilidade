import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { conferirVigenciaDocumentoAcompanhamento as conferir } from '../VigenciaDocumentoAcompanhamento.js';

const run = process.env.ALTAN_TESTE_POSTGRES === '1' ? test : test.skip;
run('PostgreSQL: vigência isola empresa, observa a revisão e não altera os registros', async () => {
  const url = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
      || url.pathname !== '/altan_piloto_governance_test' || url.search) throw Error('Exige PostgreSQL descartável do piloto.');
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const suffix = randomUUID();
  try {
    const a = await db.portalClient.create({data:{razao:'Documento 41 A '+suffix,cnpj:'A-'+suffix}});
    const b = await db.portalClient.create({data:{razao:'Documento 41 B '+suffix,cnpj:'B-'+suffix}});
    const dados = {tipo:'IRPJ',competencia:'2026-10',status:'PROCESSED',liberadaCliente:true,valor:10};
    const guia = await db.guide.create({data:{...dados,portalClientId:a.id,hash:'a-'+suffix}});
    await db.guide.create({data:{...dados,portalClientId:b.id,hash:'b-'+suffix}});
    const before = await db.guide.findMany({where:{portalClientId:{in:[a.id,b.id]}},orderBy:{id:'asc'}});
    const result = await db.$transaction(tx => conferir(tx,guia),{isolationLevel:'RepeatableRead'});
    expect(result).toMatchObject({vigente:true,source:'OBRIGACAO_DOCUMENTO_UNICO',guideId:guia.id});
    expect(await db.guide.findMany({where:{portalClientId:{in:[a.id,b.id]}},orderBy:{id:'asc'}})).toEqual(before);
    await db.guide.update({where:{id:guia.id},data:{hash:'novo-'+suffix}});
    expect(await conferir(db,guia)).toMatchObject({vigente:false,reason:'DOCUMENTO_ALTERADO'});
    const vigente = await db.guide.findUnique({where:{id:guia.id}});
    await db.guide.create({data:{...dados,portalClientId:a.id,hash:'duplicada-'+suffix,liberadaCliente:false}});
    expect(await conferir(db,vigente)).toMatchObject({vigente:false,reason:'DOCUMENTO_AMBIGUO'});
  } finally {
    await db.$disconnect();
  }
});
