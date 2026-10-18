import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState, useId } from 'react';

export function MenuTarefaCalendario({item,onDuplicar,onExcluir,disabled=false}) {
  const [aberto,setAberto]=useState(false),[posicao,setPosicao]=useState({top:0,left:0});
  const gatilho=useRef(null),menu=useRef(null),menuId=useId();
  const fechar=()=>{setAberto(false);gatilho.current?.focus({preventScroll:true});};
  useLayoutEffect(()=>{
    if(!aberto)return;
    const posicionar=()=>{
      const r=gatilho.current?.getBoundingClientRect(),m=menu.current?.getBoundingClientRect();
      if(!r||!m)return;
      setPosicao({left:Math.max(8,Math.min(r.right-m.width,window.innerWidth-m.width-8)),top:Math.max(8,r.bottom+m.height+8>window.innerHeight?r.top-m.height-4:r.bottom+4)});
    };
    posicionar();menu.current?.querySelector('button')?.focus({preventScroll:true});
    window.addEventListener('resize',posicionar);window.addEventListener('scroll',posicionar,true);
    return()=>{window.removeEventListener('resize',posicionar);window.removeEventListener('scroll',posicionar,true);};
  },[aberto]);
  useEffect(()=>{
    if(!aberto)return;
    const fora=e=>{if(!gatilho.current?.contains(e.target)&&!menu.current?.contains(e.target))setAberto(false);};
    document.addEventListener('pointerdown',fora);document.addEventListener('focusin',fora);
    return()=>{document.removeEventListener('pointerdown',fora);document.removeEventListener('focusin',fora);};
  },[aberto]);
  useEffect(()=>{if(disabled)setAberto(false);},[disabled]);
  return <span className="agenda-task-menu" onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}
    onKeyDown={e=>{
      e.stopPropagation();
      if(e.key==='Escape'){e.preventDefault();fechar();}
      else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
        e.preventDefault();if(!aberto){setAberto(true);return;}
        const botoes=[...menu.current.querySelectorAll('button')],atual=botoes.indexOf(document.activeElement);
        const proximo=e.key==='Home'?0:e.key==='End'?botoes.length-1:(atual+(e.key==='ArrowDown'?1:-1)+botoes.length)%botoes.length;
        botoes[proximo]?.focus();
      }else if(e.key==='Tab'&&aberto){setAberto(false);gatilho.current?.focus({preventScroll:true});}
    }}>
    <button ref={gatilho} type="button" aria-label={`Ações de ${item.titulo}`} aria-expanded={aberto} aria-haspopup="menu" aria-controls={aberto?menuId:undefined}
      disabled={disabled} onClick={()=>setAberto(v=>!v)}>⋯</button>
    {aberto&&createPortal(<span ref={menu} id={menuId} role="menu" aria-label={`Ações de ${item.titulo}`} className="agenda-task-menu-options" style={posicao}>
      <button type="button" role="menuitem" tabIndex={-1} onClick={()=>{fechar();onDuplicar(item);}}>Duplicar ocorrência</button>
      <button type="button" role="menuitem" tabIndex={-1} onClick={()=>{fechar();onExcluir(item);}}>Excluir ocorrência</button>
    </span>,document.body)}
  </span>;
}
