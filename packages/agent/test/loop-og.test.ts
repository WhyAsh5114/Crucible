import { describe, expect, test } from 'bun:test';
import {
  classifyRouterError,
  filterOgTraceFromStream,
  ogFallbackReasonOf,
  type OgTrace,
} from '../src/loop.ts';

// ---------- classifyRouterError ----------

describe('classifyRouterError', () => {
  test('429 → rate_limited', () => {
    expect(classifyRouterError(429, '')).toBe('rate_limited');
    expect(classifyRouterError(429, 'Too Many Requests')).toBe('rate_limited');
  });

  test('402 → balance_exhausted', () => {
    expect(classifyRouterError(402, '')).toBe('balance_exhausted');
  });

  test('"insufficient balance" body → balance_exhausted regardless of status', () => {
    expect(classifyRouterError(400, 'insufficient balance on account')).toBe('balance_exhausted');
    // Case-insensitive
    expect(classifyRouterError(400, 'Insufficient  Balance')).toBe('balance_exhausted');
    // 402 + body mentioning balance
    expect(classifyRouterError(402, 'insufficient balance')).toBe('balance_exhausted');
  });

  test('other statuses → provider_unavailable', () => {
    expect(classifyRouterError(500, '')).toBe('provider_unavailable');
    expect(classifyRouterError(503, 'Service Unavailable')).toBe('provider_unavailable');
    expect(classifyRouterError(400, 'bad request')).toBe('provider_unavailable');
  });
});

// ---------- ogFallbackReasonOf ----------

describe('ogFallbackReasonOf', () => {
  test('returns undefined for non-OgRouterError', () => {
    expect(ogFallbackReasonOf(new Error('generic'))).toBeUndefined();
    expect(ogFallbackReasonOf(null)).toBeUndefined();
    expect(ogFallbackReasonOf('string error')).toBeUndefined();
  });
});

// ---------- filterOgTraceFromStream ----------

/** Encode a string as a ReadableStream<Uint8Array> */
function encodeStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

/** Drain a ReadableStream<Uint8Array> to a string */
async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: !done });
  }
  return result;
}

describe('filterOgTraceFromStream', () => {
  test('passes through normal SSE chunks unchanged', async () => {
    const input = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n' + 'data: [DONE]\n';
    const output = await drainStream(filterOgTraceFromStream(encodeStream(input)));
    expect(output).toContain('"choices"');
    expect(output).toContain('[DONE]');
  });

  test('strips x_0g_trace-only chunks and calls onTrace callback', async () => {
    const trace: OgTrace = {
      request_id: 'req-123',
      provider: 'test-provider',
      billing: { total_cost: '0.001' },
      tee_verified: true,
    };
    const input =
      'data: {"choices":[{"delta":{"content":"world"}}]}\n' +
      `data: {"x_0g_trace":${JSON.stringify(trace)}}\n` +
      'data: [DONE]\n';

    const captured: OgTrace[] = [];
    const output = await drainStream(
      filterOgTraceFromStream(encodeStream(input), (t) => captured.push(t)),
    );

    expect(output).toContain('"choices"');
    expect(output).not.toContain('x_0g_trace');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.request_id).toBe('req-123');
    expect(captured[0]!.tee_verified).toBe(true);
  });

  test('passes through non-JSON data lines unchanged', async () => {
    const input = 'data: not-json\n';
    const output = await drainStream(filterOgTraceFromStream(encodeStream(input)));
    expect(output).toContain('data: not-json');
  });

  test('passes through data lines with multiple keys unchanged', async () => {
    const input = 'data: {"x_0g_trace":{},"choices":[]}\n';
    const output = await drainStream(filterOgTraceFromStream(encodeStream(input)));
    expect(output).toContain('"x_0g_trace"');
  });
});
