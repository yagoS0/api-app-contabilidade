import { criarLeiturasAgenda } from '../leiturasAgenda';

test('compartilha consulta em andamento, reutiliza por 30s e invalida após alteração', async () => {
  let tempo = 0, resolver;
  const cache = criarLeiturasAgenda({agora:()=>tempo});
  const carregar = jest.fn(() => new Promise(r => { resolver=r; }));
  const a=cache.ler('regras',carregar), b=cache.ler('regras',carregar);
  expect(a).toBe(b);
  await Promise.resolve(); resolver({ok:true,regras:[]}); await a;
  expect(await cache.ler('regras',carregar)).toEqual({ok:true,regras:[]});
  expect(carregar).toHaveBeenCalledTimes(1);
  tempo=30001;
  const nova=jest.fn(async()=>({ok:true,regras:['nova']}));
  expect(await cache.ler('regras',nova)).toEqual({ok:true,regras:['nova']});
  cache.limpar(); await cache.ler('regras',nova);
  expect(nova).toHaveBeenCalledTimes(2);
});

test('não guarda falhas e instâncias não compartilham dados privados', async () => {
  const a=criarLeiturasAgenda(), b=criarLeiturasAgenda();
  await expect(a.ler('obs',async()=>({ok:false,message:'Falha'}))).rejects.toThrow('Falha');
  expect(await a.ler('obs',async()=>({ok:true,conta:'a'}))).toEqual({ok:true,conta:'a'});
  expect(await b.ler('obs',async()=>({ok:true,conta:'b'}))).toEqual({ok:true,conta:'b'});
});
