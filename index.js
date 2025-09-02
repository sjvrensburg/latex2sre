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

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Constants for MathJax
const EM = 16;          // size of an em in pixels
const EX = 8;           // size of an ex in pixels
const WIDTH = 80 * EM;  // width of container for linebreaking
// Try to set SRE JSON path to be near the executable (for SEA runtime)
try {
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
} catch (e) {
  // ignore
}


// Prepare MathJax (initialized lazily for SEA compatibility)
let adaptor, tex, html, visitor, toMathML, STATE;
async function setupMathJax() {
  if (html) return; // already initialized
  await MathJax.init({});
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
  .version('1.0.0')
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
  let mod;
  try {
    mod = await import('speech-rule-engine');
    const SRE = mod.default || mod;
    sreSetupEngine = SRE.setupEngine;
    sreEngineReadyFn = SRE.engineReady;
    sreToSpeech = SRE.toSpeech;
  } catch (e) {
    // Fallback to direct path if needed
    const sys = await import('speech-rule-engine/js/common/system.js');
    sreSetupEngine = sys.setupEngine;
    sreEngineReadyFn = sys.engineReady;
    sreToSpeech = sys.toSpeech;
  }
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
  await loadSRE();
  const sreOptions = {
    locale: options.locale,
    domain: options.domain,
    style: options.style,
    modality: options.modality,
    json: process.env.SRE_JSON_PATH || global.SRE_JSON_PATH, // hint to SRE where to find mathmaps
    ...customOptions,
  };

  log('Setting up SRE with options:', sreOptions);

  try {
    await sreSetupEngine(sreOptions);
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
