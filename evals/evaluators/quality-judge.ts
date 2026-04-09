import type { AgentResponse } from '@voxpopuli/shared-types';
import type { EvaluatorResult } from '../types';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MODEL = 'mistral-large-latest';

interface QualityVerdict {
  quality: string;
  verdict: 'PRESENT' | 'ABSENT';
}

/**
 * LLM-as-judge evaluator that uses the Mistral API to check whether
 * an agent's answer exhibits each expected quality.
 *
 * Score = count of PRESENT verdicts / total expected qualities.
 */
export async function evaluateQualityChecklist(
  response: AgentResponse | null,
  expectedQualities: string[],
): Promise<EvaluatorResult> {
  const key = 'quality_checklist';

  if (!response || expectedQualities.length === 0) {
    return { key, score: 0 };
  }

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return { key, score: 0, comment: 'No MISTRAL_API_KEY configured' };
  }

  const qualitiesList = expectedQualities.map((q, i) => `${i + 1}. ${q}`).join('\n');

  const systemPrompt =
    'You are an eval judge. Given an answer and a list of expected qualities, evaluate each quality as PRESENT or ABSENT. Respond with ONLY a JSON array of objects: [{"quality": "...", "verdict": "PRESENT"|"ABSENT"}]';

  const userMessage = `Answer: ${response.answer}\n\nExpected qualities:\n${qualitiesList}\n\nEvaluate each quality. Respond with ONLY valid JSON.`;

  let verdicts: QualityVerdict[];

  try {
    const res = await fetch(MISTRAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return { key, score: 0, comment: `Mistral API error: HTTP ${res.status} — ${errText}` };
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    let content = data.choices[0].message.content.trim();

    // Strip markdown code fences (```json ... ``` or ``` ... ```)
    if (content.startsWith('```')) {
      content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    verdicts = JSON.parse(content) as QualityVerdict[];
  } catch (err) {
    return { key, score: 0, comment: `Failed to parse LLM judge response: ${String(err)}` };
  }

  const presentCount = verdicts.filter((v) => v.verdict === 'PRESENT').length;
  const total = expectedQualities.length;
  const score = presentCount / total;

  const details = verdicts.map((v) => `${v.quality}: ${v.verdict}`).join(', ');

  return {
    key,
    score,
    comment: `${presentCount}/${total} qualities present (${details})`,
  };
}
