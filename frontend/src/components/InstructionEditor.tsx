import { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Link, RotateCcw } from 'lucide-react';
import { t } from '../lib/i18n';

// Match ILIAS's mini rich-text tag set. Also keep pasted/source HTML inert.
export function instructionMarkup(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,svg,math,template').forEach(node => node.remove());
  for (const node of Array.from(doc.body.querySelectorAll('*'))) {
    let element = node;
    const name = ({ b: 'strong', i: 'em', div: 'p' } as Record<string, string>)[node.localName];
    if (name) {
      element = doc.createElement(name);
      // Chromium can move a previous format into inline styles while removing
      // another format. Read these styles before stripping attributes below.
      for (const attribute of Array.from(node.attributes)) element.setAttribute(attribute.name, attribute.value);
      element.append(...Array.from(node.childNodes));
      node.replaceWith(element);
    }
    if (!['strong', 'em', 'u', 'ol', 'li', 'ul', 'blockquote', 'a', 'p', 'span', 'br'].includes(element.localName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    // TinyMCE also represents underline using a styled span.
    const style = (element as HTMLElement).style;
    const wrappers = [
      /bold|[6-9]00/.test(style.fontWeight) ? 'strong' : '',
      style.fontStyle === 'italic' ? 'em' : '',
      style.textDecoration.includes('underline') ? 'u' : '',
    ].filter(Boolean);
    for (const tag of wrappers) {
      const wrapper = doc.createElement(tag);
      wrapper.append(...Array.from(element.childNodes));
      element.append(wrapper);
    }
    for (const attribute of Array.from(element.attributes)) {
      if (element.localName !== 'a' || !['href', 'target', 'rel', 'title'].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (element.localName === 'a') {
      const href = element.getAttribute('href') || '';
      try {
        if (!['https:', 'http:', 'mailto:'].includes(new URL(href, window.location.href).protocol)) element.removeAttribute('href');
      } catch { element.removeAttribute('href'); }
      if (element.getAttribute('target') === '_blank') element.setAttribute('rel', 'noopener noreferrer');
      else element.removeAttribute('target');
    }
  }
  return doc.body.innerHTML;
}

export function InstructionEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editor = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const selection = useRef<Range | null>(null);
  const [source, setSource] = useState(false);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [target, setTarget] = useState('_self');
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    if (editor.current && instructionMarkup(editor.current.innerHTML) !== instructionMarkup(value)) {
      editor.current.innerHTML = instructionMarkup(value);
    }
  }, [value, source]);

  const updateSelection = () => {
    const current = window.getSelection();
    if (!current?.rangeCount || !editor.current?.contains(current.anchorNode)) return;
    selection.current = current.getRangeAt(0).cloneRange();
    setActive(Object.fromEntries(['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'].map(command =>
      [command, document.queryCommandState(command)])));
  };

  useEffect(() => {
    document.addEventListener('selectionchange', updateSelection);
    return () => document.removeEventListener('selectionchange', updateSelection);
  }, []);

  const restoreSelection = (force = false) => {
    const current = window.getSelection();
    // Replacing even an identical collapsed range discards the browser's pending
    // typing styles. Keep the live caret when toolbar mousedown preserved focus.
    if (!force && document.activeElement === editor.current && current?.rangeCount
      && editor.current?.contains(current.getRangeAt(0).commonAncestorContainer)) return;
    editor.current?.focus();
    if (selection.current && editor.current?.contains(selection.current.commonAncestorContainer)) {
      current?.removeAllRanges();
      current?.addRange(selection.current);
    }
  };
  const sync = () => {
    onChange(instructionMarkup(editor.current?.innerHTML || ''));
    updateSelection();
  };
  const command = (name: string) => {
    restoreSelection();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(name);
    sync();
  };
  const openLink = () => {
    updateSelection();
    const node = selection.current?.startContainer;
    const anchor = (node instanceof Element ? node : node?.parentElement)?.closest('a');
    if (anchor && editor.current?.contains(anchor)) {
      const range = document.createRange();
      range.selectNode(anchor);
      selection.current = range;
    }
    setUrl(anchor?.getAttribute('href') || 'https://');
    setText(anchor?.textContent || selection.current?.toString() || '');
    setTarget(anchor?.getAttribute('target') === '_blank' ? '_blank' : '_self');
    setLinkError('');
    dialog.current?.showModal();
  };
  const insertLink = () => {
    try {
      if (!['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) throw new Error();
    } catch {
      setLinkError(t('editor.link_invalid'));
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.textContent = text || url;
    if (target === '_blank') { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
    dialog.current?.close();
    restoreSelection(true);
    document.execCommand('insertHTML', false, anchor.outerHTML);
    sync();
  };

  const tools = [
    { name: 'bold', label: t('Fett formatieren'), Icon: Bold },
    { name: 'italic', label: t('Kursiv formatieren'), Icon: Italic },
    { name: 'underline', label: t('Unterstrichen formatieren'), Icon: Underline },
    { name: 'insertUnorderedList', label: t('Aufzählung einfügen'), Icon: List },
    { name: 'insertOrderedList', label: t('Nummerierte Liste einfügen'), Icon: ListOrdered },
  ];
  const fieldStyle = 'w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-2 text-slate-900 dark:text-slate-100';
  return <>
    <div role="toolbar" aria-label={t('Arbeitsanweisungen')} className="flex flex-wrap gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1.5">
      {tools.map(({ name, label, Icon }) => <button key={name} type="button" title={label} aria-label={label}
        aria-pressed={!source && !!active[name]} disabled={source} onMouseDown={event => event.preventDefault()} onClick={() => command(name)}
        className={`p-2 rounded-lg disabled:opacity-40 ${!source && active[name] ? 'bg-teal-200 text-teal-950 dark:bg-teal-800 dark:text-teal-50 ring-1 ring-teal-500' : 'text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700'}`}><Icon className="h-4 w-4" /></button>)}
      <button type="button" disabled={source} aria-label={t('Link einfügen')} title={t('Link einfügen')} onMouseDown={event => event.preventDefault()} onClick={openLink} className="p-2 rounded-lg text-slate-700 dark:text-slate-200 disabled:opacity-40"><Link className="h-4 w-4" /></button>
      <button type="button" disabled={source} aria-label={t('Formatierung entfernen')} title={t('Formatierung entfernen')} onMouseDown={event => event.preventDefault()} onClick={() => command('removeFormat')} className="p-2 rounded-lg text-slate-700 dark:text-slate-200 disabled:opacity-40"><RotateCcw className="h-4 w-4" /></button>
      <button type="button" aria-pressed={source} onClick={() => { if (source) onChange(instructionMarkup(value)); setSource(!source); }} className="ml-auto rounded-lg px-3 text-xs font-semibold text-teal-800 dark:text-teal-200">{source ? t('editor.formatted_view') : t('editor.html_view')}</button>
    </div>
    {source ? <textarea aria-label={t('editor.html_source')} value={value} onChange={event => onChange(event.target.value)} className={`${fieldStyle} min-h-48 font-mono text-sm`} /> :
      <div ref={editor} contentEditable suppressContentEditableWarning onInput={sync} onKeyUp={updateSelection} onMouseUp={updateSelection}
        role="textbox" aria-multiline="true" aria-label={t('Arbeitsanweisungen formatierter Text')}
        className="min-h-48 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4 text-sm text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-teal-500 [&_p]:mb-2 [&_strong]:font-bold [&_em]:italic [&_u]:underline [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_a]:underline [&_a]:text-teal-600 dark:[&_a]:text-teal-300" />}
    <dialog ref={dialog} aria-labelledby="instruction-link-title" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); insertLink(); } }}
      className="m-auto w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 text-slate-900 dark:text-slate-100 shadow-xl backdrop:bg-black/50">
      <h3 id="instruction-link-title" className="mb-4 font-bold">{t('Link einfügen')}</h3>
      <div className="space-y-4">
        <label className="block text-sm">{t('editor.link_url')}<input autoFocus className={fieldStyle} value={url} onChange={event => setUrl(event.target.value)} /></label>
        <label className="block text-sm">{t('editor.link_text')}<input className={fieldStyle} value={text} onChange={event => setText(event.target.value)} /></label>
        <label className="block text-sm">{t('editor.link_open')}<select aria-label={t('editor.link_open')} className={fieldStyle} value={target} onChange={event => setTarget(event.target.value)}>
          <option value="_self">{t('editor.link_current')}</option><option value="_blank">{t('editor.link_new')}</option>
        </select></label>
        {linkError && <p role="alert" className="text-rose-600 dark:text-rose-300 text-sm">{linkError}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => { dialog.current?.close(); restoreSelection(); }} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2">{t('Abbrechen')}</button>
          <button type="button" onClick={insertLink} className="rounded-lg bg-teal-700 px-3 py-2 text-white">{t('editor.link_apply')}</button>
        </div>
      </div>
    </dialog>
  </>;
}
