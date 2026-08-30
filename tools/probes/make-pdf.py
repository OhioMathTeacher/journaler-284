#!/usr/bin/env python3
"""A minimal multi-page PDF with real, extractable text.

The page-eviction suite needs a chapter long enough to scroll and pages that carry
text, because the text layer is part of what gets evicted and rebuilt. Hand-rolled
rather than pulled from a library so the harness has no dependencies.

    python3 tools/probes/make-pdf.py 30 _p_probe.pdf
"""
import io, sys

def build(n_pages, path):
    W, H = 612, 792
    objs = []
    def add(body):
        objs.append(body); return len(objs)
    def esc(s): return s.replace('\\', r'\\').replace('(', r'\(').replace(')', r'\)')

    font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    contents = []
    for p in range(1, n_pages + 1):
        lines = ["Page %d of the probe chapter" % p]
        for i in range(28):
            lines.append("Line %02d on page %d - a sentence long enough to give the "
                         "text layer real spans to build." % (i, p))
        ops = ["BT /F1 13 Tf 54 %d Td 18 TL" % (H - 70)]
        ops += ["(%s) Tj T*" % esc(ln) for ln in lines]
        ops.append("ET")
        stream = "\n".join(ops).encode('latin-1')
        contents.append(add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"))

    pages_id = len(objs) + n_pages + 1          # reserved: page objects, then the Pages node
    kids = [add("<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %d %d] "
                "/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
                % (pages_id, W, H, font, contents[p])) for p in range(n_pages)]
    real = add("<< /Type /Pages /Count %d /Kids [%s] >>"
               % (n_pages, " ".join("%d 0 R" % i for i in kids)))
    assert real == pages_id, (real, pages_id)
    root = add("<< /Type /Catalog /Pages %d 0 R >>" % pages_id)

    out, offsets = io.BytesIO(), [0]
    out.write(b"%PDF-1.4\n")
    for i, body in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % i)
        out.write(body if isinstance(body, bytes) else body.encode('latin-1'))
        out.write(b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for off in offsets[1:]:
        out.write(b"%010d 00000 n \n" % off)
    out.write(b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
              % (len(objs) + 1, root, xref))
    open(path, 'wb').write(out.getvalue())
    return out.tell()

if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    p = sys.argv[2] if len(sys.argv) > 2 else '_p_probe.pdf'
    print("wrote %s - %d pages, %d bytes" % (p, n, build(n, p)))
