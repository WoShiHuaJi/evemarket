var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.ts
var ESI = "https://esi.evetech.net/latest";
var ESI_HEADERS = { "X-Compatibility-Date": "2025-12-16" };
var CONCURRENCY = 12;
var JITA_REGION = 10000002;
var JITA_STATION = 60003760;
var HWWF_REGION = 10000003;
var HWWF_SYSTEM = 30000240;
var KV_KEY = "prices:latest";
async function esiJson(path, retries = 4) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ESI}${path}`, { headers: ESI_HEADERS });
    if (res.status === 420 || res.status === 429 || res.status >= 500) {
      if (attempt >= retries) throw new Error(`ESI ${res.status}: ${path}`);
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1e3 : 1e3 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`ESI ${res.status}: ${path}`);
    const pages = Number(res.headers.get("x-pages")) || 1;
    return { data: await res.json(), pages };
  }
}
__name(esiJson, "esiJson");
var sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");
async function runPool(items, size, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}
__name(runPool, "runPool");
async function fetchRegionOrders(regionId) {
  const base = `/markets/${regionId}/orders/?datasource=tranquility&order_type=all`;
  const first = await esiJson(`${base}&page=1`);
  const all = [...first.data];
  if (first.pages > 1) {
    const rest = Array.from({ length: first.pages - 1 }, (_, i) => i + 2);
    const results = await runPool(rest, CONCURRENCY, (page) => esiJson(`${base}&page=${page}`));
    for (const r of results) all.push(...r.data);
  }
  return all;
}
__name(fetchRegionOrders, "fetchRegionOrders");
async function aggregate() {
  const [jita, hwwf] = await Promise.all([fetchRegionOrders(JITA_REGION), fetchRegionOrders(HWWF_REGION)]);
  const rows = {};
  const touch = /* @__PURE__ */ __name((id) => rows[id] ??= [0, 0, 0, 0], "touch");
  for (const o of jita) {
    if (o.location_id !== JITA_STATION) continue;
    const r = touch(o.type_id);
    if (o.is_buy_order) {
      if (o.price > r[1]) r[1] = o.price;
    } else if (r[0] === 0 || o.price < r[0]) {
      r[0] = o.price;
    }
  }
  for (const o of hwwf) {
    if (o.system_id !== HWWF_SYSTEM) continue;
    const r = touch(o.type_id);
    if (o.is_buy_order) {
      if (o.price > r[3]) r[3] = o.price;
    } else if (r[2] === 0 || o.price < r[2]) {
      r[2] = o.price;
    }
  }
  return JSON.stringify({ updatedAt: Date.now(), rows });
}
__name(aggregate, "aggregate");
var worker_default = {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      aggregate().then((payload) => env.PRICES.put(KV_KEY, payload))
    );
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/prices") {
      const payload = await env.PRICES.get(KV_KEY);
      if (!payload) {
        return new Response(JSON.stringify({ error: "no data yet" }), {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      return new Response(payload, {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=30"
        }
      });
    }
    return env.ASSETS.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-scheduled.ts
var scheduled = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  const url = new URL(request.url);
  if (url.pathname === "/__scheduled") {
    const cron = url.searchParams.get("cron") ?? "";
    await middlewareCtx.dispatch("scheduled", { cron });
    return new Response("Ran scheduled event");
  }
  const resp = await middlewareCtx.next(request, env);
  if (request.headers.get("referer")?.endsWith("/__scheduled") && url.pathname === "/favicon.ico" && resp.status === 500) {
    return new Response(null, { status: 404 });
  }
  return resp;
}, "scheduled");
var middleware_scheduled_default = scheduled;

// .wrangler/tmp/bundle-HFOTTU/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_scheduled_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-HFOTTU/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
