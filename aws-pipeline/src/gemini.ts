import { GoogleGenAI, Type } from '@google/genai';

export { Type };
export type JsonSchema = Record<string, any>;

export async function generateJsonWithClient<T>(client: Pick<GoogleGenAI, 'models'>, model: string, systemInstruction: string, prompt: string, responseSchema: JsonSchema, maxOutputTokens = 4096): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema,
          maxOutputTokens,
          temperature: 0.1,
          abortSignal: AbortSignal.timeout(25_000),
        },
      });
      if (!response.text) {
        const error = new Error('Gemini returned an empty response');
        error.name = 'MalformedModelOutput';
        throw error;
      }
      try { return JSON.parse(response.text) as T; }
      catch {
        const error = new Error('Gemini returned invalid JSON');
        error.name = 'MalformedModelOutput';
        throw error;
      }
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.status || error?.statusCode || error?.code);
      const retryable = status === 429 || status >= 500 || error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.name === 'MalformedModelOutput';
      if (!retryable || attempt > 0) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  // Do not expose provider messages, prompts, or candidate text through API responses.
  const safe = new Error('Gemini request failed');
  safe.name = lastError?.name === 'TimeoutError' || lastError?.name === 'AbortError' ? 'GeminiTimeout' : lastError?.name === 'MalformedModelOutput' ? 'GeminiInvalidResponse' : 'GeminiUnavailable';
  throw safe;
}

export async function generateJson<T>(systemInstruction: string, prompt: string, responseSchema: JsonSchema, maxOutputTokens = 4096): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini is not configured');
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const client = new GoogleGenAI({ apiKey });
  return generateJsonWithClient<T>(client, model, systemInstruction, prompt, responseSchema, maxOutputTokens);
}

export const textSchema = { type: Type.STRING };
export const stringArraySchema = { type: Type.ARRAY, items: textSchema };
export const stringListObject = (properties: string[]) => ({
  type: Type.OBJECT,
  properties: Object.fromEntries(properties.map(key => [key, textSchema])),
  required: properties,
  propertyOrdering: properties,
});
