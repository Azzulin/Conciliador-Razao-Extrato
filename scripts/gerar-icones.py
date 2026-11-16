"""Gera os ícones do Conciliador Razão × Extrato (PNG para o app e ICO para atalhos).

Duas folhas sobrepostas (razão e extrato) com um selo de conferido.
Uso: python scripts/gerar-icones.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
VERDE = (15, 107, 92, 255)
VERDE_CLARO = (227, 241, 238, 255)
BRANCO = (255, 255, 255, 255)
AMARELO = (233, 181, 90, 255)


def folha(d, lado, x0, y0, x1, y1, cor_linhas):
    dobra = lado * 0.10
    d.polygon([(x0, y0), (x1 - dobra, y0), (x1, y0 + dobra), (x1, y1), (x0, y1)], fill=BRANCO, outline=VERDE, width=int(lado * 0.012))
    d.polygon([(x1 - dobra, y0), (x1 - dobra, y0 + dobra), (x1, y0 + dobra)], fill=VERDE_CLARO)
    for i in range(4):
        y = y0 + lado * (0.13 + i * 0.07)
        d.rounded_rectangle([x0 + lado * 0.05, y, x1 - lado * (0.05 + 0.05 * (i % 2)), y + lado * 0.026],
                            radius=lado * 0.013, fill=cor_linhas)


def desenhar(lado=1024):
    img = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, lado - 1, lado - 1], radius=int(lado * 0.22), fill=VERDE)
    folha(d, lado, lado * 0.16, lado * 0.14, lado * 0.58, lado * 0.72, VERDE_CLARO)
    folha(d, lado, lado * 0.40, lado * 0.26, lado * 0.82, lado * 0.84, VERDE_CLARO)
    # selo de conferido
    cx, cy, r = lado * 0.70, lado * 0.72, lado * 0.17
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=AMARELO, outline=BRANCO, width=int(lado * 0.025))
    w = int(lado * 0.045)
    d.line([(cx - r * 0.5, cy + r * 0.02), (cx - r * 0.12, cy + r * 0.4), (cx + r * 0.55, cy - r * 0.38)], fill=BRANCO, width=w, joint="curve")
    return img


def main():
    base = desenhar()
    (RAIZ / "app").mkdir(exist_ok=True)
    (RAIZ / "build").mkdir(exist_ok=True)
    for lado in (192, 512):
        base.resize((lado, lado), Image.LANCZOS).save(RAIZ / "app" / f"icone-{lado}.png")
    base.resize((512, 512), Image.LANCZOS).save(RAIZ / "build" / "icon.png")
    base.save(RAIZ / "app" / "icone.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("ícones gerados")


if __name__ == "__main__":
    main()
