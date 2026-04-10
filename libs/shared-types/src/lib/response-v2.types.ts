import { z } from 'zod';

/** A themed section of the agent's prose response. */
export const ResponseSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
  citedSources: z.array(z.number()),
});
export type ResponseSection = z.infer<typeof ResponseSectionSchema>;

/** Agent source for v2 response (same shape as legacy AgentSource). */
export const AgentSourceSchema = z.object({
  storyId: z.number(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  points: z.number(),
  commentCount: z.number(),
});

/** Structured agent response produced by the Writer. */
export const AgentResponseV2Schema = z.object({
  headline: z.string(),
  context: z.string(),
  sections: z.array(ResponseSectionSchema).min(2).max(4),
  bottomLine: z.string(),
  sources: z.array(AgentSourceSchema),
});
export type AgentResponseV2 = z.infer<typeof AgentResponseV2Schema>;
