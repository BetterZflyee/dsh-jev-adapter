/**
 * The Jev adapter: turns any OpenAI-compatible chat endpoint into a
 * System One style decision engine.
 *
 * You send a state plus typed questions (choice / score / boolean);
 * it returns one calibrated-looking answer per question with
 * probabilities and a confidence score, in a single request.
 *
 * This mirrors what TypeSafe's official system-one-adapter does for
 * Python, reimplemented for the dsh plugin runtime with the extra
 * behaviours we validated on real Chinese-language work items:
 *
 *  - prompts the model to spread probability honestly instead of
 *    collapsing to a fake 1.0 (without this, confidence saturates
 *    and the low-confidence routing signal is lost);
 *  - tolerates thinking models whose answer lands in reasoning_content;
 *  - normalises probabilities that do not sum to 1;
 *  - retries with backoff on 429 / 5xx.
 *
 * @module dsh-jev-adapter/adapter
 */

/** Default endpoints and models per channel. */
export const DEFAULTS = {
  openai: {
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKeyEnv: ['JEV_OPENAI_API_KEY', 'OPENAI_API_KEY'],
  },
  typesafe: {
    baseURL: 'https://api.typesafe.ai/v1',
    model: 'jev-latest',
    apiKeyEnv: ['JEV_TYPESAFE_API_KEY', 'TYPESAFE_API_KEY'],
  },
};

/* ------------------------------------------------------------------ */
/* Question helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Normalise a question's criteria into a flat candidate list.
 * choice → [{name, desc}] from the criteria object/array
 * score  → [{name: '0', desc}, ...] ordered levels
 */
export function candidatesOf(q) {
  const c = q.criteria;
  if (q.type === 'choice') {
    if (Array.isArray(c)) return c.map((d, i) => ({ name: String(i), desc: d }));
    if (c && typeof c === 'object')
      return Object.keys(c).map((k) => ({ name: k, desc: c[k] }));
    return [];
  }
  if (q.type === 'score') {
    const arr = Array.isArray(c) ? c : [];
    return arr.map((d, i) => ({ name: String(i), desc: d }));
  }
  return [];
}

/**
 * Build the decision prompt. The honesty clause is deliberate:
 * without it models output hard 0/1 probabilities, confidence
 * saturates at 1.0, and the caller cannot tell "sure" from "guessing".
 */
export function buildPrompt(state, questions) {
  const lines = [
    'You are a decision scorer. Given the STATE, output a probability distribution over the candidates for every question.',
    'Rules:',
    '1. Probabilities must reflect your genuine judgement. Never spread them uniformly out of laziness. The probabilities of each question must sum to 1.',
    '2. If you are genuinely uncertain, spread the probability across multiple candidates honestly — do NOT force a fake 1.0 onto one option. Your uncertainty is itself a useful signal: the caller routes on it (auto / ask-a-human / escalate), and a dishonest 1.0 breaks that mechanism. Only assign near-1 probabilities when the evidence is unambiguous.',
    '3. Output ONLY JSON. No explanations, no markdown fences.',
    '4. Use the given candidate names exactly as JSON keys.',
    '',
    '── STATE ──',
    typeof state === 'string' ? state : JSON.stringify(state, null, 2),
    '',
    '── QUESTIONS ──',
  ];
  const shape = {};
  let i = 0;
  for (const id of Object.keys(questions)) {
    i += 1;
    const q = questions[id];
    lines.push(`${i}. ${id} [${q.type}] ${q.instructions}`);
    if (q.type === 'boolean') {
      lines.push('   Output your estimate of P(true), between 0 and 1.');
      shape[id] = { probability: 0.0 };
    } else {
      const cands = candidatesOf(q);
      lines.push(
        `   Candidates (${cands.length}): ` +
          cands.map((c) => `${c.name}=${c.desc ?? ''}`).join(' / '),
      );
      lines.push(
        q.type === 'score'
          ? '   Output the probability of each level (levels numbered from 0 in the order listed).'
          : '   Output the probability of each candidate.',
      );
      const probs = {};
      cands.forEach((c) => {
        probs[c.name] = 0.0;
      });
      shape[id] = { probabilities: probs };
    }
  }
  lines.push('', '── OUTPUT (this JSON only) ──', JSON.stringify(shape, null, 2));
  return lines.join('\n');
}

/** Extract the first JSON object from a raw model output. */
export function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) return null;
  try {
    return JSON.parse(t.slice(s, e + 1));
  } catch {
    return null;
  }
}

/**
 * Confidence of a distribution: how concentrated it is.
 * Uniform → 0, all mass on one candidate → 1.
 * This mirrors the shape of Jev's confidence statistic (not its
 * calibration — see the caveat attached to every result).
 */
export function confidenceOf(probs, n) {
  if (n <= 1) return 1;
  const maxP = Math.max(...probs);
  const c = (maxP - 1 / n) / (1 - 1 / n);
  return Math.max(0, Math.min(1, Number(c.toFixed(4))));
}

/* ------------------------------------------------------------------ */
/* Channel execution                                                   */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callOpenAiCompatible(cfg, prompt) {
  let lastErr = '';
  for (let attempt = 0; attempt < cfg.retries; attempt += 1) {
    if (attempt) await sleep(1500 * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch(`${cfg.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: 'You are a rigorous decision scorer. Output JSON only.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: cfg.maxTokens,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
    } catch (e) {
      lastErr = `network error: ${e.message}`;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = `HTTP ${res.status} (retrying)`;
      continue;
    }
    if (!res.ok) {
      lastErr = `HTTP ${res.status}: ${(await res.text()).slice(0, 250)}`;
      break;
    }
    const data = await res.json();
    // Thinking models often leave content empty and put the answer
    // in reasoning_content; read both.
    const msg = data.choices?.[0]?.message ?? {};
    return {
      raw: (msg.content && String(msg.content).trim()) || msg.reasoning_content || '',
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          }
        : undefined,
    };
  }
  throw new Error(`${cfg.channel} channel failed: ${lastErr}`);
}

/* ------------------------------------------------------------------ */
/* Result assembly                                                     */
/* ------------------------------------------------------------------ */

function assembleAnswers(questions, parsed) {
  const answers = {};
  for (const id of Object.keys(questions)) {
    const q = questions[id];
    const a = parsed[id];
    if (!a) continue;
    if (q.type === 'boolean') {
      let p = Number(a.probability ?? a.p);
      if (!Number.isFinite(p)) continue;
      p = Math.max(0, Math.min(1, p));
      answers[id] = { type: 'boolean', probability: Number(p.toFixed(4)) };
    } else {
      const cands = candidatesOf(q);
      if (!cands.length) continue;
      let probs = cands.map((c) => {
        const v = Number(a.probabilities?.[c.name]);
        return Number.isFinite(v) && v >= 0 ? v : 0;
      });
      const sum = probs.reduce((x, y) => x + y, 0);
      if (sum <= 0) {
        // All-zero answer degrades to uniform rather than failing.
        probs = cands.map(() => 1 / cands.length);
      } else {
        probs = probs.map((v) => v / sum);
      }
      const norm = {};
      cands.forEach((c, k) => {
        norm[c.name] = Number(probs[k].toFixed(4));
      });
      const conf = confidenceOf(probs, cands.length);
      if (q.type === 'choice') {
        const best = probs.indexOf(Math.max(...probs));
        answers[id] = {
          type: 'choice',
          choice: cands[best].name,
          probabilities: norm,
          confidence: conf,
        };
      } else {
        const score = probs.reduce((acc, p, k) => acc + p * Number(cands[k].name), 0);
        answers[id] = {
          type: 'score',
          score: Number(score.toFixed(4)),
          probabilities: norm,
          confidence: conf,
        };
      }
    }
  }
  return answers;
}

/**
 * Run one decision request.
 *
 * @param {object} opts
 * @param {string} opts.channel  'openai' | 'typesafe'
 * @param {string} [opts.baseURL]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]
 * @returns {Promise<object>} the decision result
 */
export async function decide(opts, state, questions) {
  const channel = opts.channel === 'typesafe' ? 'typesafe' : 'openai';
  const def = DEFAULTS[channel];
  const cfg = {
    channel,
    baseURL: (opts.baseURL || def.baseURL).replace(/\/$/, ''),
    apiKey: opts.apiKey || resolveKey(def.apiKeyEnv),
    model: opts.model || def.model,
    maxTokens: opts.maxTokens || 4000,
    timeoutMs: opts.timeoutMs || 120000,
    retries: opts.retries ?? 3,
  };
  if (!cfg.apiKey) {
    throw new Error(
      `No API key for the "${channel}" channel. Set ${def.apiKeyEnv[0]} or pass apiKey in the plugin config.`,
    );
  }

  const prompt = buildPrompt(state, questions);
  const { raw, usage } = await callOpenAiCompatible(cfg, prompt);
  const parsed = extractJson(raw);
  if (!parsed) {
    throw new Error(
      `Could not parse JSON from model output (first 200 chars: ${String(raw).slice(0, 200)})`,
    );
  }
  const answers = assembleAnswers(questions, parsed);
  if (!Object.keys(answers).length) {
    throw new Error('Model output JSON matched none of the question IDs');
  }
  return {
    channel: channel === 'typesafe' ? 'typesafe-direct' : `openai-compatible (${cfg.model})`,
    answers,
    caveat:
      channel === 'typesafe'
        ? 'Probabilities come from the official Jev API.'
        : 'Probabilities are the LLM\u2019s self-reported estimates, not mathematically calibrated. Review high-risk decisions manually.',
    usage,
  };
}

/** Try env vars in order; undefined when none is set. */
function resolveKey(envNames) {
  if (typeof process === 'undefined') return undefined;
  for (const name of envNames) {
    const v = process.env?.[name];
    if (v) return v;
  }
  return undefined;
}
