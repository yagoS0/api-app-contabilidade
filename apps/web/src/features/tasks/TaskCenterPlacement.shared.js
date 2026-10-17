import { createContext, useContext } from 'react';

export const Placement = createContext(null);

export function useTaskCenterTarget() { return useContext(Placement)?.target; }
