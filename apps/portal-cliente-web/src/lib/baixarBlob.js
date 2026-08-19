// Entrega um Blob ao usuário como arquivo.
//
// ⚠ POR QUE ISTO EXISTE E NÃO É UM `<a href>`: as rotas que servem arquivo neste app são
// AUTENTICADAS, e um link comum não leva o Bearer. O arquivo vem por `fetch` com o token e é
// entregue por um link temporário (`blob:`), que não passa pela rede.
//
// ⚠ O `revoke` É ADIADO. Revogar no mesmo tick corta o download em alguns navegadores antes de ele
// começar — mesmo cuidado do portal do escritório.
export function baixarBlob(blob, nomeArquivo) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
