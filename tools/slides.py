#!/usr/bin/env python3
"""Turn a slide deck PDF into the page images and manifest the slides viewer plays.

    nix run "path:$PWD#slides" -- deck.pdf static/slides/<id> [--rev <source revision>]

Writes <out>/p001.webp ... <out>/manifest.json and copies the PDF next to them.
Per page the manifest keeps the /Dur entry of the PDF (seconds the page stays up
before the next one, which is what pdfpc auto-advances on) and the page text, used as
the image's alt text. It reads the PDF as data: it does not check the deck's content
or that a timed run looks right. Poppler rasterises the pages, so fonts or effects it
renders differently from your PDF reader differ in the pictures too.
"""
import argparse, hashlib, json, pathlib, shutil, subprocess, tempfile
import pypdf


def tool_version(*cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    return (p.stdout + p.stderr).strip().splitlines()[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=pathlib.Path)
    ap.add_argument("out", type=pathlib.Path)
    ap.add_argument("--width", type=int, default=1600, help="pixel width of each page image")
    ap.add_argument("--quality", type=int, default=82, help="WebP quality")
    ap.add_argument("--rev", default="", help="revision of the deck's source repository, recorded as is")
    a = ap.parse_args()

    reader = pypdf.PdfReader(a.pdf)
    n = len(reader.pages)
    box = reader.pages[0].mediabox
    ratio = float(box.height) / float(box.width)
    height = round(a.width * ratio)
    a.out.mkdir(parents=True, exist_ok=True)
    for old in a.out.glob("p*.webp"):
        old.unlink()

    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-scale-to-x", str(a.width), "-scale-to-y", str(height), "-png",
                        str(a.pdf), f"{tmp}/p"], check=True)
        pages = []
        for i, page in enumerate(reader.pages, 1):
            png = next(pathlib.Path(tmp).glob(f"p-*{i:0{len(str(n))}d}.png"))
            name = f"p{i:03d}.webp"
            subprocess.run(["cwebp", "-quiet", "-q", str(a.quality), str(png), "-o", str(a.out / name)], check=True)
            text = subprocess.run(["pdftotext", "-f", str(i), "-l", str(i), str(a.pdf), "-"],
                                  capture_output=True, text=True, check=True).stdout
            dur = page.get("/Dur")
            pages.append({"img": name, "dur": None if dur is None else round(float(dur), 3),
                          "text": " ".join(text.split())[:240]})

    shutil.copyfile(a.pdf, a.out / a.pdf.name)
    manifest = {
        "title": (reader.metadata or {}).get("/Title", a.pdf.stem),
        "pdf": a.pdf.name,
        "pdf_sha256": hashlib.sha256(a.pdf.read_bytes()).hexdigest(),
        "source_rev": a.rev,
        "width": a.width,
        "height": height,
        "tools": {"pdftoppm": tool_version("pdftoppm", "-v"), "cwebp": tool_version("cwebp", "-version"),
                  "pypdf": pypdf.__version__},
        "pages": pages,
    }
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    size = sum(f.stat().st_size for f in a.out.glob("p*.webp"))
    print(f"{n} pages, {sum(p['dur'] is not None for p in pages)} timed, {size/1e6:.2f} MB of WebP")


main()
