#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const SvgPath = require('svgpath');
const svg_image_flatten = require('./svg-flatten');
const ArgumentParser = require('argparse').ArgumentParser;
const fontWorker = require('./font-worker');

var parser = new ArgumentParser({
  version: require('./package.json').version,
  addHelp: true,
  description: 'Fontello Batch CLI'
});
parser.addArgument(['-p', '--path'], {
  help: 'Source SVG Font Path, e.g., "C:\\Svg Source", C:\\SvgSource',
  required: true
});
parser.addArgument(['-s', '--host'], {
  help:
    'Fontello Host Website Url, e.g., http://fontello.com, http://localhost:3000',
  required: false
});
var args = parser.parseArgs();

var allocatedRefCode = 0xe800;
const svgFilesPath = args.path;
var svgFiles = filterSvgFiles(svgFilesPath);
var glyphs = [];

svgFiles.forEach(createGlyph());

var output = {
  name: '',
  css_prefix_text: 'icon-',
  css_use_suffix: false,
  hinting: false,
  units_per_em: 1000,
  ascent: 850,
  glyphs: glyphs
};

fs.writeFileSync('config.json', JSON.stringify(output), {
  encoding: 'utf-8',
  flag: 'w'
});

const data = {
  fontId: uid(),
  config: output
};

let builderConfig = fontConfig(data.config);

let taskInfo = {
  fontId: data.fontId,
  clientConfig: data.config,
  builderConfig,
  tmpDir: path.join(
    __dirname,
    'fontello',
    `fontello-${data.fontId.substr(0, 8)}`
  ),
  timestamp: Date.now(),
  result: null
};

fontWorker(taskInfo).then(_ => {
  console.log('Font generated successfully.');
});

function collectGlyphsInfo(clientConfig) {
  let result = [];
  let scale = clientConfig.units_per_em / 1000;

  clientConfig.glyphs.forEach(glyph => {
    const svgpath = require('svgpath');
    let sp;

    if (glyph.src === 'custom_icons') {
      // for custom glyphs use only selected ones
      if (!glyph.selected) return;

      sp = svgpath(glyph.svg.path)
        .scale(scale, -scale)
        .translate(0, clientConfig.ascent)
        .abs()
        .round(0)
        .rel();

      result.push({
        src: glyph.src,
        uid: glyph.uid,
        code: glyph.code,
        css: glyph.css,
        width: +(glyph.svg.width * scale).toFixed(1),
        d: sp.toString(),
        segments: sp.segments.length
      });
      return;
    }

    // For exmbedded fonts take pregenerated info

    let glyphEmbedded = fontConfigs.uids[glyph.uid];

    if (!glyphEmbedded) return;

    sp = svgpath(glyphEmbedded.svg.d)
      .scale(scale, -scale)
      .translate(0, clientConfig.ascent)
      .abs()
      .round(0)
      .rel();

    result.push({
      src: glyphEmbedded.fontname,
      uid: glyph.uid,
      code: glyph.code || glyphEmbedded.code,
      css: glyph.css || glyphEmbedded.css,
      'css-ext': glyphEmbedded['css-ext'],
      width: +(glyphEmbedded.svg.width * scale).toFixed(1),
      d: sp.toString(),
      segments: sp.segments.length
    });
  });

  // Sort result by original codes.
  result.sort((a, b) => a.code - b.code);

  return result;
}

function fontConfig(clientConfig) {
  let fontname, glyphsInfo, fontsInfo;

  //
  // Patch broken data to fix original config
  //
  if (clientConfig.fullname === 'undefined') {
    delete clientConfig.fullname;
  }
  if (clientConfig.copyright === 'undefined') {
    delete clientConfig.copyright;
  }

  //
  // Fill default values, until replace `revalidator` with something better
  // That's required for old `config.json`-s.
  //

  clientConfig.css_use_suffix = Boolean(clientConfig.css_use_suffix);
  clientConfig.css_prefix_text = clientConfig.css_prefix_text || 'icon-';
  clientConfig.hinting = clientConfig.hinting !== false;
  clientConfig.units_per_em = +clientConfig.units_per_em || 1000;
  clientConfig.ascent = +clientConfig.ascent || 850;

  //
  // Start creating builder config
  //

  // fontname = String(clientConfig.name).replace(/[^a-z0-9\-_]+/g, '-');
  fontname = 'fontello';

  glyphsInfo = collectGlyphsInfo(clientConfig);

  let defaultCopyright =
    'Copyright (C) ' +
    new Date().getFullYear() +
    ' by original authors @ fontello.com';

  return {
    font: {
      fontname,
      fullname: fontname,
      // !!! IMPORTANT for IE6-8 !!!
      // due bug, EOT requires `familyname` begins `fullname`
      // https://github.com/fontello/fontello/issues/73?source=cc#issuecomment-7791793
      familyname: fontname,
      copyright: clientConfig.copyright || defaultCopyright,
      ascent: clientConfig.ascent,
      descent: clientConfig.ascent - clientConfig.units_per_em,
      weight: 400
    },
    hinting: clientConfig.hinting !== false,
    meta: {
      columns: 4, // Used by the demo page.
      // Set defaults if fields not exists in config
      css_prefix_text: clientConfig.css_prefix_text || 'icon-',
      css_use_suffix: Boolean(clientConfig.css_use_suffix)
    },
    glyphs: glyphsInfo,
    fonts_list: []
  };
}

function createGlyph() {
  return function(svgFile) {
    var path = require('path');
    var glyphName = path.basename(svgFile, '.svg').replace(/\s/g, '-');
    var data = fs.readFileSync(svgFile, 'utf-8');
    var result = svg_image_flatten(data);
    if (result.error) {
      console.error(result.error);
      return;
    }
    var scale = 1000 / result.height;
    var path = new SvgPath(result.d)
      .translate(-result.x, -result.y)
      .scale(scale)
      .abs()
      .round(1)
      .toString();
    if (path === '') {
      console.error(svgFile + ' has no path data!');
      return;
    }
    glyphs.push({
      uid: uid(),
      css: glyphName,
      code: allocatedRefCode++,
      src: 'custom_icons',
      selected: true,
      svg: {
        path: path,
        width: 1000
      },
      search: [glyphName]
    });
  };
}

function uid() {
  /*eslint-disable no-bitwise*/
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, function() {
    return ((Math.random() * 16) | 0).toString(16);
  });
}

function filterSvgFiles(svgFolderPath) {
  let files = fs.readdirSync(svgFolderPath, 'utf-8');
  let svgArr = [];
  if (!files) {
    throw new Error(`Error! Svg folder is empty.${svgFolderPath}`);
  }

  for (let i in files) {
    if (typeof files[i] !== 'string' || path.extname(files[i]) !== '.svg')
      continue;
    if (!~svgArr.indexOf(files[i]))
      svgArr.push(path.join(svgFolderPath, files[i]));
  }
  return svgArr;
}
