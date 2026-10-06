from bs4 import BeautifulSoup

def inspect_c_entity(file_path):
    print("=== File:", file_path)
    soup = BeautifulSoup(open(file_path, encoding='utf-8', errors='replace').read(), 'lxml')
    details_list = soup.select('.c-entity__main-details')
    print(f"Number of episodes: {len(details_list)}")
    
    for idx, d in enumerate(details_list[:12]):
        parent = d.find_parent(class_=lambda c: c and ('c-entity' in c or 'panel' in c or 'card' in c or 'item' in c)) or d.parent
        title = None
        for cand in parent.find_all(['h2', 'h3', 'h4', 'h5', 'a']):
            cand_text = cand.get_text(strip=True)
            if cand_text and not any(cand_text.startswith(w) for w in ['Set', 'Delete', 'Edit', 'Report', 'Date', '1', '2', '10', '20', '50']):
                title = cand_text
                break
        details_txt = d.get_text(' ', strip=True)
        stream_elem = parent.select_one('a[href*="streamVideo"], a[href*="play"], a[href*="player"]')
        stream_link = stream_elem.get('href') if stream_elem else None
        
        is_streamable = bool(stream_link)
        print(f"[{idx+1}] {title} | {details_txt} | Stream: {bool(stream_link)}")

inspect_c_entity('tests/fixtures/unibe/unibe_mms_podcasts.html')
print("\n" + "="*50 + "\n")
inspect_c_entity('tests/fixtures/unibe/unibe_po_podcasts.html')

