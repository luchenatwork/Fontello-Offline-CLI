'use strict';

var XMLDOMParser = require('xmldom').DOMParser;
var _ = require('lodash');
var SvgPath = require('svgpath');

var quietTags = {};
var notQuietAtts = {};

['desc', 'title', 'metadata', 'defs'].forEach(function(key) {
  quietTags[key] = true;
});

[
  'requiredFeatures',
  'requiredExtensions',
  'systemLanguage',
  'xml:base',
  'xml:lang',
  'xml:space',
  'onfocusin',
  'onfocusout',
  'onactivate',
  'onclick',
  'onmousedown',
  'onmouseup',
  'onmouseover',
  'onmousemove',
  'onmouseout',
  'onload',
  'alignment-baseline',
  'baseline-shift',
  'clip',
  'clip-path',
  'clip-rule',
  'color',
  'color-interpolation',
  'color-interpolation-filters',
  'color-profile',
  'color-rendering',
  'cursor',
  'direction',
  'display',
  'dominant-baseline',
  'enable-background',
  'fill',
  'fill-opacity',
  'fill-rule',
  'filter',
  'flood-color',
  'flood-opacity',
  'font-family',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'glyph-orientation-horizontal',
  'glyph-orientation-vertical',
  'image-rendering',
  'kerning',
  'letter-spacing',
  'lighting-color',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'opacity',
  'overflow',
  'pointer-events',
  'shape-rendering',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'text-decoration',
  'text-rendering',
  'unicode-bidi',
  'visibility',
  'word-spacing',
  'writing-mode',
  'class',
  'style',
  'externalResourcesRequired',
  'pathLength',
  'externalResourcesRequired'
].forEach(function(key) {
  notQuietAtts[key] = true;
});

function processTree(node, ignoredTags, ignoredAttrs, parentTransforms, path) {
  var guaranteed = true;
  _.each(node.childNodes, function(item) {
    if (item.nodeType !== 1) {
      return;
    }

    if (quietTags[item.nodeName]) {
      return;
    }

    var transforms = item.getAttribute('transform')
      ? parentTransforms + ' ' + item.getAttribute('transform')
      : parentTransforms;
    // Parse nested tags
    if (item.nodeName === 'g') {
      var result = processTree(
        item,
        ignoredTags,
        ignoredAttrs,
        transforms,
        path
      );
      path = result.path;
      guaranteed = guaranteed && result.guaranteed;
    }

    var d = '';
    switch (item.nodeName) {
      case 'path':
        d = item.getAttribute('d');
        break;
      case 'g':
        break;
      default:
        ignoredTags[item.nodeName] = true;
        return;
    }

    var transformedPath = new SvgPath(d).transform(transforms).toString();
    if (path !== '' && transformedPath !== '') {
      guaranteed = false;
    }
    path += transformedPath;

    _.each(item.attributes, function(item) {
      if (notQuietAtts[item.nodeName]) {
        guaranteed = false;
        ignoredAttrs[item.nodeName] = true;
      }
    });
  });

  return { path, ignoredTags, ignoredAttrs, guaranteed };
}

function getCoordinates(svg) {
  var viewBoxAttr = svg.getAttribute('viewBox');
  var viewBox = _.map((viewBoxAttr || '').split(/(?: *, *| +)/g), function(
    val
  ) {
    return parseFloat(val);
  });

  if (viewBoxAttr && viewBox.length < 4) {
    return {
      error: new Error('Svg viewbox attr has less than 4 params')
    };
  }

  var attr = {};
  _.forEach(['x', 'y', 'width', 'height'], function(key) {
    var val = svg.getAttribute(key);

    if (val.length && val[val.length - 1] !== '%') {
      attr[key] = parseFloat(svg.getAttribute(key));
    }
  });

  if (viewBox[2] < 0 || viewBox[3] < 0 || attr.width < 0 || attr.height < 0) {
    return {
      error: new Error('Svg sizes can`t be negative')
    };
  }

  var result = {
    x: attr.x || 0,
    y: attr.y || 0,
    width: attr.width,
    height: attr.height,
    error: null
  };

  if (!viewBoxAttr) {
    if (result.width && result.height) {
      return result;
    }

    result.error = new Error(
      'Not implemented yet. There is no width or height'
    );

    return result;
  }

  if (!result.width && !result.height) {
    result.width = viewBox[2];
    result.height = viewBox[3];
    return result;
  }

  return result;
}

module.exports = function convert(sourceXml) {
  var error = null;
  var result = {
    d: '',
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    ignoredTags: [],
    ignoredAttrs: [],
    error,
    guaranteed: false
  };

  var xmlDoc = new XMLDOMParser({
    errorHandler: {
      error(err) {
        error = err;
      },
      fatalError(err) {
        error = err;
      }
    }
  }).parseFromString(sourceXml, 'application/xml');

  if (error) {
    result.error = error;
    return result;
  }

  var svg = xmlDoc.getElementsByTagName('svg')[0];

  var processed = processTree(svg, {}, {}, '', '');

  var coords = getCoordinates(svg);

  if (coords.error) {
    result.error = coords.error;
    return result;
  }

  result.d = processed.path;
  result.width = coords.width;
  result.height = coords.height;
  result.x = coords.x;
  result.y = coords.y;
  result.guaranteed = processed.guaranteed;
  result.ignoredTags = _.keys(processed.ignoredTags);
  result.ignoredAttrs = _.keys(processed.ignoredAttrs);
  return result;
};
