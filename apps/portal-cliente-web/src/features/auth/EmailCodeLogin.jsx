import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { definirSessao, reconhecerExpiracao } from '../../api/sessionStore';
import { LogoAltan } from '../../components/LogoAltan';

export function EmailCodeLogin({ voltar }) {
  const [email,setEmail]=useState(''), [code,setCode]=useState(''), [challenge,setChallenge]=useState(null);
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [until,setUntil]=useState(0), [now,setNow]=useState(Date.now());
  const alive=useRef(true), flight=useRef(false), input=useRef(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(!until)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[until]);
  useEffect(()=>{if(challenge)input.current?.focus();},[challenge]);
  const seconds=Math.max(0,Math.ceil((until-now)/1000));
  function message(err) {
    return err?.code==='too_many_requests'?'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.':err?.code==='invalid_login_code'?'Código inválido ou expirado. Confira o código ou solicite outro.':'Não foi possível concluir. Tente novamente em instantes ou entre com sua senha.';
  }
  async function solicitar(event) {
    event?.preventDefault();if(flight.current||seconds)return;
    flight.current=true;setBusy(true);setError('');
    try { const r=await api.solicitarCodigoAcesso(email.trim());if(!alive.current)return;
      setChallenge(r.challengeId);setCode('');setNow(Date.now());setUntil(Date.now()+(r.resendAfter||60)*1000);
    } catch(err){if(alive.current)setError(message(err));}
    finally {flight.current=false;if(alive.current)setBusy(false);}
  }
  async function confirmar(event) {
    event.preventDefault();if(flight.current)return;
    flight.current=true;setBusy(true);setError('');
    try {const r=await api.confirmarCodigoAcesso(challenge,code);if(!alive.current)return;
      reconhecerExpiracao();definirSessao({accessToken:r.accessToken,refreshToken:r.refreshToken,user:r.user});
    }catch(err){if(alive.current)setError(message(err));}
    finally{flight.current=false;if(alive.current)setBusy(false);}
  }
  return <div className="login-wrap"><form className="login-card" onSubmit={challenge?confirmar:solicitar}>
    <h1 className="login-marca"><LogoAltan altura={40}/></h1>
    <h2>{challenge?'Confira seu e-mail':'Entre sem senha'}</h2>
    <p className="sub">{challenge?`Se ${email} tiver acesso ativo, você receberá um código válido por 10 minutos. Confira também o spam.`:'Use o e-mail do seu acesso cadastrado no escritório. Enviaremos um código para você entrar.'}</p>
    {error&&<div className="alerta alerta-erro" role="alert">{error}</div>}
    {challenge?<label htmlFor="email-login-code">Código de 8 dígitos<input ref={input} id="email-login-code" disabled={busy} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8} pattern="[0-9]{8}" required value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></label>:<label htmlFor="email-login-address">E-mail<input id="email-login-address" disabled={busy} type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required value={email} onChange={e=>setEmail(e.target.value)}/></label>}
    <button className="btn btn-primary btn-block" disabled={busy}>{busy?'Aguarde…':challenge?'Confirmar código e entrar':'Receber código'}</button>
    {challenge&&<><button type="button" className="btn btn-block stack-gap" disabled={busy||seconds>0} onClick={solicitar}>{seconds>0?`Reenviar em ${seconds}s`:'Reenviar código'}</button><button type="button" className="btn btn-block stack-gap" disabled={busy} onClick={()=>{setChallenge(null);setCode('');setError('');setUntil(0);}}>Alterar e-mail</button></>}
    <button type="button" className="btn btn-block stack-gap" disabled={busy} onClick={voltar}>Entrar com senha</button>
    {api.mode==='mock'&&<p className="alerta alerta-info stack-gap">Demonstração: use cliente@exemplo.com e o código 12345678. Nenhum e-mail será enviado.</p>}
  </form></div>;
}
