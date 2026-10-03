// Upload progress describes browser transfer only; server-side storage follows it.
export function sendUpload(url, { body, headers, onProgress = () => {}, timeout = 180000, createRequest = () => new XMLHttpRequest() }) {
  return new Promise((resolve, reject) => {
    const request = createRequest();
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      if (error) reject(error); else resolve(result);
    };
    const deadline = setTimeout(() => {
      finish(new Error('upload_timeout'));
      request.abort();
    }, timeout);
    try {
      request.open('POST', url);
      request.timeout = timeout;
      request.withCredentials = false;
      for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
      request.upload.onprogress = event => onProgress(event.lengthComputable ? Math.floor(event.loaded / event.total * 100) : null);
      request.upload.onload = () => onProgress(100);
      request.onerror = () => finish(new Error('upload_network'));
      request.onabort = () => finish(new Error('upload_timeout'));
      request.ontimeout = () => finish(new Error('upload_timeout'));
      request.onload = () => {
        let result;
        try { result = JSON.parse(request.responseText); } catch { finish(new Error('upload_response')); return; }
        if (request.status < 200 || request.status >= 300 || result?.error) finish(new Error(result?.error ?? 'upload_response'));
        else if (!result?.submission?.id) finish(new Error('upload_response'));
        else finish(null, result);
      };
      request.send(body);
    } catch (error) { finish(error); }
  });
}

// A lost response is not proof of failure. Confirm the exact submission before retrying.
export async function uploadWithRecovery(send, lookup, submissionId) {
  try { return (await send()).submission; }
  catch (error) {
    if (!['upload_timeout', 'upload_network', 'upload_response', 'unavailable', 'conflict'].includes(error.message)) throw error;
    try {
      const { submissions } = await lookup();
      const saved = submissions.find(item => item.id === submissionId);
      if (saved?.package_ready && ['draft', 'pending', 'approved'].includes(saved.status)) return saved;
    } catch { /* Preserve the original failure when status cannot be confirmed. */ }
    throw error;
  }
}
