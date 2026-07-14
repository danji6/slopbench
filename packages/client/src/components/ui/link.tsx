import { Link as WouterLink } from 'wouter'

import { Button, type ButtonProps } from './button'

export function Link({ to, ...props }: { to: string } & ButtonProps) {
  return <Button variant="link" render={<WouterLink to={to} />} {...props} />
}

export function FakeLink({
  href = '#',
  className,
  ...props
}: {
  href?: string
} & Omit<React.ComponentProps<'a'>, 'href'>) {
  return (
    <a
      href={href}
      className={`text-m3-primary font-medium underline${className ? ` ${className}` : ''}`}
      {...props}
    />
  )
}
