import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard shadcn class combiner: clsx for conditional joins, tailwind-merge to
// resolve conflicting utility classes. Used by the ui/ primitives.
export const cn = (...inputs) => twMerge(clsx(inputs));
