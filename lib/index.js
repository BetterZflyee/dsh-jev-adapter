/**
 * dsh-jev-adapter — Cordis plugin entry for DeepSeek Harness.
 *
 * Registers one model tool, `jev_decide`, that runs the Jev (System One)
 * decision-model paradigm over either:
 *   - channel "openai": any OpenAI-compatible chat endpoint (default), or
 *   - channel "typesafe": the official TypeSafe Jev API.
 *
 * Plain JavaScript only — this file runs inside the dsh plugin runtime.
 * @module dsh-jev-adapter
 */
import { buildTool } from './tool.js';

export default {
  apply(ctx) {
    const cfg = ctx.config ?? {};
    const tool = buildTool({
      channel: cfg.channel,
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      maxTokens: cfg.maxTokens,
      timeoutMs: cfg.timeoutMs,
      retries: cfg.retries,
    });
    const dispose = ctx.tools.register(tool);
    ctx.effect(() => dispose());
    ctx.logger?.info?.(
      `dsh-jev-adapter: jev_decide registered (channel=${cfg.channel || 'openai'})`,
    );
  },
};
