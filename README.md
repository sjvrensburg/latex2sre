# latex2sre

CLI tool to convert LaTeX math expressions to spoken math text using MathJax v4 and Speech Rule Engine (SRE v4+/5).

Features:
- Parse LaTeX to MathML with MathJax v4
- Convert MathML to speech via SRE (MathSpeak, ClearSpeak; locales, styles, modality)
- Batch processing from files or stdin; streaming mode
- Caching of repeated conversions
- Verbose logging and JSON config overrides
- Bundled single-file CJS via esbuild and packaged as a Node SEA binary

## Install (development)

```
npm install
```

## Usage

- Single expression:
```
node index.js "x=1" --domain clearspeak --locale en
```
- Batch from file:
```
node index.js --input input.txt
```
- Streaming from stdin:
```
cat input.txt | node index.js --stream
```
- With options:
```
node index.js "a^2+b^2=c^2" \
  --domain mathspeak --style default --modality speech \
  --locale en --verbose
```

Flags:
- -i, --input <file>         Input file with one LaTeX per line
- -o, --output <file>        Output file
- -l, --locale <locale>      Locale (default: en)
- -d, --domain <domain>      Speech rule domain: mathspeak, clearspeak
- -s, --style <style>        Style (default: default)
- -m, --modality <modality>  speech, braille
- --no-cache                 Disable caching
- --config <file>            JSON config merged into SRE options
- --verbose                  Verbose logging
- --batch-delimiter <char>   Custom delimiter for batch files (default newline)
- --stream                   Stream results line by line

## SEA Binary

Build a single executable for your platform (Node v22+ required):
```
npm run build:sea
```
This produces:
- `bundled-app.cjs` (bundled CJS)
- `latex2sre` (SEA binary)
- `mathmaps/` (copied SRE rule assets)

Run the binary:
```
./latex2sre "E = mc^2" --domain clearspeak --locale en
```

Note: The SEA binary looks for a `mathmaps/` directory next to the executable. This repository’s build script copies it automatically. If you relocate the binary, copy the `mathmaps/` folder alongside it, or set the environment variable `SRE_JSON_PATH` to point at the folder containing the locale JSON (e.g., en.json, base.json).

## Tests

Run smoke tests:
```
npm test
```

## Implementation Notes

- MathJax is initialized lazily and the TeX input is statically imported (`mathjax/input/tex.js`) to avoid dynamic loader issues when bundling.
- SRE is loaded dynamically at runtime after we set `SRE_JSON_PATH`, ensuring mathmaps can be located in SEA and bundled modes.
- For truly single-file distribution without any external assets, you would need to embed SRE mathmaps into the bundle and provide a custom SRE loader; this project opts for the simpler approach of shipping the small `mathmaps/` directory alongside the binary.
