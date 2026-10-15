const http = require('http');
const https = require('https');

function sdkJson(urlString, { method = 'GET', apiKey, body, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = body === undefined ? null : JSON.stringify(body);
    let timer;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method,
      headers: { 'X-Hyper-Api-Key': apiKey, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('error', error => { error.postingOutcomeUnknown = method === 'POST'; finish(error); });
      response.on('aborted', () => {
        const error = new Error('Sage SDK response interrupted; verify Sage before retrying.');
        error.postingOutcomeUnknown = method === 'POST';
        finish(error);
      });
      response.on('end', () => {
        let result;
        try {
          result = JSON.parse(text);
          if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid response');
        } catch (_) {
          const error = new Error('Invalid Sage SDK response; verify Sage before retrying.');
          error.postingOutcomeUnknown = method === 'POST';
          return finish(error);
        }
        if (response.statusCode >= 200 && response.statusCode < 300) return finish(null, result);
        const error = new Error(result.exceptionMessage || result.message || result.Message || `Sage SDK HTTP ${response.statusCode}`);
        error.statusCode = response.statusCode;
        error.response = result;
        error.postingOutcomeUnknown = method === 'POST' && ![401, 403].includes(response.statusCode);
        finish(error);
      });
    });
    request.on('error', error => { error.postingOutcomeUnknown = method === 'POST'; finish(error); });
    timer = setTimeout(() => {
      const error = new Error(`Sage SDK ${method} exceeded ${timeoutMs / 1000}s. ${method === 'POST' ? 'Posting outcome unknown: verify Sage before retrying.' : 'Stock refresh timed out.'}`);
      error.code = 'SDK_REQUEST_TIMEOUT';
      error.postingOutcomeUnknown = method === 'POST';
      finish(error);
      request.destroy();
    }, timeoutMs);
    if (payload) request.write(payload);
    request.end();
  });
}

module.exports = { sdkJson };
