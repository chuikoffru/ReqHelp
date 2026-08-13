import { z } from 'zod'
import {
  ENTITY_TYPES,
  CONFIDENCE_LEVELS,
  SEVERITY_LEVELS,
} from '../../shared/analysis'

const entityTypeSchema = z.enum(ENTITY_TYPES)
const confidenceSchema = z.enum(CONFIDENCE_LEVELS)
const severitySchema = z.enum(SEVERITY_LEVELS)

export const llmAnalysisSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string().min(1),
      type: entityTypeSchema,
      confidence: confidenceSchema,
      context: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  attributes: z.array(
    z.object({
      name: z.string().min(1),
      context: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  sections: z.array(
    z.object({
      name: z.string().min(1),
      count: z.number().int().nonnegative(),
    }),
  ),
  gaps: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      question: z.string().min(1),
      severity: severitySchema,
    }),
  ),
  recommendations: z.array(
    z.object({
      text: z.string().min(1),
    }),
  ),
})

export const analysisResultSchema = llmAnalysisSchema.extend({
  words: z.number().int().nonnegative(),
})
