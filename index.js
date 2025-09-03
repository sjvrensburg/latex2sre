#!/usr/bin/env node

// CLI to convert LaTeX to spoken math using MathJax v4 and SRE v4+
// ESM module; will be bundled to CJS for SEA.

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { createRequire } from 'module';

// MathJax v4 packaged build. Use the global MathJax object and access internals.
// Prefer CJS entry to simplify bundling
import MathJax from 'mathjax/node-main.cjs';
// Statically include TeX input to avoid dynamic loader in bundles
import 'mathjax/input/tex.js';

// SRE API will be loaded dynamically after SRE_JSON_PATH is set (important for SEA)
let sreSetupEngine = null;
let sreEngineReadyFn = null;
let sreToSpeech = null;

// SEA detection and asset access
let seaGetAsset = null;
try {
  if (typeof globalThis !== 'undefined' && globalThis.sea && typeof globalThis.sea.getAsset === 'function') {
    seaGetAsset = globalThis.sea.getAsset;
  }
} catch {}
if (!seaGetAsset) {
  try {
    // eslint-disable-next-line no-undef
    const mod = typeof require !== 'undefined' ? require('node:sea') : null;
    if (mod && typeof mod.getAsset === 'function') {
      seaGetAsset = mod.getAsset.bind(mod);
    }
  } catch {}
}
const isSEA = !!seaGetAsset;

// Cache for embedded JSON assets by locale
const mathmapCache = new Map();

function textFromBuffer(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  if (buf instanceof Uint8Array || (buf && typeof buf.byteLength === 'number')) {
    return new TextDecoder('utf-8').decode(buf);
  }
  return String(buf);
}

async function loadLocaleFromAssets(locale) {
  // Returns JSON string for the given locale from embedded SEA assets (with caching)
  if (mathmapCache.has(locale)) return mathmapCache.get(locale);
  if (!seaGetAsset) throw new Error('SEA assets not available');
  const assetName = `mathmaps/${locale}.json`;
  const buf = seaGetAsset(assetName);
  if (verbose) {
    const len = buf && (buf.byteLength || buf.length) || 0;
    console.error(`[SEA] getAsset(${assetName}) -> ${buf ? 'hit' : 'miss'} length=${len}`);
  }
  const str = textFromBuffer(buf);
  mathmapCache.set(locale, str);
  return str;
}

async function loadLocaleFromFs(locale) {
  if (mathmapCache.has(locale)) return mathmapCache.get(locale);
  const base = getFsJsonPath();
  if (!base) throw new Error('SRE JSON path not found');
  const file = path.join(base, `${locale}.json`);
  if (verbose) console.error(`[FS] reading ${file}`);
  const str = await fs.promises.readFile(file, 'utf8');
  mathmapCache.set(locale, str);
  return str;
}

async function loadLocaleAny(locale) {
  if (mathmapCache.has(locale)) return mathmapCache.get(locale);
  if (seaGetAsset && !process.env.SRE_JSON_PATH) return loadLocaleFromAssets(locale);
  return loadLocaleFromFs(locale);
}

function getFsJsonPath() {
  // Prefer env var discovered earlier; otherwise resolve from node_modules
  if (process.env.SRE_JSON_PATH || global.SRE_JSON_PATH) {
    return process.env.SRE_JSON_PATH || global.SRE_JSON_PATH;
  }
  try {
    const req = createRequire(import.meta.url);
    const pkg = req.resolve('speech-rule-engine/package.json');
    return path.join(path.dirname(pkg), 'lib', 'mathmaps');
  } catch {
    return undefined;
  }
}

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Constants for MathJax
const EM = 16;          // size of an em in pixels
const EX = 8;           // size of an ex in pixels
const WIDTH = 80 * EM;  // width of container for linebreaking
// Try to set SRE JSON path to be near the executable (for SEA runtime)
try {
  // In SEA we don't rely on filesystem mathmaps; they are embedded.
  if (!isSEA) {
    const exeDir = path.dirname(process.execPath);
    const candidate = path.join(exeDir, 'mathmaps');
    if (fs.existsSync(candidate)) {
      process.env.SRE_JSON_PATH = candidate;
      global.SRE_JSON_PATH = candidate;
    } else {
      // dev fallback: resolve from node_modules
      const req = createRequire(import.meta.url);
      const pkg = req.resolve('speech-rule-engine/package.json');
      const nmCandidate = path.join(path.dirname(pkg), 'lib', 'mathmaps');
      if (fs.existsSync(nmCandidate)) {
        process.env.SRE_JSON_PATH = nmCandidate;
        global.SRE_JSON_PATH = nmCandidate;
      }
    }
  }
} catch (e) {
  // ignore
}

// If running as SEA, extract embedded mathmaps assets to a temp dir and use FS loader.
let extractedDir = null;
async function ensureExtractedAssets() {
  if (process.env.SRE_JSON_PATH) { if (verbose) console.error('[SEA] assets already extracted at', process.env.SRE_JSON_PATH); return; }
  // Ensure we have access to SEA getAsset at runtime
  if (!seaGetAsset) { if (verbose) console.error('[SEA] getAsset not available initially; trying node:sea');
    try {
      const req = createRequire(import.meta.url);
      const mod = (0, Function)('req', "try { return req('node:sea'); } catch (e) { return null; }")(req);
      if (mod && typeof mod.getAsset === 'function') {
        seaGetAsset = mod.getAsset.bind(mod);
        if (verbose) console.error('[SEA] node:sea.getAsset bound');
      }
    } catch {}
  }
  if (!seaGetAsset) { if (verbose) console.error('[SEA] getAsset still unavailable; skip extraction'); return; }
  try {
    const manifestBuf = seaGetAsset('mathmaps/manifest.json');
    const mlen = manifestBuf && (manifestBuf.byteLength || manifestBuf.length) || 0;
    if (verbose) console.error(`[SEA] manifest fetch length=${mlen}`);
    const manifestStr = textFromBuffer(manifestBuf);
    const manifest = JSON.parse(manifestStr);
    const os = await import('os');
    const tmpBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'latex2sre-'));
    const destDir = path.join(tmpBase, 'mathmaps');
    await fs.promises.mkdir(destDir, { recursive: true });
    let count = 0;
    for (const file of manifest.files || []) {
      const abuf = seaGetAsset(`mathmaps/${file}`);
      const alen = abuf && (abuf.byteLength || abuf.length) || 0;
      if (verbose) console.error(`[SEA] asset ${file} length=${alen}`);
      if (!abuf) continue;
      const out = path.join(destDir, file);
      await fs.promises.writeFile(out, new Uint8Array(abuf));
      count++;
    }
    process.env.SRE_JSON_PATH = destDir;
    global.SRE_JSON_PATH = destDir;
    extractedDir = destDir;
    if (verbose) console.error(`[SEA] extracted mathmaps to ${destDir} (${count} files)`);
  } catch (e) {
    if (verbose) console.error('[SEA] extraction failed:', e && e.message ? e.message : e);
  }
}



// Prepare MathJax (initialized lazily for SEA compatibility)
let adaptor, tex, html, visitor, toMathML, STATE;
async function setupMathJax() {
  if (html) return; // already initialized
  await MathJax.init({});
  if (options.verbose) {
    console.error(`[Boot] SEA available: ${!!seaGetAsset}`);
    try {
      const req = createRequire(import.meta.url);
      const mod = (0, Function)('req', "try { return req('node:sea'); } catch (e) { return null; }")(req);
      console.error(`[Boot] node:sea module: ${!!mod}`);
    } catch {}
    console.error(`[Boot] SRE_JSON_PATH before setup: ${process.env.SRE_JSON_PATH || ''}`);
  }

  const lite = MathJax._.adaptors.liteAdaptor;
  const htmlTs = MathJax._.handlers.html_ts;
  adaptor = lite.liteAdaptor({ fontSize: EM });
  htmlTs.RegisterHTMLHandler(adaptor);
  const TeX = MathJax._.input.tex_ts.TeX;
  tex = new TeX({
    packages: ['base', 'ams', 'newcommand', 'noundefined'],
    formatError: (jax, err) => { throw new Error(err.message); },
  });
  html = MathJax._.mathjax.mathjax.document('', { InputJax: tex });
  const SerializedMmlVisitor = MathJax._.core.MmlTree.SerializedMmlVisitor.SerializedMmlVisitor;
  visitor = new SerializedMmlVisitor();
  toMathML = (node) => visitor.visitTree(node, html);
  STATE = MathJax._.core.MathItem.STATE;
}

// Cache for conversions
const cache = new Map();

// CLI setup
const program = new Command();
program
  .name('latex2sre')
  .description('Convert LaTeX math expressions to spoken math text using MathJax and SRE')
  .version('1.1.0')
  .argument('[latex]', 'LaTeX math expression (or use --input or stdin)')
  .option('-i, --input <file>', 'Input file containing LaTeX expressions (one per line for batch)')
  .option('-o, --output <file>', 'Output file (appends if batch)')
  .option('-l, --locale <locale>', 'Speech locale (e.g., en, de)', 'en')
  .option('-d, --domain <domain>', 'Speech domain (mathspeak, clearspeak)', 'mathspeak')
  .option('-s, --style <style>', 'Speech style (e.g., default, brief)', 'default')
  .option('-m, --modality <modality>', 'Modality (speech, braille)', 'speech')
  .option('--no-cache', 'Disable caching for repeated conversions')
  .option('--config <file>', 'JSON config file for additional SRE options')
  .option('--verbose', 'Enable verbose logging')
  .option('--batch-delimiter <char>', 'Delimiter to split batch input lines (defaults to newline)')
  .option('--stream', 'Stream output line by line for stdin/batch inputs')
  .parse(process.argv);

const options = program.opts();
const latexArg = program.args[0];
const useCache = !options.noCache;
const verbose = options.verbose;

async function loadSRE() {
  if (sreSetupEngine) return;
  // Prefer the package's default export which sets SRE_JSON_PATH automatically.
  // Use CJS System API directly to ensure custom loader is respected.
  const sys = await import('speech-rule-engine/cjs/common/system.js');
  sreSetupEngine = sys.setupEngine;
  sreEngineReadyFn = sys.engineReady;
  sreToSpeech = sys.toSpeech;
}

function log(...args) { if (verbose) console.error(...args); }

// Load custom config if provided
let customOptions = {};
if (options.config) {
  try {
    const configPath = path.resolve(options.config);
    customOptions = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    log('Loaded custom config:', customOptions);
  } catch (err) {
    console.error(`Error loading config file: ${err.message}`);
    process.exit(1);
  }
}

// Setup SRE with options
async function setupSRE() {
  // If SEA runtime, attempt to extract embedded assets to a temp dir and use FS loader.
  await ensureExtractedAssets();
  await loadSRE();
  const sreOptions = {
    locale: options.locale,
    domain: options.domain,
    style: options.style,
    modality: options.modality,
    // Provide a custom loader (still supports dev mode caching)
    custom: (loc) => loadLocaleAny(loc),
    // If we have extracted assets set SRE JSON path explicitly
    ...(getFsJsonPath() ? { json: getFsJsonPath() } : {}),
    ...customOptions,
  };

  if (verbose && seaGetAsset) {
    try {
      const b = seaGetAsset('mathmaps/base.json');
      const e = seaGetAsset(`mathmaps/${options.locale}.json`);
      const blen = b && (b.byteLength || b.length) || 0;
      const elen = e && (e.byteLength || e.length) || 0;
      console.error(`[SEA] probe assets: base.json=${blen} bytes, ${options.locale}.json=${elen} bytes`);
    } catch (e) {
      console.error('[SEA] probe error:', e && e.message ? e.message : e);
    }
  }

  log('Setting up SRE with options:', { ...sreOptions, custom: !!sreOptions.custom });

  try {
    await sreSetupEngine(sreOptions);
    // Inspect Engine internals to verify customLoader registration in dev/bundled contexts
    if (verbose) {
      try {
        const engMod = await import('speech-rule-engine/cjs/common/engine.js');
        const Engine = engMod.Engine || (engMod.default && engMod.default.Engine);
        if (Engine && typeof Engine.getInstance === 'function') {
          const inst = Engine.getInstance();
          console.error('[Debug] Engine customLoader set:', !!inst.customLoader);
        }
      } catch (e) {
        console.error('[Debug] Engine inspect error:', e && e.message ? e.message : e);
      }
    }
    await sreEngineReadyFn();
    log('SRE setup complete');
  } catch (err) {
    console.error(`SRE setup error: ${err.message}`);
    process.exit(1);
  }
}

// Convert LaTeX to speech (sync after SRE ready)
function convertToSpeech(latex) {
  if (!html) { throw new Error('MathJax not initialized'); }

  const key = `${latex}|${options.locale}|${options.domain}|${options.style}|${options.modality}`;
  if (useCache && cache.has(key)) { log(`Cache hit: ${latex}`); return cache.get(key); }

  try {
    const mmlNode = html.convert(latex, {
      display: true,
      em: EM,
      ex: EX,
      containerWidth: WIDTH,
      end: STATE.CONVERT,
    });
    const mml = toMathML(mmlNode);
    const speech = sreToSpeech(mml);
    if (useCache) cache.set(key, speech);
    return speech;
  } catch (err) {
    throw new Error(`Conversion error for "${latex}": ${err.message}`);
  }
}

async function processInput() {
  await setupMathJax();
  await setupSRE();

  const outputs = [];
  const delimiter = options.batchDelimiter || '\n';

  // Determine input
  if (options.input) {
    const inputPath = path.resolve(options.input);
    let content = '';
    try {
      content = await readFile(inputPath, 'utf8');
    } catch (err) {
      console.error(`Error reading input file: ${err.message}`);
      process.exit(1);
    }
    const lines = delimiter === '\n'
      ? content.split('\n')
      : content.split(delimiter);
    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const speech = convertToSpeech(trimmed);
        if (options.stream) {
          if (options.output) {
            await appendOut(speech + '\n');
          } else {
            process.stdout.write(speech + '\n');
          }
        } else {
          outputs.push(speech);
        }
        count++;
      } catch (err) {
        console.error(err.message);
      }
    }
    log(`Processed ${count} expressions from file.`);
  } else if (latexArg) {
    try {
      const speech = convertToSpeech(latexArg);
      outputs.push(speech);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  } else if (!process.stdin.isTTY) {
    // Stream from stdin line by line
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const speech = convertToSpeech(trimmed);
        if (options.stream) {
          if (options.output) {
            await appendOut(speech + '\n');
          } else {
            process.stdout.write(speech + '\n');
          }
        } else {
          outputs.push(speech);
        }
      } catch (err) {
        console.error(err.message);
      }
    }
  } else {
    program.help();
    return;
  }

  // Batch output
  if (!options.stream) {
    const result = outputs.join('\n');
    if (options.output) {
      try {
        await writeFile(path.resolve(options.output), result + '\n', 'utf8');
        log(`Output written to: ${path.resolve(options.output)}`);
      } catch (err) {
        console.error(`Error writing output file: ${err.message}`);
        process.exit(1);
      }
    } else {
      process.stdout.write(result + '\n');
    }
  }
}

async function appendOut(text) {
  const outPath = path.resolve(options.output);
  await fs.promises.appendFile(outPath, text, 'utf8');
}

processInput().catch(err => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
