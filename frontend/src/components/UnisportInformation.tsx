import { createElement, type ReactNode } from 'react';
import type { UnisportFormatNode } from '../lib/unisportOffers';

const formatting = {
  div: 'my-1.5', p: 'my-1.5', br: '', ul: 'my-1.5 list-disc pl-5', ol: 'my-1.5 list-decimal pl-5',
  li: 'my-0.5', strong: 'font-semibold', em: 'italic', u: 'underline', s: 'line-through', sub: '', sup: '',
};

function renderNode(node: UnisportFormatNode, key: number): ReactNode {
  if (typeof node === 'string') return node;
  // The API returns structure only. Render fixed elements and text even if
  // an older snapshot or unexpected response contains an unknown node.
  if (!node || !Object.hasOwn(formatting, node.kind) || !Array.isArray(node.children)) return null;
  const tag = node.kind as keyof typeof formatting;
  const props = { key, className: formatting[tag] };
  return tag === 'br' ? createElement(tag, props) : createElement(tag, props, node.children.map(renderNode));
}

export function UnisportInformation({ content, format }: { content: string; format?: UnisportFormatNode[] }) {
  const width = 'mt-1 max-w-[60ch] text-sm [overflow-wrap:anywhere]';
  return Array.isArray(format) && format.length
    ? <div className={width}>{format.map(renderNode)}</div>
    : <p className={`${width} whitespace-pre-wrap`}>{content}</p>;
}
