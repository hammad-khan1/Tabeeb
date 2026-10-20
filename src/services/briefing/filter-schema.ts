import { z } from 'zod';

const date = z.union([z.iso.date(), z.iso.datetime({ offset: true })]).nullish();
export const briefingFilterSchema = z.object({
  from: date,
  to: date,
  documentIds: z.array(z.uuid()).max(200).optional(),
}).strict().refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to),
  'The start date must be before the end date.');
