import re
from bs4 import BeautifulSoup

def parse_news_logs(html_path):
    soup = BeautifulSoup(open(html_path, encoding='utf-8', errors='replace').read(), 'lxml')
    aside = soup.select_one('aside.il_right_col, #il_right_col')
    if not aside:
        print("No right column in", html_path)
        return []
        
    logs = []
    seen = set()
    
    # In Uni Bern ILIAS, news items are inside .il-item or .il-std-item or li
    for el in aside.select('.il-item, .il-std-item, li'):
        title_el = el.select_one('.il-item-title, h4, h5, a')
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        if not title or title in ['News', 'Calendar']:
            continue
            
        full_text = el.get_text(' ', strip=True)
        
        # Target (e.g. File: ..., Forum: ...)
        target = None
        target_match = re.search(r'(File|Forum|Exercise|Course|Date):\s*([^\|]+)', full_text, re.I)
        if target_match:
            target = target_match.group(0).strip()
            
        # Date (e.g. Today, 09:25 or 30. Sep 2026, 18:34)
        date_str = None
        date_match = re.search(r'(Today|Yesterday|[0-9]{1,2}\.\s+[A-Za-z]+(?:\s+[0-9]{4})?),\s*[0-9]{2}:[0-9]{2}', full_text)
        if date_match:
            date_str = date_match.group(0).strip()
            
        link_el = el.find('a', href=True)
        url = link_el.get('href') if link_el else None
        
        # Deduplication key
        key = f"{title}_{target}_{date_str}"
        if key in seen:
            continue
        seen.add(key)
        
        log_type = "file" if "file" in full_text.lower() else "forum" if "forum" in full_text.lower() else "general"
        
        logs.append({
            'title': title,
            'target': target,
            'date': date_str,
            'url': url,
            'log_type': log_type
        })
        
    print(f"=== Logs for {html_path} ===")
    print(f"Total unique logs: {len(logs)}")
    for l in logs[:5]:
        print(f"  [{l['log_type'].upper()}] {l['title']} | {l['target']} | {l['date']}")
    return logs

parse_news_logs('tests/fixtures/unibe/unibe_po_course_content.html')
print("\n" + "="*40 + "\n")
parse_news_logs('tests/fixtures/unibe/unibe_mms_course_content.html')

