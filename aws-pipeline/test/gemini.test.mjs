import test from 'node:test';
import assert from 'node:assert/strict';

const { generateJsonWithClient } = await import('../src/gemini.ts');

test('Gemini request uses JSON mode, the configured schema, and bounded output', async () => {
  let request;
  const client = { models:{ async generateContent(value) { request=value; return { text:'{"skills":["TypeScript"]}' }; } } };
  const result = await generateJsonWithClient(client, 'test-model', 'system', 'prompt', { type:'OBJECT' }, 1234);
  assert.deepEqual(result, { skills:['TypeScript'] });
  assert.equal(request.model, 'test-model');
  assert.equal(request.config.responseMimeType, 'application/json');
  assert.deepEqual(request.config.responseSchema, { type:'OBJECT' });
  assert.equal(request.config.maxOutputTokens, 1234);
  assert.ok(request.config.abortSignal instanceof AbortSignal);
});

test('malformed model output receives one retry and returns parsed JSON', async () => {
  let calls=0;
  const client={models:{async generateContent(){calls++;return {text:calls===1?'not json':'{"ok":true}'};}}};
  assert.deepEqual(await generateJsonWithClient(client,'test-model','system','prompt',{type:'OBJECT'}),{ok:true});
  assert.equal(calls,2);
});

test('non-retryable Gemini errors are sanitized and do not leak provider details', async () => {
  const client={models:{async generateContent(){const error=new Error('private key and prompt leaked');error.status=401;throw error;}}};
  await assert.rejects(generateJsonWithClient(client,'test-model','system','sensitive prompt',{type:'OBJECT'}), error => {
    assert.equal(error.name,'GeminiUnavailable');
    assert.equal(error.message,'Gemini request failed');
    assert.equal(error.message.includes('private key'),false);
    return true;
  });
});
