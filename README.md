# latex2sre

CLI tool to convert LaTeX math expressions to spoken math text using MathJax v4 and Speech Rule Engine (SRE v5). Now supports truly single-file SEA distribution with embedded SRE mathmaps.

Highlights:
- MathJax v4 TeX -> MathML conversion, SRE v5 speech (MathSpeak, ClearSpeak, Nemeth, multilocale)
- Single-file executable via Node SEA with embedded mathmaps assets (no node_modules at runtime)
- Dev-mode filesystem fallback for SRE JSON (unchanged developer experience)
- Caching for repeated conversions; lazy locale loading
- Verbose logging and JSON config overrides

## Installation (Development)

```
npm install
```

## Quick Start (Development)

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
- --batch-delimiter <char>   Custom delimiter for batch files (default: newline)
- --stream                   Stream results line by line

## Building the Single-File SEA Binary

Requirements: Node v22+ (SEA), esbuild, postject (installed via devDependencies).

Command:
```
npm run build:sea
```
This performs:
1. Bundle to CommonJS using esbuild (bundled-app.cjs)
2. Discover and embed SRE mathmaps into the SEA blob (build-assets.cjs + sea-config.json)
3. Generate a manifest (dist/mathmaps-manifest.json) to list embedded mathmaps
4. Create SEA blob (sea-prep.blob) and inject into a Node executable copy -> ./latex2sre

Run the binary:
```
./latex2sre "E=mc^2" --domain clearspeak --locale en --verbose
```

Behavior at runtime:
- The binary extracts the embedded mathmaps (from SEA assets) to a temp folder and sets SRE_JSON_PATH automatically
- SRE loads its JSON from that path; no node_modules required
- Experimental SEA warnings are suppressed in sea-config.json

## Rationale for Embedded Assets

Previously, SEA builds required shipping an external `mathmaps/` folder, breaking truly single-file distribution. This migration embeds all required SRE mathmaps JSONs directly into the SEA blob. At runtime, the binary extracts them to a temporary directory and points SRE to that path. Benefits:
- Single-file distribution: portable executable without external data
- Robustness: SRE continues to use standard filesystem JSON loading
- Performance: lazy, cached locale loading; startup extraction overhead is minimal

## Cross-Platform Notes

- The SEA binary keeps executable mode on Unix (chmod +x) and runs on the platform you built it on.
- Path handling and temp directory extraction work on Linux, macOS, and Windows.

## Tests

```
npm test
```

All existing tests pass with SEA embedding enabled.
