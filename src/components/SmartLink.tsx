import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { crossHostUrl } from '../config/site'

/** A Link that jumps to app.larry.exchange or larry.exchange when the route lives there. */
export function SmartLink({ to, className, children, onClick }: { to: string; className?: string; children: ReactNode; onClick?: () => void }) {
  const url = crossHostUrl(to)
  if (url)
    return (
      <a href={url} className={className} onClick={onClick}>
        {children}
      </a>
    )
  return (
    <Link to={to} className={className} onClick={onClick}>
      {children}
    </Link>
  )
}

export function SmartNavLink({ to, children, onClick }: { to: string; children: ReactNode; onClick?: () => void }) {
  const url = crossHostUrl(to)
  if (url)
    return (
      <a href={url} onClick={onClick}>
        {children}
      </a>
    )
  return (
    <NavLink to={to} onClick={onClick}>
      {children}
    </NavLink>
  )
}
