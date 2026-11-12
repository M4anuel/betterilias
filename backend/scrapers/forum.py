"""Forum parsing based on native ILIAS 9 markup; never expose native write targets."""
from dataclasses import dataclass, field
import re
from urllib.parse import parse_qs, urlencode, urljoin, urlparse, urlunparse

from bs4 import BeautifulSoup, Comment

from backend.config import settings
from backend.i18n import t
from backend.forum_models import ForumOverview, ForumThread, ForumConversation, ForumPost, ForumAttachment
from backend.outbound_targets import TargetPolicy, OutboundTargetRejected
from backend.scrapers.authoring import native_url
from backend.scrapers.dumper import safe_parser


def query(url):
    return {k.lower(): v[-1] for k, v in parse_qs(urlparse(url).query).items()}


def resource(raw, ref_id):
    if not raw or '_files/' in raw or raw.startswith('data:'):
        return None  # Saved-browser assets and generated initials are not live profile photos.
    try:
        target = TargetPolicy().resource_url(raw)
    except OutboundTargetRejected:
        return None
    return '/api/materials/' + ref_id + '/download?' + urlencode({'custom_url': target})


@safe_parser('forum_markup')
def clean_markup(html, ref_id):
    soup = BeautifulSoup(html, 'lxml')
    for node in soup.select('script,style,iframe,object,embed,svg,math,template,form,input,button,select,textarea,dialog,.il-copg-mob-fullscreen-modal'):
        node.decompose()
    allowed = {'p','br','strong','em','b','i','u','s','a','ul','ol','li','blockquote','pre','code',
               'h2','h3','h4','h5','h6','table','thead','tbody','tr','th','td','img','hr','div','span','details','summary'}
    for node in list(soup.body.find_all(True)):
        if node.name not in allowed:
            node.unwrap(); continue
        attributes = dict(node.attrs); node.attrs = {}
        if node.name == 'a':
            href = urljoin(settings.ilias_base_url + '/', attributes.get('href', ''))
            if urlparse(href).scheme in ('https', 'http', 'mailto'):
                node['href'] = resource(href, ref_id) or href
                node['target'] = '_blank'; node['rel'] = 'noopener noreferrer'
        elif node.name == 'img':
            src = resource(attributes.get('src'), ref_id)
            if not src:
                node.decompose(); continue
            node['src'] = src; node['alt'] = attributes.get('alt', ''); node['loading'] = 'lazy'
        elif node.name in ('td','th'):
            for key in ('colspan','rowspan'):
                if str(attributes.get(key, '')).isdigit(): node[key] = attributes[key]
        classes=[value for value in attributes.get('class',[]) if re.fullmatch(r'ilc_[A-Za-z0-9_-]+',value)]
        if classes: node['class']=classes
    return str(soup.body.decode_contents())


@dataclass
class ParsedOverview:
    data: ForumOverview
    create_url: str | None = None
    thread_urls: dict[str, str] = field(default_factory=dict)
    actions: dict[str, dict[str, str]] = field(default_factory=dict)
    pages: dict[int, str] = field(default_factory=dict)


def links(soup, ref_id):
    for node in soup.select('a[href],button[data-action]'):
        if node.has_attr('disabled') or node.get('aria-disabled') == 'true': continue
        raw = node.get('href') or node.get('data-action')
        try: url = native_url(raw, ref_id)
        except ValueError: continue
        yield node, url, query(url)


@safe_parser('forum_overview')
def parse_forum_overview(html, ref_id):
    soup = BeautifulSoup(html, 'lxml')
    if not soup.select_one('#tab_forums_threads'):
        raise ValueError(t('forum.load_failed'))
    heading = soup.select_one('h1.ilHeader, h1.il-page-content-header')
    data = ForumOverview(ref_id=ref_id, title=heading.get_text(' ',strip=True) if heading else '')
    parsed = ParsedOverview(data)
    for node, url, params in links(soup, ref_id):
        cmd = params.get('cmd','').lower()
        if cmd == 'createthread': parsed.create_url = url; data.can_create = True
        if params.get('cmdclass','').lower() == 'ilforumpagegui' and cmd == 'edit':
            parts = urlparse(url)
            data.editor_url = urlunparse(parts._replace(query=urlencode({k:v for k,v in parse_qs(parts.query).items() if k.lower() != 'rtoken'}, doseq=True)))
            data.can_edit_page = True
        if cmd == 'viewthread' and node.find_parent(class_='il-item-title'):
            tid = params.get('thr_pk','')
            if not tid.isdecimal() or tid in parsed.thread_urls: continue
            item = node.find_parent(class_='il-item') or node.parent
            actions = {p.get('cmd','').lower(): u for _,u,p in links(item, ref_id) if p.get('thr_pk') == tid}
            if 'make_topics_non_sticky' in actions:
                actions['unmakesticky'] = actions['make_topics_non_sticky']
            properties = {}
            for name in item.select('.il-item-property-name'):
                value = name.find_next_sibling(class_='il-item-property-value')
                if value: properties[name.get_text(' ',strip=True).lower()] = value.get_text(' ',strip=True)
            title = node.get_text(' ',strip=True)
            closed = 'reopen' in actions or bool(re.search(r'\((closed|geschlossen)\)',title,re.I))
            sticky = ('unmakesticky' in actions or 'makestickynot' in actions or
                      properties.get('relevance', properties.get('relevanz', '')).casefold() in ('sticky', 'angeheftet', 'angepinnt'))
            title = re.sub(r'\s*\((closed|geschlossen)\)\s*$', '', title, flags=re.I)
            count = properties.get('posts', properties.get('beiträge','0'))
            number=re.match(r'\s*([\d.,]+)',count)
            visits = properties.get('visits', properties.get('aufrufe', properties.get('besuche', '')))
            visit_number = re.match(r'\s*([\d.,\u2019\' ]+)', visits)
            data.threads.append(ForumThread(id=tid,title=title,author=properties.get('created by',properties.get('erstellt von','')),
                last_post=properties.get('latest post',properties.get('letzter beitrag','')),post_count=int(re.sub(r'\D','',number[1]) or '0') if number else 0,
                view_count=int(re.sub(r'\D','',visit_number[1])) if visit_number and re.search(r'\d',visit_number[1]) else None,
                closed=closed,sticky=sticky,unread=bool(item.select_one('.il-item-notification, [class*=unread]') or re.search(r'\b(new|neu|ungelesen|unread)\b',count,re.I)),
                actions=[c for c in ('close','reopen','makesticky','unmakesticky') if c in actions] + (['delete'] if 'confirmdeletethreads' in actions else [])))
            parsed.thread_urls[tid] = url; parsed.actions[tid] = actions
        if cmd == 'showthreads' and params.get('page','').isdigit(): parsed.pages[int(params['page'])] = url
    intro = soup.select_one('#il_center_col .ilc_page_Page, #il_center_col .ilCOPageSection')
    if intro: data.intro_html = clean_markup(str(intro), ref_id)
    else:
        marker = soup.find(string=lambda value:isinstance(value,Comment) and 'COPage-PageTop' in value)
        if marker:
            content = []
            for node in marker.next_siblings:
                if getattr(node,'name',None) and 'il-panel-listing-std-container' in node.get('class',[]): break
                content.append(str(node))
            markup=''.join(content)
            data.intro_html = clean_markup(markup,ref_id) if markup.strip() else ''
    if not BeautifulSoup(data.intro_html,'lxml').get_text(strip=True) and not BeautifulSoup(data.intro_html,'lxml').select_one('img,table,hr'):
        data.intro_html = ''
    data.has_more = any(page > data.page for page in parsed.pages)
    return parsed


@dataclass
class ParsedConversation:
    data: ForumConversation
    reply_urls: dict[str, str] = field(default_factory=dict)
    edit_urls: dict[str, str] = field(default_factory=dict)
    avatars: dict[str, str] = field(default_factory=dict)
    pages: dict[int, str] = field(default_factory=dict)


@safe_parser('forum_conversation')
def parse_forum_conversation(html, ref_id, thread_id):
    soup = BeautifulSoup(html, 'lxml')
    listing = soup.select_one('#ilFrmPostList')
    if listing is None: raise ValueError(t('forum.load_failed'))
    heading = soup.select_one('h1.ilHeader, h1.il-page-content-header')
    title = heading.get_text(' ',strip=True) if heading else ''
    title = re.sub(r'^(?:Thread|Thema)\s*["„]?(.*?)["“]?$', r'\1',title)
    parsed = ParsedConversation(ForumConversation(ref_id=ref_id,thread_id=thread_id,title=title))
    for row in listing.select('.ilFrmPostRow'):
        anchor = next((a for a in row.select('a[id]') if a['id'].isdecimal()),None)
        if not anchor: continue
        pid = anchor['id']; header = row.select_one('.ilFrmPostHeader .small'); content = row.select_one('.ilFrmPostContent')
        for _,url,params in links(row,ref_id):
            if params.get('thr_pk') != thread_id or params.get('pos_pk') != pid: continue
            if params.get('action') == 'showreply': parsed.reply_urls[pid] = url
            if params.get('action') == 'showedit': parsed.edit_urls[pid] = url
        if header:
            clone = BeautifulSoup(str(header),'lxml')
            for icon in clone.select('.ilFrmTargetImage'): icon.decompose()
            header_text = clone.get_text(' ',strip=True)
        else: header_text = ''
        parts = [p.strip() for p in header_text.split('|')]
        author = parts[0] if parts else ''
        date = ' | '.join(parts[2:]) if len(parts)>2 else ''
        edited_parts = re.split(r'Edited on:|Bearbeitet am:',date,maxsplit=1)
        image = row.select_one('.ilFrmPostImage img')
        avatar = resource(image.get('src'),ref_id) if image else None
        subject = row.select_one('.ilFrmPostTitle')
        level = re.search(r'ilFrmPost-level-(\d+)', ' '.join(row.get('class',[])))
        attachments=[]
        for link in row.select('.ilFrmPostAttachmentsContainer a[href]'):
            download=resource(link['href'],ref_id)
            if download: attachments.append(ForumAttachment(title=link.get('title') or link.get_text(' ',strip=True),url=download))
        parsed.data.posts.append(ForumPost(id=pid,subject=subject.get_text(' ',strip=True) if subject else '',author=author,
            date=edited_parts[0].strip(),edited=edited_parts[1].strip() if len(edited_parts)>1 else '',
            html=clean_markup(str(content or ''),ref_id),avatar_url=avatar,depth=int(level[1]) if level else 1,
            can_reply=pid in parsed.reply_urls,can_edit=pid in parsed.edit_urls,attachments=attachments))
    for _,url,params in links(soup,ref_id):
        if params.get('cmd','').lower()=='viewthread' and params.get('thr_pk')==thread_id and params.get('page','').isdigit() and not params.get('action') and not params.get('pos_pk'):
            parsed.pages[int(params['page'])] = url
    return parsed


@dataclass
class ForumForm:
    action: str
    values: dict[str,str]
    command: str
    file_fields: list[str]


@safe_parser('forum_post_form')
def parse_forum_form(html, ref_id, thread_id=None, editing=False):
    soup = BeautifulSoup(html,'lxml')
    expected = ['updatePost','savePost'] if editing else ['savePost'] if thread_id else ['addThread']
    form = next((f for f in soup.select('form[action]') if f.select_one('textarea[name="message"]') and
                 any(i.get('name','').lower() in [f'cmd[{cmd}]'.lower() for cmd in expected] for i in f.select('input[name],button[name]'))),None)
    if not form: raise ValueError(t('forum.form_rejected'))
    action = native_url(form['action'],ref_id)
    params = query(action)
    if params.get('cmdclass','').lower()!='ilobjforumgui' or (thread_id and params.get('thr_pk')!=thread_id):
        raise ValueError(t('forum.not_allowed'))
    values = {i['name']:i.get('value','') for i in form.select('input[type=hidden][name]')}
    subject = form.select_one('[name=subject]'); message = form.select_one('textarea[name=message]')
    values['subject'] = subject.get('value','') if subject else ''
    values['message'] = message.get_text() if message else ''
    command = next(i['name'] for i in form.select('[name]') if i['name'].lower() in [f'cmd[{cmd}]'.lower() for cmd in expected])
    values[command] = 'Save'
    return ForumForm(action,values,command,[i['name'] for i in form.select('input[type=file][name]')])
