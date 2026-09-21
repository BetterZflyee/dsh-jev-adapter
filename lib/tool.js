/**
 * The jev_decide model tool.
 *
 * Tool schema notes: dsh validates JSON Schema strictly —
 *  - `additionalProperties` must be an explicit boolean (not a subschema);
 *  - the parameter root must stay open (omit additionalProperties);
 *  - `output` must declare { schema, render }.
 * These constraints shaped the schema below.
 * @module dsh-jev-adapter/tool
 */

export const JEV_DECIDE_TOOL = {
  name: 'jev_decide',
  description: [
    'Run a structured decision over one state: send typed questions (choice / score / boolean) and get back probability-distributed answers in a single call.',
    '',
    'Good for high-frequency atomic judgements: classification, routing, scoring, fact-checking, dedup, quality-gating another model\u2019s output.',
    'Not for text generation, explanations, or multi-step reasoning — use a normal model for those.',
    '',
    'You may ask many questions in one call; 1 and 10 questions cost about the same, so batch every judgement you might need.',
    'Each question must be one atomic, single-dimension judgement; compose complex logic from the answers yourself.',
    'choice and score answers include probabilities and a confidence score (distribution shape, 0-1, NOT a correctness guarantee);',
    'boolean answers return probability = P(true) with no confidence.',
    'Route on risk: higher-risk actions need higher confidence; low confidence goes to a human.',
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      state: {
        type: 'string',
        description:
          'The state / context to judge. A string, or a JSON-serialised object (preferred: name each relevant field — ticket, order, policy… — the model reads the state once and answers every question against it).',
      },
      questions: {
        type: 'object',
        additionalProperties: true,
        description:
          'Question map: questionId \u2192 question object {type, instructions, criteria}. type is one of: choice (criteria = object of option\u2192description, up to 255 options) / score (criteria = array of level descriptions, low\u2192high, 2-10 levels) / boolean (criteria optional). instructions say what to judge — direct, single-dimension wording works best. questionId is only used to key the answers.',
      },
    },
    required: ['state', 'questions'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: true,
      description:
        'Decision result: { channel, answers: { questionId: { type, choice|score|probability, probabilities?, confidence? } }, caveat, usage? }',
    },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: null, // bound at registration time with the channel config
};

/**
 * Create the execute function closed over the plugin config.
 * @returns {function} the async execute(args) for the tool
 */
export function makeExecute(adapterConfig) {
  return async (args) => {
    const { state, questions } = args ?? {};
    if (state == null) throw new Error('state is required');
    if (!questions || typeof questions !== 'object' || !Object.keys(questions).length) {
      throw new Error('questions is required (at least one question)');
    }
    const { decide } = await import('./adapter.js');
    return decide(adapterConfig, state, questions);
  };
}

/** Bind the tool definition to a config and return the complete tool. */
export function buildTool(adapterConfig) {
  return { ...JEV_DECIDE_TOOL, execute: makeExecute(adapterConfig) };
}
