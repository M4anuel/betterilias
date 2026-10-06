from bs4 import BeautifulSoup

def inspect_news(file_path):
    print("=== File:", file_path)
    soup = BeautifulSoup(open(file_path, encoding='utf-8', errors='replace').read(), 'lxml')
    aside = soup.select_one('aside.il_right_col, #il_right_col')
    if not aside:
        print("No right column in", file_path)
        return
    print("Right col heading:", [h.get_text(strip=True) for h in aside.find_all(['h2', 'h3', 'h4'])])
    
    # Check news items
    news_items = aside.select('.il-item, .il-std-item, .il-item-group li, .panel-body')
    print(f"Total items in right col: {len(news_items)}")
    for idx, it in enumerate(news_items[:8]):
        title_el = it.select_one('.il-item-title, h4, h5, .title, a')
        title = title_el.get_text(strip=True) if title_el else ""
        text = it.get_text(' | ', strip=True)
        print(f"[{idx+1}] Title: {title}")
        print(f"     Content: {text[:150]}")
        print("---")

inspect_news('tests/fixtures/unibe/unibe_po_course_content.html')
print("\n" + "="*50 + "\n")
inspect_news('tests/fixtures/unibe/unibe_mms_course_content.html')

