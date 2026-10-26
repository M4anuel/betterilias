// Shared native object catalogue. Creation is enabled separately from recognition.
export const objectCategories = [
  { id: 'content', types: ['file', 'xds2', 'webr', 'copa', 'glo', 'lm', 'htlm', 'sahs', 'dcl'] },
  { id: 'media', types: ['xoct', 'xvid', 'mep'] },
  { id: 'organization', types: ['fold', 'sess', 'itgr', 'lso'] },
  { id: 'collaboration', types: ['frm', 'blog', 'wiki', 'xpdl', 'grp'] },
  { id: 'assessment', types: ['exc', 'tst', 'qpl', 'prtt'] },
  { id: 'feedback', types: ['poll', 'xlvo', 'svy', 'spl', 'xsev'] },
] as const;
export const supportedCreationTypes: ReadonlySet<string> = new Set(['fold', 'file']);
