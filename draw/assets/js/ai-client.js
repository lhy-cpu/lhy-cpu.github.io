(function (root) {
  'use strict';

  const RESPONSE_LIMIT = 2 * 1024 * 1024;
  const ARGUMENT_LIMIT = 1024 * 1024;
  const CALL_LIMIT = 100;
  const encoder = new TextEncoder();
  const localErrors = new WeakSet();
  const fail = (message) => { const error = new Error(message); localErrors.add(error); return error; };

  function endpoint(value) {
    let url;
    try { url = new URL(value); } catch (_) { throw fail('API 地址无效，请输入完整的 HTTP 或 HTTPS 地址。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
      throw fail('API 地址仅支持 HTTP/HTTPS，且不能包含用户名、密码、查询参数或片段。');
    }
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = !path ? '/v1/chat/completions' : path.endsWith('/chat/completions') ? path : path + '/chat/completions';
    return url.href;
  }

  function httpError(status) {
    const advice = status === 401 || status === 403 ? '请检查 API Key 及访问权限。'
      : status === 429 ? '请求过于频繁或额度不足，请稍后重试并检查额度。'
      : status === 404 ? '请检查 API 地址和模型名称。'
      : status >= 500 ? '服务暂时异常，请稍后重试。' : '请检查请求参数和服务配置。';
    return fail('API 请求失败（HTTP ' + status + '）。' + advice);
  }

  function finish(reason) {
    if (reason === 'length') throw fail('模型输出被长度限制截断，未执行任何操作。请提高输出限额或缩短请求。');
    if (reason === 'content_filter') throw fail('模型输出被内容过滤中断，未执行任何操作。');
    if (reason !== 'stop' && reason !== 'tool_calls') throw fail('API 响应缺少有效的结束原因，未执行任何操作。');
  }

  function validateCalls(calls) {
    if (calls === undefined || calls === null) return undefined;
    if (!Array.isArray(calls) || calls.length > CALL_LIMIT) throw fail('API 工具调用格式无效或数量超过限制。');
    let bytes = 0;
    const ids = new Set();
    return calls.map((call) => {
      if (!call || typeof call.id !== 'string' || !call.id || ids.has(call.id) || call.type !== 'function' ||
        !call.function || typeof call.function.name !== 'string' || !call.function.name || typeof call.function.arguments !== 'string') {
        throw fail('API 工具调用不完整或格式无效，未执行任何操作。');
      }
      ids.add(call.id);
      bytes += encoder.encode(call.function.arguments).byteLength;
      if (bytes > ARGUMENT_LIMIT) throw fail('API 工具参数超过 1MB 限制。');
      return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } };
    });
  }

  function result(content, calls, reason) {
    finish(reason);
    if (content !== null && typeof content !== 'string') throw fail('API 消息内容格式无效。');
    const normalized = validateCalls(calls);
    if (reason === 'tool_calls' && (!normalized || !normalized.length)) throw fail('API 工具调用缺失，未执行任何操作。');
    const message = { role: 'assistant', content };
    if (normalized && normalized.length) message.tool_calls = normalized;
    return message;
  }

  async function readBody(response, onChunk) {
    if (!response.body || typeof response.body.getReader !== 'function') throw fail('API 响应正文缺失。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let completed = false;
    let semanticEnd = false;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > RESPONSE_LIMIT) throw fail('API 响应超过 2MB 限制。');
        let text;
        try { text = decoder.decode(part.value, { stream: true }); } catch (_) { throw fail('API 响应不是有效的 UTF-8 文本。'); }
        // The consumer inspects the whole decoded chunk before signalling its
        // protocol terminator. SSE completion need not close the HTTP body.
        if (onChunk(text) === true) { semanticEnd = true; break; }
      }
      let tail;
      try { tail = decoder.decode(); } catch (_) { throw fail('API 响应包含不完整的 UTF-8 文本。'); }
      onChunk(tail);
      completed = true;
    } finally {
      if (semanticEnd || !completed) {
        // Cancellation can itself wait on a persistent transport. Initiate it
        // without making the completed response depend on its cleanup promise.
        try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) { /* preserve the original error */ }
      }
      reader.releaseLock();
    }
  }

  async function readJSON(response) {
    let body = '';
    await readBody(response, (text) => { body += text; });
    let data;
    try { data = JSON.parse(body); } catch (_) { throw fail('API 返回的 JSON 无效，未执行任何操作。'); }
    if (data && data.error) throw fail('API 返回错误，未执行任何操作。请检查服务配置。');
    const choice = data && Array.isArray(data.choices) && data.choices[0];
    if (!choice || !choice.message || choice.message.role !== 'assistant') throw fail('API 响应缺少有效的助手消息。');
    return result(choice.message.content == null ? null : choice.message.content, choice.message.tool_calls, choice.finish_reason);
  }

  async function readSSE(response, onDelta) {
    let buffer = '';
    let dataLines = [];
    let text = '';
    let hasContent = false;
    let done = false;
    let finishReason = null;
    let argumentBytes = 0;
    const calls = new Map();
    function dispatch() {
      if (!dataLines.length) return;
      const data = dataLines.join('\n');
      dataLines = [];
      if (done) throw fail('API 流在结束标记之后仍返回数据。');
      if (data === '[DONE]') { done = true; return; }
      let chunk;
      try { chunk = JSON.parse(data); } catch (_) { throw fail('API 流包含无效的 JSON，未执行任何操作。'); }
      if (chunk && chunk.error) throw fail('API 流返回错误，未执行任何操作。请检查服务配置。');
      if (!chunk || !Array.isArray(chunk.choices)) throw fail('API 流响应格式无效。');
      if (!chunk.choices.length) {
        if (!chunk.usage) throw fail('API 流缺少消息数据。');
        return;
      }
      const choice = chunk.choices.find((item) => item && item.index === 0);
      if (!choice || !choice.delta || typeof choice.delta !== 'object' || Array.isArray(choice.delta)) throw fail('API 流缺少有效的消息增量。');
      const delta = choice.delta;
      if (delta.role !== undefined && delta.role !== 'assistant') throw fail('API 流消息角色无效。');
      if (finishReason !== null) throw fail('API 流在消息结束后仍返回消息增量。');
      if (delta.content !== undefined && delta.content !== null) {
        if (typeof delta.content !== 'string') throw fail('API 流消息内容格式无效。');
        hasContent = true;
        text += delta.content;
        if (delta.content && onDelta) onDelta(delta.content, text);
      }
      if (delta.tool_calls !== undefined) {
        if (!Array.isArray(delta.tool_calls)) throw fail('API 流工具调用格式无效。');
        for (const part of delta.tool_calls) {
          if (!part || !Number.isInteger(part.index) || part.index < 0 || part.index >= CALL_LIMIT) throw fail('API 流工具调用索引无效或数量超过限制。');
          let call = calls.get(part.index);
          if (!call) {
            call = { id: '', type: 'function', function: { name: '', arguments: '' } };
            calls.set(part.index, call);
          }
          if (part.type !== undefined && part.type !== 'function') throw fail('API 流工具类型无效。');
          if (part.id !== undefined) {
            if (typeof part.id !== 'string') throw fail('API 流工具标识格式无效。');
            call.id += part.id;
          }
          if (part.function !== undefined) {
            if (!part.function || typeof part.function !== 'object' || Array.isArray(part.function)) throw fail('API 流工具参数格式无效。');
            for (const field of ['name', 'arguments']) {
              if (part.function[field] !== undefined) {
                if (typeof part.function[field] !== 'string') throw fail('API 流工具参数格式无效。');
                call.function[field] += part.function[field];
                if (field === 'arguments') argumentBytes += encoder.encode(part.function[field]).byteLength;
              }
            }
            if (argumentBytes > ARGUMENT_LIMIT) throw fail('API 工具参数超过 1MB 限制。');
          }
        }
      }
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        finish(choice.finish_reason);
        finishReason = choice.finish_reason;
      }
    }
    function line(value) {
      if (!value) { dispatch(); return; }
      if (value.startsWith(':')) return;
      const colon = value.indexOf(':');
      const field = colon < 0 ? value : value.slice(0, colon);
      let valueText = colon < 0 ? '' : value.slice(colon + 1);
      if (valueText.startsWith(' ')) valueText = valueText.slice(1);
      if (field === 'data') dataLines.push(valueText);
      else if (field === 'event' && valueText === 'error') throw fail('API 流返回错误事件，未执行任何操作。');
    }
    await readBody(response, (chunk) => {
      buffer += chunk;
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] !== '\r' && buffer[i] !== '\n') continue;
        if (buffer[i] === '\r' && i === buffer.length - 1) break;
        line(buffer.slice(start, i));
        if (buffer[i] === '\r' && buffer[i + 1] === '\n') i++;
        start = i + 1;
      }
      buffer = buffer.slice(start);
      return done;
    });
    if (buffer) line(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer);
    dispatch();
    if (!done || finishReason === null) throw fail('API 流意外中断或缺少结束标记，未执行任何操作。');
    const indices = [...calls.keys()].sort((a, b) => a - b);
    if (indices.some((index, position) => index !== position)) throw fail('API 流工具调用序号不完整，未执行任何操作。');
    return result(hasContent ? text : null, indices.map((index) => calls.get(index)), finishReason);
  }

  async function complete({ config, messages, tools, signal, onDelta }) {
    if (!config || typeof config.model !== 'string' || !config.model.trim() || !Array.isArray(messages)) throw fail('请配置模型并提供有效的消息列表。');
    const url = endpoint(config.apiUrl);
    const headers = { 'Content-Type': 'application/json', Accept: config.stream ? 'text/event-stream' : 'application/json' };
    if (config.key) headers.Authorization = 'Bearer ' + config.key;
    const body = { model: config.model, messages, stream: !!config.stream };
    if (config.mode === 'tools') { body.tools = tools || []; body.tool_choice = 'auto'; }
    let responseReceived = false;
    try {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal,
        credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
      responseReceived = true;
      if (!response.ok) throw httpError(response.status);
      return await (config.stream ? readSSE(response, onDelta) : readJSON(response));
    } catch (error) {
      if ((signal && signal.aborted) || (error && error.name === 'AbortError')) throw fail('API 请求已取消或超时。');
      // Only our fixed, local messages are shown; network/server errors may contain credentials.
      if (error && localErrors.has(error)) throw error;
      if (!responseReceived) {
        const connectionError = fail('浏览器无法连接 API；可能是 API 供应商或其网关未允许跨域（CORS）。请联系供应商，允许当前网页来源、Content-Type / Authorization 请求头及 OPTIONS 预检；同时检查网络、API 地址和 HTTPS 配置。');
        connectionError.code = 'NETWORK_OR_CORS';
        throw connectionError;
      }
      throw fail('API 响应读取中断，未执行任何操作。请检查网络连接或联系 API 供应商。');
    }
  }

  root.FlowSketchAIClient = Object.freeze({ endpoint, complete });
})(typeof window !== 'undefined' ? window : globalThis);
