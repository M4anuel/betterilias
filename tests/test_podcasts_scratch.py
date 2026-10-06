import re
import urllib.parse
from bs4 import BeautifulSoup

def parse_podcasts(html_path, ref_id):
    soup = BeautifulSoup(open(html_path, encoding='utf-8', errors='replace').read(), 'lxml')
    
    title_elem = soup.select_one('h1.il_Header, h1, .ilTopTitle')
    title = title_elem.get_text(strip=True) if title_elem else f"Podcasts {ref_id}"
    
    # Check pagination buttons
    pages_available = []
    pag = soup.select_one('.il-viewcontrol-pagination, .pagination')
    if pag:
        for b in pag.find_all(['button', 'a']):
            action = b.get('data-action') or b.get('href')
            text = b.get_text(strip=True)
            if action and (text.isdigit() or 'page=' in action):
                pages_available.append(action)
                
    episodes = []
    # Each episode is in section.c-entity__container or .panel-body
    containers = soup.select('section.c-entity__container, .c-entity, .panel-body')
    seen_ids = set()
    
    for c in containers:
        title_el = c.select_one('.c-entity__primary-identifier, h3, h4, .title, a.c-entity__title')
        if not title_el:
            continue
        ep_title = title_el.get_text(strip=True)
        if not ep_title or ep_title in seen_ids or ep_title in ['Content', 'Functions']:
            continue
            
        details_el = c.select_one('.c-entity__main-details')
        details_text = details_el.get_text(' ', strip=True) if details_el else ""
        
        # Date extraction
        date_match = re.search(r'Date\s+([0-9]{1,2}\.\s+[A-Za-z]+\s+[0-9]{4}(?:,\s+[0-9]{2}:[0-9]{2})?)', details_text)
        ep_date = date_match.group(1) if date_match else None
        
        # Presenter extraction
        pres_match = re.search(r'Presenter\s+(.+?)(?:\s+Location|$)', details_text)
        ep_pres = pres_match.group(1).strip() if pres_match else None
        
        # Location extraction
        loc_match = re.search(r'Location\s+(.+)$', details_text)
        ep_loc = loc_match.group(1).strip() if loc_match else None
        
        # Stream link
        stream_elem = c.select_one('a[href*="streamVideo"], a[href*="xoctPlayerGUI"], a[href*="play"]')
        stream_url = stream_elem.get('href') if stream_elem else None
        
        # Status
        status = "available" if stream_url else "scheduled"
        
        # ID / eid
        eid_match = re.search(r'eid=([a-f0-9\-]+)', str(c))
        eid = eid_match.group(1) if eid_match else f"ep-{len(episodes)+1}"
        
        episodes.append({
            'id': eid,
            'title': ep_title,
            'date': ep_date,
            'presenter': ep_pres,
            'location': ep_loc,
            'stream_url': stream_url,
            'status': status
        })
        seen_ids.add(ep_title)
        
    # Sort episodes: Available (recorded) first (newest date first), then scheduled
    available_eps = [e for e in episodes if e['status'] == 'available']
    scheduled_eps = [e for e in episodes if e['status'] == 'scheduled']
    
    sorted_episodes = available_eps + scheduled_eps
    
    print(f"=== {html_path} ===")
    print(f"Title: {title}")
    print(f"Pages available: {len(pages_available)}")
    print(f"Total episodes: {len(sorted_episodes)} (Available: {len(available_eps)}, Scheduled: {len(scheduled_eps)})")
    for e in sorted_episodes[:4]:
        print(f"  [{e['status'].upper()}] {e['title']} ({e['date']}) -> Stream: {bool(e['stream_url'])}")

parse_podcasts('tests/fixtures/unibe/unibe_mms_podcasts.html', '3762352')
print("\n" + "="*40 + "\n")
parse_podcasts('tests/fixtures/unibe/unibe_po_podcasts.html', '3715392')

