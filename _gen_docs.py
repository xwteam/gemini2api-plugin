"""Generate docs/{zh-CN,zh-TW,en,ja,ko}/README.md from templates."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ZH = (ROOT / "README.md").read_text(encoding="utf-8")

LANG_LINE = {
    "zh-CN": '📖 文档语言：简体中文 | <a href="../zh-TW/README.md">繁體中文</a> | <a href="../en/README.md">English</a> | <a href="../ja/README.md">日本語</a> | <a href="../ko/README.md">한국어</a>',
    "zh-TW": '📖 文檔語言：<a href="../zh-CN/README.md">简体中文</a> | 繁體中文 | <a href="../en/README.md">English</a> | <a href="../ja/README.md">日本語</a> | <a href="../ko/README.md">한국어</a>',
    "en": '📖 Documentation: <a href="../zh-CN/README.md">简体中文</a> | <a href="../zh-TW/README.md">繁體中文</a> | English | <a href="../ja/README.md">日本語</a> | <a href="../ko/README.md">한국어</a>',
    "ja": '📖 ドキュメント：<a href="../zh-CN/README.md">简体中文</a> | <a href="../zh-TW/README.md">繁體中文</a> | <a href="../en/README.md">English</a> | 日本語 | <a href="../ko/README.md">한국어</a>',
    "ko": '📖 문서: <a href="../zh-CN/README.md">简体中文</a> | <a href="../zh-TW/README.md">繁體中文</a> | <a href="../en/README.md">English</a> | <a href="../ja/README.md">日本語</a> | 한국어',
}

def zh_cn_doc():
    t = ZH.replace(
        '📖 文档语言：简体中文 | <a href="docs/zh-TW/README.md">繁體中文</a> | <a href="docs/en/README.md">English</a> | <a href="docs/ja/README.md">日本語</a> | <a href="docs/ko/README.md">한국어</a>',
        LANG_LINE["zh-CN"],
    )
    t = t.replace("](LICENSE)", "](../../LICENSE)")
    return t

# Full translated bodies keyed by locale
BODIES = {}

def write(locale: str, content: str):
    d = ROOT / "docs" / locale
    d.mkdir(parents=True, exist_ok=True)
    (d / "README.md").write_text(content, encoding="utf-8")
    print(f"wrote docs/{locale}/README.md")

write("zh-CN", zh_cn_doc())

# Load external template files if present; else embedded below
for loc, fname in [("zh-TW", "zh-TW.md"), ("en", "en.md"), ("ja", "ja.md"), ("ko", "ko.md")]:
    p = ROOT / "_doc_templates" / fname
    if p.exists():
        body = p.read_text(encoding="utf-8")
        write(loc, body)

print("done")
