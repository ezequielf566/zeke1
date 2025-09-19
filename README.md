
# PNG → SVG (Coloring-Book) — Lote

Este pacote converte *PNGs de desenho* (traço preto + fundo branco) em **SVGs prontos para o app de colorir**, com:
- **Traço único** (`stroke`) preto 1.5px com cantos/arremates arredondados
- **Áreas sólidas pretas** preservadas (ex.: barba/cabelo)
- **Plate branco** opcional como plano de pintura (classe `paintable`)
- `viewBox` igual às dimensões originais (encaixa no app sem esticar)

## Requisitos
```bash
python -m pip install --upgrade pip
pip install opencv-python pillow numpy svgwrite scikit-image
```

## Uso
Coloque seus PNGs em uma pasta, ex.: `input_png/` e rode:
```bash
python png2svg_colorbook.py --in input_png --out output_svg --stroke 1.5 --close 2 --min-solid 2500 --paintplate on
```

- `--stroke`: espessura do traço em pixel do SVG
- `--close`: força o fechamento de micro-frestas (0 = desliga)
- `--min-solid`: área mínima (px) para considerar **preenchimento preto** (cabelo/barba)
- `--paintplate on|off`: adiciona um grande `rect` branco pintável

## Dicas de qualidade
- Envie PNGs **grandes e nítidos** (ex.: 2000–3000px de largura)
- Se houver “borrado/cinza”, aumente `--close` para 3–4
- Se cabelo/barba “vazar” como traço, reduza `--min-solid`

## Saída
SVG com 3 grupos:
```xml
<g id="solidos">   <!-- fill preto -->
<g id="pintavel">  <!-- plate branco (opcional) -->
<g id="traco">     <!-- linhas stroke preto -->
```
