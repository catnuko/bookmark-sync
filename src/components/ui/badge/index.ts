import { cva, type VariantProps } from 'class-variance-authority';

export { default as Badge } from './Badge.vue';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 h-5 px-2 rounded-full text-badge font-semibold leading-none tracking-[0.04em] uppercase flex-none',
  {
    variants: {
      variant: {
        // 旧 badge-neutral：灰底叠底字
        secondary: 'bg-muted text-(--text-on-inset)',
        success: 'bg-success-tint text-success-text',
        danger: 'bg-destructive-tint text-destructive-text',
        warning: 'bg-warning-tint text-warning-text',
        info: 'bg-info-tint text-info-text',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
);

export type BadgeVariants = VariantProps<typeof badgeVariants>;
