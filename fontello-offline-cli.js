#!/usr/bin/env node

'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const SvgPath = require('svgpath');
const svgFlatten = require('./svg-flatten');
const ArgumentParser = require('argparse').ArgumentParser;
const fontWorker = require('./font-worker');

const parser = new ArgumentParser({
  version: require('./package.json').version,
  addHelp: true,
  description: 'Fontello Batch CLI'
});
parser.addArgument(['-p', '--path'], {
  help: 'Source SVG Files Path, e.g., "C:\\Svg Source", C:\\SvgSource',
  required: true
});
parser.addArgument(['-n', '--name'], {
  help: 'Font Name, e.g., Fontello, "My Font"',
  required: false
});
parser.addArgument(['-o', '--owner'], {
  help: 'Font Owner, e.g., SomeCompany, "Smith John"',
  required: false
});
parser.addArgument(['-rp', '--removeprefix'], {
  help: 'Remove Prefix, e.g., "Icon ", "Icon-"',
  required: false
});
parser.addArgument(['-rs', '--removesuffix'], {
  help: 'Remove Suffix, e.g., " 24px", "-24px"',
  required: false
});
parser.addArgument(['-op', '--outputprefix'], {
  help: 'CSS Class Prefix, e.g., "google-icon", "your-icon"',
  required: false
});
const args = parser.parseArgs();

var allocatedRefCode = 0xe800;
const svgFilesPath = args.path;
const svgFiles = filterSvgFiles(svgFilesPath);
var glyphs = [];

svgFiles.forEach(createGlyph(args.removeprefix, args.removesuffix));

const output = {
  name: args.name ? args.name : null,
  css_prefix_text: args.outputprefix || '',
  css_use_suffix: false,
  hinting: false,
  units_per_em: 1000,
  ascent: 850,
  copyright: args.owner
    ? 'Copyright (C) ' + new Date().getFullYear() + ' by ' + args.owner
    : null,
  glyphs: glyphs
};

const data = {
  fontId: uid(),
  config: output
};
const builderConfig = fontConfig(data.config, args.outputprefix);
const taskInfo = {
  fontId: data.fontId,
  clientConfig: data.config,
  builderConfig,
  tmpDir: path.join(path.resolve(), 'webfonts'),
  timestamp: Date.now(),
  result: null
};

fontWorker(taskInfo).then(_ => {
  console.log('Font generated successfully!');
});

function collectGlyphsInfo(clientConfig) {
  const result = [];
  const scale = clientConfig.units_per_em / 1000;

  clientConfig.glyphs.forEach(glyph => {
    const svgpath = require('svgpath');
    let sp;

    if (glyph.src === 'custom_icons') {
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
    }
  });

  result.sort((a, b) => a.code - b.code);

  return result;
}

function fontConfig(clientConfig, outputprefix) {
  if (clientConfig.fullname === 'undefined') {
    delete clientConfig.fullname;
  }
  if (clientConfig.copyright === 'undefined') {
    delete clientConfig.copyright;
  }

  clientConfig.css_use_suffix = Boolean(clientConfig.css_use_suffix);
  clientConfig.css_prefix_text = clientConfig.css_prefix_text || '';
  clientConfig.hinting = clientConfig.hinting !== false;
  clientConfig.units_per_em = +clientConfig.units_per_em || 1000;
  clientConfig.ascent = +clientConfig.ascent || 850;

  let fontname;
  if (!_.isEmpty(clientConfig.name)) {
    fontname = String(clientConfig.name).replace(/[^A-Za-z0-9\-_]+/g, '-').toLowerCase();
  } else {
    fontname = 'fontello';
  }

  const glyphsInfo = collectGlyphsInfo(clientConfig);

  const defaultCopyright =
    'Copyright (C) ' +
    new Date().getFullYear() +
    ' by original authors @ fontello.com';

  return {
    font: {
      fontname,
      fullname: clientConfig.name,
      familyname: clientConfig.name,
      copyright: clientConfig.copyright || defaultCopyright,
      ascent: clientConfig.ascent,
      descent: clientConfig.ascent - clientConfig.units_per_em,
      weight: 400
    },
    hinting: clientConfig.hinting !== false,
    meta: {
      columns: 4,
      css_prefix_text: clientConfig.css_prefix_text || '',
      css_use_suffix: Boolean(clientConfig.css_use_suffix)
    },
    glyphs: glyphsInfo,
    fonts_list: [],
    outputprefix: outputprefix || ''
  };
}

function createGlyph(removeprefix, removesuffix) {
  return function(svgFile) {
    var path = require('path');
    removeprefix = removeprefix || '';
    removesuffix = removesuffix || '';
    var glyphName = path.basename(svgFile, '.svg')
      .replace(removeprefix, '')
      .replace(removesuffix, '')
      .replace(/\s/g, '-')
      .replace('---', '-')
      .replace('--', '-')
      .toLowerCase();
    var data = fs.readFileSync(svgFile, 'utf-8');
    var result = svgFlatten(data);
    if (result.error) {
      console.error(result.error);
      return;
    }
    var scale = 1000 / result.height;
    var svgPath = new SvgPath(result.d)
      .translate(-result.x, -result.y)
      .scale(scale)
      .abs()
      .round(1)
      .toString();
    if (svgPath === '') {
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
        path: svgPath,
        width: 1000
      },
      search: [glyphName]
    });
  };
}

function uid() {
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, function() {
    return ((Math.random() * 16) | 0).toString(16);
  });
}

function filterSvgFiles(svgFolderPath) {
  const files = fs.readdirSync(svgFolderPath, 'utf-8');
  const svgArr = [];
  if (!files) {
    throw new Error(`Error! Svg folder is empty.${svgFolderPath}`);
  }

  for (const file in files) {
    if (
      typeof files[file] !== 'string' ||
      path.extname(files[file]) !== '.svg'
    ) {
      continue;
    }
    if (!~svgArr.indexOf(files[file])) {
      svgArr.push(path.join(svgFolderPath, files[file]));
    }
  }
  return svgArr;
}
