import { cva, type VariantProps } from 'class-variance-authority';

export { default as Button } from './Button.vue';

export const buttonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 rounded-md text-body font-semibold leading-none whitespace-nowrap select-none transition-colors duration-100 active:translate-y-px disabled:pointer-events-none disabled:bg-(--btn-disabled-bg) disabled:text-(--btn-disabled-fg) [&_svg]:size-4.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-muted active:bg-muted',
        ghost: 'bg-transparent text-foreground hover:bg-scrim',
        // 现状 destructive 是「透明底+红字+红边框」，与 shadcn 默认实底红不同（规范 §4.1）
        'outline-destructive':
          'bg-transparent text-destructive-text border border-destructive-border hover:bg-destructive-tint active:bg-destructive-tint',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        default: 'h-9 px-3.5',
        sm: 'h-8 px-3 text-body-sm',
        // lg：主 CTA 全宽（旧 .btn-lg，h-44px）
        xl: 'h-11 w-full',
        // 32×32 图标按钮（旧 .icon-btn）
        'icon-sm': 'hit-slop size-8 rounded-sm text-muted-foreground hover:text-foreground p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
