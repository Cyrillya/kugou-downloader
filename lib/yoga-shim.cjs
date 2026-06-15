// Synchronous yoga-layout shim for CJS bundling
// Uses yoga-layout 2.0.1's wasm-sync-node + 3.x API compatibility

const loader = require('./yoga-wasm.cjs');

const lib = loader();

// Apply wrapAssembly patches from yoga-layout 3.x for API compatibility
(function patch() {
  function _patch(prototype, name, fn) {
    const original = prototype[name];
    prototype[name] = function () {
      return fn.call(this, original, ...arguments);
    };
  }

  const methods = {
    setPosition: ['setPositionPercent', 'setPositionAuto'],
    setMargin: ['setMarginPercent', 'setMarginAuto'],
    setFlexBasis: ['setFlexBasisPercent', 'setFlexBasisAuto'],
    setWidth: ['setWidthPercent', 'setWidthAuto'],
    setHeight: ['setHeightPercent', 'setHeightAuto'],
    setMinWidth: ['setMinWidthPercent', 'setMinWidthAuto'],
    setMinHeight: ['setMinHeightPercent', 'setMinHeightAuto'],
    setMaxWidth: ['setMaxWidthPercent', 'setMaxWidthAuto'],
    setMaxHeight: ['setMaxHeightPercent', 'setMaxHeightAuto'],
    setPadding: ['setPaddingPercent'],
    setGap: ['setGapPercent'],
  };

  for (const [fnName, [percentFn, autoFn]] of Object.entries(methods)) {
    const unitMethods = {
      [lib.UNIT_POINT || 0]: lib.Node.prototype[fnName],
      [lib.UNIT_PERCENT || 1]: lib.Node.prototype[percentFn],
      [lib.UNIT_AUTO || 2]: autoFn ? lib.Node.prototype[autoFn] : undefined,
    };

    _patch(lib.Node.prototype, fnName, function (original) {
      const args = [...arguments].slice(1);
      const value = args.pop();
      let unit, asNumber;

      if (value === 'auto') {
        unit = lib.UNIT_AUTO || 2;
        asNumber = undefined;
      } else if (typeof value === 'object') {
        unit = value.unit;
        asNumber = value.valueOf();
      } else {
        unit = typeof value === 'string' && value.endsWith('%') ? (lib.UNIT_PERCENT || 1) : (lib.UNIT_POINT || 0);
        asNumber = parseFloat(value);
        if (value !== undefined && !Number.isNaN(value) && Number.isNaN(asNumber)) {
          throw new Error('Invalid value ' + value + ' for ' + fnName);
        }
      }

      if (!unitMethods[unit]) throw new Error('Unsupported unit ' + value);
      if (asNumber !== undefined) {
        return unitMethods[unit].call(this, ...args, asNumber);
      } else {
        return unitMethods[unit].call(this, ...args);
      }
    });
  }

  // Add Node.create() for yoga-layout 3.x compatibility
  lib.Node.create = function (config) {
    return config ? lib.Node.createWithConfig(config) : lib.Node.createDefault();
  };

  _patch(lib.Node.prototype, 'free', function () {
    lib.Node.destroy(this);
  });

  _patch(lib.Node.prototype, 'freeRecursive', function () {
    for (let t = 0, T = this.getChildCount(); t < T; ++t) {
      this.getChild(0).freeRecursive();
    }
    this.free();
  });

  function wrapMeasureFunction(measureFunction) {
    return lib.MeasureCallback ? lib.MeasureCallback.implement({
      measure: function () {
        const { width, height } = measureFunction(...arguments);
        return { width: width ?? NaN, height: height ?? NaN };
      }
    }) : measureFunction;
  }

  _patch(lib.Node.prototype, 'setMeasureFunc', function (original, measureFunc) {
    if (measureFunc) return original.call(this, wrapMeasureFunction(measureFunc));
    else return this.unsetMeasureFunc();
  });
})();

module.exports = lib;
module.exports.default = lib;
