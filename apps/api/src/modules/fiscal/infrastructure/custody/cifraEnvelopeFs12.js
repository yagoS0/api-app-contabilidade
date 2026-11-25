import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
const limit=16777216;
const fail=()=>{throw Object.assign(new Error('FS12_ENVELOPE_CIFRA_INVALIDA'),{code:'FS12_ENVELOPE_CIFRA_INVALIDA'});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function aad(comando,reservaId,keyId){
  if(!comando || !reservaId || !comando.esperado?.envelopeHash) fail();
  return Buffer.from(JSON.stringify(['ALTAN_FS12_ENVELOPE',1,keyId,{
    comandoId:comando.id,tentativaId:comando.tentativaId,reservaId,
    portalClientId:comando.portalClientId,companyId:comando.companyId,cnpj:comando.cnpj,
    competencia:comando.competencia,revisaoFs12:comando.revisaoFs12,intencao:comando.intencao,
    comandoHash:comando.comandoHash,envelopeHash:comando.esperado.envelopeHash,
  }]));
}
const keyName=k=>typeof k==='string'&&k.trim().length>0&&k.length<=200;
function decode(value,max,exact){
  if(typeof value!=='string'||value.length>Math.ceil(max/3)*4) fail();
  const b=Buffer.from(value,'base64');
  if(b.length>max||(exact!==undefined&&b.length!==exact)||b.toString('base64')!==value) fail();
  return b;
}
// Separate purpose/AAD from response adapter. No fictitious response observations.
// keyId is supplied by trusted composition. Historical resolver never substitutes.
export function criarCifraEnvelopeFs12({keyId,resolveKey}){
  if(!keyName(keyId)||typeof resolveKey!=='function') fail();
  async function key(id){
    const borrowed=await resolveKey(id);
    if(!Buffer.isBuffer(borrowed)||borrowed.length!==32) fail();
    return Buffer.from(borrowed);
  }
  return {
    async cifrar({bytes,comando,reservaId}){
      if(!Buffer.isBuffer(bytes)||bytes.length>limit) fail();
      const copy=Buffer.from(bytes);
      if(hash(copy)!==comando.esperado.envelopeHash) fail();
      const k=await key(keyId);
      try{
        const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',k,nonce);
        cipher.setAAD(aad(comando,reservaId,keyId));
        const ciphertext=Buffer.concat([cipher.update(copy),cipher.final()]);
        return {v:1,alg:'AES-256-GCM',keyId,nonce:nonce.toString('base64'),
          ciphertext:ciphertext.toString('base64'),tag:cipher.getAuthTag().toString('base64'),aadVersion:1};
      }finally{k.fill(0);copy.fill(0);}
    },
    async decifrar({envelope:e,comando,reservaId}){
      if(!e||Object.keys(e).sort().join(',')!=='aadVersion,alg,ciphertext,keyId,nonce,tag,v'
        ||e.v!==1||e.aadVersion!==1||e.alg!=='AES-256-GCM'||!keyName(e.keyId)) fail();
      const nonce=decode(e.nonce,12,12),tag=decode(e.tag,16,16),bytes=decode(e.ciphertext,limit);
      const k=await key(e.keyId);
      try{
        const decipher=createDecipheriv('aes-256-gcm',k,nonce);
        decipher.setAAD(aad(comando,reservaId,e.keyId));decipher.setAuthTag(tag);
        const output=Buffer.concat([decipher.update(bytes),decipher.final()]);
        if(hash(output)!==comando.esperado.envelopeHash){output.fill(0);fail();}
        return output;
      }finally{k.fill(0);}
    },
  };
}
