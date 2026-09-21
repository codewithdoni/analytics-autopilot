import { buildAgent, buildInstructions } from './agent.js';

/**
 * Offline check (no network, no credentials): the agent builds, every tool's zod
 * schema converts to a strict JSON schema the OpenAI API accepts, and the
 * instructions render with the catalog brief.
 */
const agent = buildAgent();
let problems = 0;
for (const t of agent.tools) {
  if (t.type !== 'function') continue;
  const schema = t.parameters as { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  const props = Object.keys(schema.properties ?? {});
  const missing = props.filter((p) => !(schema.required ?? []).includes(p));
  const ok = t.strict && missing.length === 0 && schema.additionalProperties === false;
  if (!ok) problems++;
  console.log(`${ok ? '✓' : '✗'} ${t.name} (${props.length} params${missing.length ? `, not required: ${missing.join(',')}` : ''})`);
}
const instructions = await buildInstructions(process.env.DEFAULT_APP ?? 'plusfit');
console.log(`\nInstructions: ${instructions.length} chars`);
console.log(instructions.split('\n').slice(-12).join('\n'));
process.exit(problems > 0 ? 1 : 0);
