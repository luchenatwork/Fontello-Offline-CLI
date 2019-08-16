// Working procedure for the font builder queue.
//
'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const path = require('path');
const mz = require('mz');
const fs = require('fs');
const ttf2eot = require('ttf2eot');
const ttf2woff = require('ttf2woff');
const wawoff2 = require('wawoff2');
const svg2ttf = require('svg2ttf');
const pug = require('pug');
const b64 = require('base64-js');
const rimraf = Promise.promisify(require('rimraf'));
const mkdirp = Promise.promisify(require('mkdirp'));

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const TEMPLATES = {};
const SVG_FONT_TEMPLATE = _.template(
  fs.readFileSync(path.join(TEMPLATES_DIR, 'svg.tpl'), 'utf8')
);

_.forEach(
  {
    'demo.pug': 'demo.html',
    'css/css.pug': 'css/${FONTNAME}.css',
    'css/css-ie7.pug': 'css/${FONTNAME}-ie7.css',
    'css/css-codes.pug': 'css/${FONTNAME}-codes.css',
    'css/css-ie7-codes.pug': 'css/${FONTNAME}-ie7-codes.css',
    'css/css-embedded.pug': 'css/${FONTNAME}-embedded.css',
    'LICENSE.pug': 'LICENSE.txt',
    'css/animation.css': 'css/animation.css',
    'README.txt': 'README.txt'
  },
  (outputName, inputName) => {
    let inputFile = path.join(TEMPLATES_DIR, inputName);
    let inputData = fs.readFileSync(inputFile, 'utf8');
    let outputData;

    switch (path.extname(inputName)) {
      case '.pug': // Pug template.
        outputData = pug.compile(inputData, {
          pretty: true,
          filename: inputFile,
          filters: [require('jstransformer-stylus')]
        });
        break;

      case '.tpl': // Lodash template.
        outputData = _.template(inputData);
        break;

      default:
        // Static file - just do a copy.
        outputData = () => inputData;
        break;
    }

    TEMPLATES[outputName] = outputData;
  }
);

module.exports = async function fontWorker(taskInfo) {
  let fontname = taskInfo.builderConfig.font.fontname;
  let files;

  // Collect file paths.
  //
  files = {
    config: path.join(taskInfo.tmpDir, 'config.json'),
    svg: path.join(taskInfo.tmpDir, 'font', `${fontname}.svg`),
    ttf: path.join(taskInfo.tmpDir, 'font', `${fontname}.ttf`),
    ttfUnhinted: path.join(taskInfo.tmpDir, 'font', `${fontname}-unhinted.ttf`),
    eot: path.join(taskInfo.tmpDir, 'font', `${fontname}.eot`),
    woff: path.join(taskInfo.tmpDir, 'font', `${fontname}.woff`),
    woff2: path.join(taskInfo.tmpDir, 'font', `${fontname}.woff2`)
  };

  // Generate initial SVG font.
  //
  /*eslint-disable new-cap*/
  let svgOutput = SVG_FONT_TEMPLATE(taskInfo.builderConfig);

  // Prepare temporary working directory.
  //
  await rimraf(taskInfo.tmpDir);
  await mkdirp(taskInfo.tmpDir);
  await mkdirp(path.join(taskInfo.tmpDir, 'font'));
  await mkdirp(path.join(taskInfo.tmpDir, 'css'));

  // Write clinet config and initial SVG font.
  //
  let configOutput = JSON.stringify(taskInfo.clientConfig, null, '  ');

  await mz.fs.writeFile(files.config, configOutput, 'utf8');
  await mz.fs.writeFile(files.svg, svgOutput, 'utf8');

  // Convert SVG to TTF
  //
  let ttf = svg2ttf(svgOutput, {
    copyright: taskInfo.builderConfig.font.copyright
  });

  await mz.fs.writeFile(files.ttf, ttf.buffer);

  // Read the resulting TTF to produce EOT and WOFF.
  //
  let ttfOutput = new Uint8Array(await mz.fs.readFile(files.ttf));

  // Convert TTF to EOT.
  //
  let eotOutput = ttf2eot(ttfOutput).buffer;

  await mz.fs.writeFile(files.eot, eotOutput);

  // Convert TTF to WOFF.
  //
  let woffOutput = ttf2woff(ttfOutput).buffer;

  await mz.fs.writeFile(files.woff, woffOutput);

  // Convert TTF to WOFF2.
  //
  let woff2Output = await wawoff2.compress(ttfOutput);

  await mz.fs.writeFile(files.woff2, woff2Output);

  let templatesNames = Object.keys(TEMPLATES);

  for (let i = 0; i < templatesNames.length; i++) {
    let templateName = templatesNames[i];
    let templateData = TEMPLATES[templateName];

    if (
      templateName === 'LICENSE.txt' &&
      !taskInfo.builderConfig.fonts_list.length
    ) {
      continue;
    }

    let outputName = templateName.replace('${FONTNAME}', fontname);
    let outputFile = path.join(taskInfo.tmpDir, outputName);
    let outputData = templateData(taskInfo.builderConfig);

    outputData = outputData
      .replace('%WOFF64%', b64.fromByteArray(woffOutput))
      .replace('%TTF64%', b64.fromByteArray(ttfOutput));

    await mz.fs.writeFile(outputFile, outputData, 'utf8');
  }
};
