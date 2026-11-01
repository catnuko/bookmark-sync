import { cva, type VariantProps } from 'class-variance-authority';

export { default as Alert } from './Alert.vue';

// 旧 .banner 四色 tint 体系（规范 §4.1）
export const alertVariants = cva(
  'flex gap-2.5 items-start rounded-md p-[10px_12px] text-body-sm leading-(--text-body-sm--line-height) [&_svg]:size-4.5 [&_svg]:mt-px [&_svg]:flex-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        success:
          'bg-success-tint border border-success-border text-foreground [&_svg]:text-success-text',
        destructive:
          'bg-destructive-tint border border-destructive-border text-foreground [&_svg]:text-destructive-text',
        warning:
          'bg-warning-tint border border-warning-border text-foreground [&_svg]:text-warning-text',
        info: 'bg-info-tint border border-info-border text-foreground [&_svg]:text-info-text',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

export type AlertVariants = VariantProps<typeof alertVariants>;
