import { Placement } from './TaskCenterPlacement.shared.js';
import { useContext, useMemo, useState } from 'react';


// O executor e o histórico continuam no App; só o controle visual entra na navegação.
export function TaskCenterPlacement({ children }) {
  const [target, setTarget] = useState(null);
  const value = useMemo(() => ({ target, setTarget }), [target]);
  return <Placement.Provider value={value}>{children}</Placement.Provider>;
}

export function TaskCenterSlot() {
  const placement = useContext(Placement);
  return placement ? <span className="task-center-slot" ref={placement.setTarget} /> : null;
}
