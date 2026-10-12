import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';

const bloqueios = new BlockList();
for (const [ip, prefixo] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) bloqueios.addSubnet(ip, prefixo, 'ipv4');
// IPv6 aceita apenas unicast global 2000::/3 e exclui tradução/túneis/documentação.
const globais = new BlockList(); globais.addSubnet('2000::', 3, 'ipv6');
for (const [ip,prefixo] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) bloqueios.addSubnet(ip,prefixo,'ipv6');
export function enderecoPublicoCbs(ip) {
  const familia = isIP(ip);
  return familia === 4 ? !bloqueios.check(ip, 'ipv4') : familia === 6 && globais.check(ip, 'ipv6') && !bloqueios.check(ip, 'ipv6');
}
const erro = () => Object.assign(new Error('Download CBS indisponível.'), { code: 'CBS_DOWNLOAD_TRANSPORTE' });

// Dependências injetáveis somente pelo servidor/teste, nunca parâmetros HTTP do usuário.
export function criarTransporteDownloadCbs({ lookup = dnsLookup, request = httpsRequest } = {}) {
  return async function baixar(url, { signal } = {}) {
    let alvo;
    try { alvo = new URL(url); } catch { throw erro(); }
    if (alvo.protocol !== 'https:' || alvo.username || alvo.password || alvo.hash || (alvo.port && alvo.port !== '443') || isIP(alvo.hostname) || alvo.hostname.startsWith('[')) throw erro();
    if (signal?.aborted) throw erro();
    let resolvidos, abortar;
    try { resolvidos = await Promise.race([lookup(alvo.hostname, { all: true, verbatim: true }), new Promise((_, reject) => { if (signal) { abortar = () => reject(erro()); signal.addEventListener('abort', abortar, { once: true }); if (signal.aborted) abortar(); } })]); } catch { throw erro(); }
    finally { if (abortar) signal.removeEventListener('abort', abortar); }
    if (signal?.aborted || !Array.isArray(resolvidos) || !resolvidos.length || resolvidos.some(r => !enderecoPublicoCbs(r.address) || r.family !== isIP(r.address))) throw erro();
    const fixado = resolvidos[0];
    return new Promise((resolve, reject) => {
      let req;
      const falhar = () => reject(erro());
      try {
        req = request(alvo, { method: 'GET', agent: false, signal, servername: alvo.hostname, rejectUnauthorized: true,
          // Não encaminhar Authorization nem qualquer header fornecido pelo chamador.
          headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' },
          lookup: (_host, options, callback) => options?.all ? callback(null, [fixado]) : callback(null, fixado.address, fixado.family) }, res => {
          // A conexão usa exclusivamente o endereço fixado; nenhuma segunda consulta DNS.
          if (res.statusCode !== 200 || !res.socket?.encrypted || !res.socket?.authorized || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) { res.destroy(); falhar(); return; }
          try { resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: Object.fromEntries(Object.entries(res.headers).filter(([,v]) => v !== undefined).map(([k,v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])) })); }
          catch { res.destroy(); falhar(); }
        });
        req.on('error', falhar); req.end();
      } catch { req?.destroy(); falhar(); }
    });
  };
}
