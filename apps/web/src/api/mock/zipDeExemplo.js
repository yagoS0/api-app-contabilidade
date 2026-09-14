// ZIP sem compressão para o preview offline. Os arquivos são exemplos, nunca fiscais.
export function zipDeExemplo(arquivos) {
  const enc = new TextEncoder(), partes = [], central = [];
  let offset = 0;
  const crc32 = bytes => { let c = -1; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ -1) >>> 0; };
  for (const [nome, texto] of arquivos) {
    const name = enc.encode(nome), data = enc.encode(texto), crc = crc32(data);
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
    l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
    const cd = new Uint8Array(46 + name.length), c = new DataView(cd.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); cd.set(name, 46);
    partes.push(local, data); central.push(cd); offset += local.length + data.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, arquivos.length, true); e.setUint16(10, arquivos.length, true);
  e.setUint32(12, central.reduce((s, c) => s + c.length, 0), true); e.setUint32(16, offset, true);
  return new Blob([...partes, ...central, end], { type: "application/zip" });
}
