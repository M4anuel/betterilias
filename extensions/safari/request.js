// Bound both response headers and JSON body reading. Race the operation as well
// as aborting fetch so a stalled browser request cannot leave the popup checking.
globalThis.BetterIliasRequest = async (url, options, timeoutMessage, timeoutMs = 20000) => {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        return { response, data };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(timeoutMessage));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
