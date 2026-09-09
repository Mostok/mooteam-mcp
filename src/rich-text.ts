import { array, id, record, string, type RecordData, type RichText } from './types.js';
import { isSensitiveQueryKey } from './redaction.js';

export function safeLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) return null;
    for (const key of [...url.searchParams.keys()]) if (isSensitiveQueryKey(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}

export function renderRichText(value: unknown): RichText {
  const out: RichText = { markdown: '', links: [], inlineFileIds: [], mentions: [], warnings: [] };
  const source = record(value);
  if (value === null || value === undefined) return out;
  if (typeof value === 'string') { out.markdown = value; return out; }
  if (Array.isArray(source.blocks)) out.markdown = renderDraft(source, out);
  else if (Array.isArray(source.children) || Array.isArray(source.content) || source.type || Array.isArray(value)) out.markdown = renderTree(value, out, 0);
  else out.warnings.push('Unsupported rich-text structure; text may be missing.');
  out.markdown = out.markdown.trim();
  out.inlineFileIds = [...new Set(out.inlineFileIds)];
  out.warnings = [...new Set(out.warnings)];
  out.links = out.links.filter((link, index, all) => all.findIndex(other => other.url === link.url && other.text === link.text) === index);
  return out;
}

function renderDraft(source: RecordData, out: RichText): string {
  const entities = source.entityMap as Record<string, unknown> | undefined;
  return array(source.blocks).map(raw => {
    const block = record(raw);
    const text = string(block.text);
    const ranges = validRanges(block.entityRanges, text.length, out);
    const styles = validRanges(block.inlineStyleRanges, text.length, out);
    const boundaries = [...new Set([0, text.length, ...[...ranges, ...styles].flatMap(r => [Number(r.offset), Number(r.offset) + Number(r.length)])])].sort((a, b) => a - b);
    let result = '';
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i]!, end = boundaries[i + 1]!;
      const entity = ranges.find(r => Number(r.offset) <= start && Number(r.offset) + Number(r.length) >= end);
      let segment = text.slice(start, end);
      if (entity) segment = renderEntity(record(entities?.[String(entity.key)]), segment, out);
      for (const style of styles.filter(r => Number(r.offset) <= start && Number(r.offset) + Number(r.length) >= end)) segment = applyStyle(segment, string(style.style).toLowerCase(), out);
      result += segment;
    }
    const prefix: Record<string, string> = { 'header-one': '# ', 'header-two': '## ', 'header-three': '### ', 'unordered-list-item': '- ', 'ordered-list-item': '1. ', blockquote: '> ' };
    if (block.type === 'code-block') return '```\n' + result.replace(/```/g, '` ` `') + '\n```';
    if (block.type && !['unstyled', 'atomic', 'paragraph', 'header-one', 'header-two', 'header-three', 'unordered-list-item', 'ordered-list-item', 'blockquote'].includes(string(block.type))) out.warnings.push(`Unsupported block formatting: ${string(block.type)}.`);
    return (prefix[string(block.type)] || '') + result;
  }).join('\n\n');
}

function validRanges(value: unknown, textLength: number, out: RichText): RecordData[] {
  return array(value).map(record).filter(r => {
    const start = Number(r.offset), length = Number(r.length);
    const valid = Number.isInteger(start) && Number.isInteger(length) && start >= 0 && length > 0 && start + length <= textLength;
    if (!valid) out.warnings.push('Invalid rich-text range was skipped.');
    return valid;
  });
}

function applyStyle(text: string, style: string, out: RichText): string {
  if (['strikethrough', 'strike', 's'].includes(style)) return `~~${text}~~`;
  if (style === 'bold' || style === 'strong') return `**${text}**`;
  if (style === 'italic' || style === 'em') return `_${text}_`;
  if (style === 'code') return '`' + text + '`';
  if (style === 'underline') return `<u>${text}</u>`;
  out.warnings.push(`Unsupported text formatting: ${style}.`);
  return text;
}

function renderEntity(entity: RecordData, text: string, out: RichText): string {
  const data = record(entity.data);
  const type = string(entity.type).toLowerCase();
  if (type === 'image' || type === 'file' || type === 'attachment') return fileReference(data, text, out);
  if (['link', 'hyperlink'].includes(type)) return linkReference(data.url ?? data.href, text, out);
  if (type === 'mention') {
    const mention = record(data.mention);
    const label = text || string(data.name ?? mention.name);
    out.mentions.push({ userId: id(data.userId ?? data.id ?? mention.id ?? mention.userId), text: label });
    return label;
  }
  if (type) out.warnings.push(`Unsupported rich-text entity: ${type}.`);
  return text;
}

function fileReference(data: RecordData, text: string, out: RichText): string {
  const fileId = id(data.fileId ?? record(data.file).fileId ?? data.id);
  const name = string(data.name ?? data.alt) || text.trim() || 'attachment';
  if (fileId) { out.inlineFileIds.push(fileId); return `[${name}](mooteam://files/${fileId})`; }
  const url = safeLink(data.src ?? data.url);
  const fromUrl = url ? /\/api\/files\/(\d+)/.exec(url)?.[1] : undefined;
  if (fromUrl) { const n = Number(fromUrl); out.inlineFileIds.push(n); return `[${name}](mooteam://files/${n})`; }
  out.warnings.push('Inline file has no resolvable Moo.team file ID.');
  return url ? linkReference(url, name, out) : `[${name}: unresolved attachment]`;
}

function linkReference(rawUrl: unknown, label: string, out: RichText): string {
  const url = safeLink(rawUrl);
  if (!url) { out.warnings.push('An invalid or unsupported link was omitted.'); return label; }
  out.links.push({ url, text: label });
  return `[${label || url}](<${url.replace(/>/g, '%3E')}>)`;
}

function renderTree(value: unknown, out: RichText, depth: number): string {
  if (depth > 50) { out.warnings.push('Rich-text nesting limit reached.'); return ''; }
  if (Array.isArray(value)) return value.map(v => renderTree(v, out, depth + 1)).join('');
  if (typeof value === 'string') return value;
  const node = record(value);
  const attrs = { ...node, ...record(node.attrs), ...record(node.data) };
  const type = string(node.type).toLowerCase();
  if (['image', 'file', 'attachment'].includes(type)) return fileReference(attrs, '', out);
  let content = string(node.text) + renderTreeChildren(node, out, depth);
  if (['link', 'hyperlink', 'a'].includes(type)) content = linkReference(attrs.url ?? attrs.href, content, out);
  if (type === 'mention') { out.mentions.push({ userId: id(attrs.userId ?? attrs.id), text: content || string(attrs.label) }); content ||= '@' + string(attrs.label ?? attrs.name); }
  for (const mark of array(node.marks).map(record)) {
    if (mark.type === 'link') content = linkReference(record(mark.attrs).href, content, out);
    else content = applyStyle(content, string(mark.type).toLowerCase(), out);
  }
  for (const style of ['bold', 'italic', 'strikethrough', 'underline', 'code']) if (node[style] === true) content = applyStyle(content, style, out);
  if (['hardbreak', 'hard_break', 'br'].includes(type)) return '\n';
  if (['tablecell', 'table-cell', 'tableheader', 'td', 'th'].includes(type)) return content.trim().replace(/\n+/g, ' ') + '\t';
  if (['tablerow', 'table-row', 'tr'].includes(type)) return content.trimEnd() + '\n';
  if (type === 'table') return '```\n' + content.trim() + '\n```\n';
  if (['paragraph', 'p', 'heading', 'blockquote', 'listitem', 'list-item'].includes(type)) return content + '\n\n';
  if (['codeblock', 'code-block'].includes(type)) return '```\n' + content + '\n```\n';
  if (type && !['doc', 'document', 'root', 'text', 'link', 'hyperlink', 'a', 'mention', 'bulletlist', 'orderedlist', 'ul', 'ol'].includes(type)) out.warnings.push(`Unsupported structural node: ${type}.`);
  return content;
}

function renderTreeChildren(node: RecordData, out: RichText, depth: number): string {
  const children = node.children ?? node.content;
  if (!Array.isArray(children)) return '';
  return children.map(child => renderTree(child, out, depth + 1)).join('');
}

export function preferredRichText(primary: unknown, fallback: unknown): RichText {
  const rendered = renderRichText(primary);
  if (rendered.markdown || rendered.inlineFileIds.length) return rendered;
  const alternative = renderRichText(fallback);
  return alternative.markdown || alternative.inlineFileIds.length ? alternative : rendered;
}
