import { createContext, useContext } from 'react';

export const WorkspaceWidth = createContext(window.innerWidth);
export const useCompactWorkspace = () => useContext(WorkspaceWidth) < 768;
