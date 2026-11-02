import { createRequire } from 'module';

let patched = false;

export function asyncHandler(fn) {
  return function wrappedAsyncHandler(req, res, next) {
    try {
      return Promise.resolve(fn(req, res, next)).catch(next);
    } catch (error) {
      return next(error);
    }
  };
}

export function patchExpressAsync() {
  if (patched) return;
  patched = true;
  const require = createRequire(import.meta.url);
  const Layer = require('express/lib/router/layer.js');
  const originalHandleRequest = Layer.prototype.handle_request;

  Layer.prototype.handle_request = function handleAsyncRequest(req, res, next) {
    const fn = this.handle;
    if (typeof fn !== 'function' || fn.length > 3) {
      return originalHandleRequest.apply(this, arguments);
    }
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch(next);
      }
      return result;
    } catch (error) {
      return next(error);
    }
  };
}
