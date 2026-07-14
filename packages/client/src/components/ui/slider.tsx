import { cn } from '@/lib/utils'
import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import { type VariantProps, cva } from 'class-variance-authority'
import type * as React from 'react'

type SliderCssProperties = React.CSSProperties & {
  '--slider-thumb-cutout'?: string | number
  '--slider-thumb-position'?: string
  '--slider-thumb-thickness'?: string | number
}

const DEFAULT_THUMB_CUTOUT = '8px'
const DEFAULT_THUMB_THICKNESS = '4px'

export const sliderControlVariants = cva(
  'relative flex touch-none items-center justify-center select-none data-disabled:opacity-50 data-vertical:flex-col',
  {
    variants: {
      thickness: {
        xs: 'data-horizontal:h-12 data-horizontal:w-full data-vertical:h-full data-vertical:w-12',
        s: 'data-horizontal:h-12 data-horizontal:w-full data-vertical:h-full data-vertical:w-12',
        m: 'data-horizontal:h-[52px] data-horizontal:w-full data-vertical:h-full data-vertical:w-[52px]',
        l: 'data-horizontal:h-[68px] data-horizontal:w-full data-vertical:h-full data-vertical:w-[68px]',
        xl: 'data-horizontal:h-[108px] data-horizontal:w-full data-vertical:h-full data-vertical:w-[108px]',
      },
    },
    defaultVariants: { thickness: 'xs' },
  },
)

export const sliderTrackVariants = cva(
  'bg-m3-secondary-container relative grow overflow-hidden select-none',
  {
    variants: {
      thickness: {
        xs: 'rounded-[8px] data-horizontal:h-4 data-horizontal:w-full data-vertical:h-full data-vertical:w-4',
        s: 'rounded-[8px] data-horizontal:h-6 data-horizontal:w-full data-vertical:h-full data-vertical:w-6',
        m: 'rounded-[12px] data-horizontal:h-10 data-horizontal:w-full data-vertical:h-full data-vertical:w-10',
        l: 'rounded-[16px] data-horizontal:h-14 data-horizontal:w-full data-vertical:h-full data-vertical:w-14',
        xl: 'rounded-[28px] data-horizontal:h-24 data-horizontal:w-full data-vertical:h-full data-vertical:w-24',
      },
    },
    defaultVariants: { thickness: 'xs' },
  },
)

export const sliderThumbVariants = cva(
  'bg-m3-primary absolute z-10 block shrink-0 transition-colors duration-200 outline-none focus-visible:brightness-110 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      thickness: {
        xs: 'rounded-[8px] data-horizontal:h-11 data-horizontal:w-(--slider-thumb-thickness) data-vertical:h-(--slider-thumb-thickness) data-vertical:w-11',
        s: 'rounded-[8px] data-horizontal:h-11 data-horizontal:w-(--slider-thumb-thickness) data-vertical:h-(--slider-thumb-thickness) data-vertical:w-11',
        m: 'rounded-[12px] data-horizontal:h-[52px] data-horizontal:w-(--slider-thumb-thickness) data-vertical:h-(--slider-thumb-thickness) data-vertical:w-[52px]',
        l: 'rounded-[16px] data-horizontal:h-[68px] data-horizontal:w-(--slider-thumb-thickness) data-vertical:h-(--slider-thumb-thickness) data-vertical:w-[68px]',
        xl: 'rounded-[28px] data-horizontal:h-[108px] data-horizontal:w-(--slider-thumb-thickness) data-vertical:h-(--slider-thumb-thickness) data-vertical:w-[108px]',
      },
    },
    defaultVariants: { thickness: 'xs' },
  },
)

export interface SliderProps
  extends
    Omit<SliderPrimitive.Root.Props, 'min' | 'max'>,
    VariantProps<typeof sliderTrackVariants> {
  minValue?: number
  maxValue?: number
  showValue?: boolean
  valuePosition?: 'top' | 'bottom'
  thumbCutout?: string | number
  thumbClassName?: string
  thumbThickness?: string | number
}

function getSliderValues(
  value: SliderProps['value'],
  defaultValue: SliderProps['defaultValue'],
  minValue: number,
  maxValue: number,
) {
  if (Array.isArray(value)) return value
  if (value !== undefined) return [value]
  if (Array.isArray(defaultValue)) return defaultValue
  if (defaultValue !== undefined) return [defaultValue]
  return [minValue, maxValue]
}

function getThumbPercentages(
  values: readonly number[],
  minValue: number,
  maxValue: number,
) {
  const range = maxValue - minValue
  if (range <= 0) return []

  return values
    .map((value) => ((value - minValue) / range) * 100)
    .map((percent) => Math.min(Math.max(percent, 0), 100))
    .sort((a, b) => a - b)
    .map((percent) => `${percent}%`)
}

function getTrackMaskStyle(
  thumbPercentages: readonly string[],
  orientation: SliderProps['orientation'],
): React.CSSProperties | undefined {
  if (thumbPercentages.length === 0) return

  const direction = orientation === 'vertical' ? 'to top' : 'to right'
  const stops = thumbPercentages.flatMap((percentage) => {
    const start = `clamp(0%, calc(${percentage} - var(--slider-thumb-cutout)), 100%)`
    const end = `clamp(0%, calc(${percentage} + var(--slider-thumb-cutout)), 100%)`

    return [
      `#000 ${start}`,
      `transparent ${start}`,
      `transparent ${end}`,
      `#000 ${end}`,
    ]
  })
  const maskImage = `linear-gradient(${direction}, #000 0, ${stops.join(', ')}, #000 100%)`

  return {
    WebkitMaskImage: maskImage,
    maskImage,
  }
}

function SliderTrackSegments({
  orientation,
}: {
  orientation: SliderProps['orientation']
}) {
  if (orientation === 'vertical') {
    return (
      <>
        <div className="bg-m3-primary absolute right-0 bottom-0 left-0 h-[clamp(0px,calc(var(--slider-thumb-position)-var(--slider-thumb-cutout)),100%)] rounded-[inherit] rounded-t-xs" />
        <div className="bg-m3-secondary-container absolute top-0 right-0 left-0 h-[clamp(0px,calc(100%-var(--slider-thumb-position)-var(--slider-thumb-cutout)),100%)] rounded-[inherit] rounded-b-xs" />
      </>
    )
  }

  return (
    <>
      <div className="bg-m3-primary absolute top-0 bottom-0 left-0 w-[clamp(0px,calc(var(--slider-thumb-position)-var(--slider-thumb-cutout)),100%)] rounded-[inherit] rounded-r-xs" />
      <div className="bg-m3-secondary-container absolute top-0 right-0 bottom-0 w-[clamp(0px,calc(100%-var(--slider-thumb-position)-var(--slider-thumb-cutout)),100%)] rounded-[inherit] rounded-l-xs" />
    </>
  )
}

function getSliderStyle(
  style: SliderProps['style'],
  thumbCutout: string | number,
  thumbPosition: string | undefined,
  thumbThickness: string | number,
): SliderProps['style'] {
  if (typeof style === 'function') {
    return ((state) =>
      getSliderStyleObject(
        style(state),
        thumbCutout,
        thumbPosition,
        thumbThickness,
      )) as SliderProps['style']
  }

  return getSliderStyleObject(style, thumbCutout, thumbPosition, thumbThickness)
}

function getSliderStyleObject(
  style: React.CSSProperties | undefined,
  thumbCutout: string | number,
  thumbPosition: string | undefined,
  thumbThickness: string | number,
): SliderCssProperties {
  return {
    ...style,
    '--slider-thumb-cutout': thumbCutout,
    '--slider-thumb-position': thumbPosition,
    '--slider-thumb-thickness': thumbThickness,
  }
}

function Slider({
  className,
  defaultValue,
  value,
  minValue = 0,
  maxValue = 100,
  showValue = false,
  valuePosition = 'top',
  thickness,
  thumbCutout = DEFAULT_THUMB_CUTOUT,
  thumbClassName,
  thumbThickness = DEFAULT_THUMB_THICKNESS,
  orientation = 'horizontal',
  style,
  ...props
}: SliderProps) {
  const _values = getSliderValues(value, defaultValue, minValue, maxValue)
  const thumbPercentages = getThumbPercentages(_values, minValue, maxValue)
  const thumbPosition =
    thumbPercentages.length === 1 ? thumbPercentages[0] : undefined
  const trackMaskStyle = thumbPosition
    ? undefined
    : getTrackMaskStyle(thumbPercentages, orientation)
  const sliderStyle = getSliderStyle(
    style,
    thumbCutout,
    thumbPosition,
    thumbThickness,
  )

  return (
    <SliderPrimitive.Root
      className={cn(
        'group cursor-grab data-horizontal:w-48 data-horizontal:max-w-full data-vertical:h-48',
        className,
      )}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={minValue}
      max={maxValue}
      orientation={orientation}
      thumbAlignment="center"
      style={sliderStyle}
      {...props}
    >
      <SliderPrimitive.Control className={sliderControlVariants({ thickness })}>
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            sliderTrackVariants({ thickness }),
            thumbPosition && 'overflow-visible bg-transparent',
          )}
          style={trackMaskStyle}
        >
          {thumbPosition ? (
            <SliderTrackSegments orientation={orientation} />
          ) : (
            <SliderPrimitive.Indicator
              data-slot="slider-range"
              className="bg-m3-primary select-none data-horizontal:h-full data-vertical:w-full"
            />
          )}
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            // biome-ignore lint/suspicious/noArrayIndexKey: static
            key={index}
            className={cn(sliderThumbVariants({ thickness }), thumbClassName)}
          >
            {showValue && (
              <SliderPrimitive.Value
                className={cn(
                  'bg-m3-inverse-surface text-m3-inverse-on-surface absolute flex h-10 min-w-12 items-center justify-center rounded-full px-2 text-xs font-medium opacity-0 transition-opacity delay-1000 duration-200 select-none group-hover:opacity-100 group-hover:delay-0 group-hover:duration-0 group-focus-visible:opacity-100 group-focus-visible:delay-0 group-focus-visible:duration-0 group-active:opacity-100 group-active:delay-0 group-active:duration-0 group-data-dragging:opacity-100 group-data-dragging:delay-0 group-data-dragging:duration-0 data-horizontal:left-1/2 data-horizontal:-translate-x-1/2 data-vertical:top-1/2 data-vertical:-translate-y-1/2',
                  valuePosition === 'top'
                    ? 'data-horizontal:-top-12 data-vertical:-left-16'
                    : 'data-horizontal:-bottom-12 data-vertical:-right-16',
                )}
              >
                {(_, values) => values[index]}
              </SliderPrimitive.Value>
            )}
          </SliderPrimitive.Thumb>
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
